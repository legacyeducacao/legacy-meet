import { after, NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { deleteCalendarEvent } from '@/lib/calendar';
import { podeUsarAgendaNova } from '@/lib/agenda/servidor';

export const dynamic = 'force-dynamic';

/**
 * "Desfazer" logo depois de criar: apaga de verdade as reuniões recém-criadas
 * (até 15 min, ainda agendadas, nunca iniciadas). Não vira cancelamento nos
 * indicadores, porque a reunião nunca existiu para o cliente.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !(await podeUsarAgendaNova(user))) return new NextResponse('Não autorizado', { status: 403 });
  const b = ((await req.json().catch(() => null)) ?? {}) as { ids?: string[] };
  const ids = (b.ids ?? []).slice(0, 500);
  if (!ids.length) return new NextResponse('Nada para desfazer', { status: 400 });

  const admin = createAdminSupabase();
  const limite = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data } = await admin
    .from('meetings')
    .select('id, host_id, status, started_at, created_at')
    .in('id', ids)
    .eq('status', 'scheduled')
    .is('started_at', null)
    .gte('created_at', limite);
  const apagar = ((data ?? []) as Array<{ id: string; host_id: string }>).filter((m) => user.isAdmin || m.host_id === user.id).map((m) => m.id);
  if (!apagar.length) return new NextResponse('Não dá mais para desfazer', { status: 409 });

  const { data: secs } = await admin.from('meet_meeting_sector').select('calendar_event_id').in('meeting_id', apagar);
  await admin.from('agenda_series').delete().in('recurrence_parent_id', apagar);
  await admin.from('meet_meeting_hosts').delete().in('meeting_id', apagar);
  await admin.from('meet_meeting_sector').delete().in('meeting_id', apagar);
  const { error } = await admin.from('meetings').delete().in('id', apagar);
  if (error) return new NextResponse('Falha ao desfazer: ' + error.message, { status: 500 });

  after(async () => {
    for (const s of (secs ?? []) as Array<{ calendar_event_id: string | null }>) {
      if (!s.calendar_event_id) continue;
      try {
        await deleteCalendarEvent(s.calendar_event_id);
      } catch (e) {
        console.error('[agenda] desfazer criação: Google Agenda', e);
      }
    }
  });
  return NextResponse.json({ ok: true, apagadas: apagar.length });
}
