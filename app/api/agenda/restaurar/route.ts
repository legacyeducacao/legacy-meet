import { after, NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { updateCalendarEvent } from '@/lib/calendar';
import { podeUsarAgendaNova } from '@/lib/agenda/servidor';

export const dynamic = 'force-dynamic';

type Item = { id: string; inicio: string; fim: string; titulo?: string | null };

/** "Desfazer" de mover/editar: volta horário e título que a tela guardou. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !(await podeUsarAgendaNova(user))) return new NextResponse('Não autorizado', { status: 403 });
  const b = ((await req.json().catch(() => null)) ?? {}) as { itens?: Item[] };
  const itens = (b.itens ?? []).slice(0, 500);
  if (!itens.length) return new NextResponse('Nada para desfazer', { status: 400 });

  const admin = createAdminSupabase();
  const { data } = await admin.from('meetings').select('id, host_id, status').in('id', itens.map((i) => i.id));
  const permitidos = new Set(
    ((data ?? []) as Array<{ id: string; host_id: string; status: string }>)
      .filter((m) => m.status === 'scheduled' && (user.isAdmin || m.host_id === user.id))
      .map((m) => m.id),
  );
  const ok = itens.filter((i) => permitidos.has(i.id) && !isNaN(Date.parse(i.inicio)) && !isNaN(Date.parse(i.fim)));
  for (const i of ok) {
    await admin
      .from('meetings')
      .update({
        scheduled_start_at: new Date(i.inicio).toISOString(),
        scheduled_end_at: new Date(i.fim).toISOString(),
        ...(i.titulo ? { title: i.titulo } : {}),
      })
      .eq('id', i.id);
  }
  // Remarcação desfeita não conta no indicador.
  const desde = new Date(Date.now() - 10 * 60_000).toISOString();
  await admin.from('agenda_remarcacoes').delete().in('meeting_id', ok.map((i) => i.id)).gte('criado_em', desde);

  after(async () => {
    const { data: secs } = await admin.from('meet_meeting_sector').select('meeting_id, calendar_event_id').in('meeting_id', ok.map((i) => i.id));
    const porId = new Map(ok.map((i) => [i.id, i]));
    for (const s of (secs ?? []) as Array<{ meeting_id: string; calendar_event_id: string | null }>) {
      const i = porId.get(s.meeting_id);
      if (!s.calendar_event_id || !i) continue;
      try {
        await updateCalendarEvent(s.calendar_event_id, { summary: i.titulo ?? undefined, startISO: i.inicio, endISO: i.fim });
      } catch (e) {
        console.error('[agenda] desfazer: falha no Google Agenda', e);
      }
    }
  });
  return NextResponse.json({ ok: true, restaurados: ok.length });
}
