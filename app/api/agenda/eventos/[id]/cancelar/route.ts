import { after, NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { deleteCalendarEvent } from '@/lib/calendar';
import { podeUsarAgendaNova } from '@/lib/agenda/servidor';
import { resolverAlvos } from '@/lib/agenda/alvos';
import type { Escopo, Origem } from '@/lib/agenda/tipos';

export const dynamic = 'force-dynamic';

/**
 * Cancela (status canceled, mantém histórico) esta reunião, esta e as
 * seguintes, ou todas da série. Registra quem originou o cancelamento.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user || !(await podeUsarAgendaNova(user))) return new NextResponse('Não autorizado', { status: 403 });
  const b = ((await req.json().catch(() => null)) ?? {}) as { escopo?: Escopo; origem?: Origem };
  const escopo: Escopo = b.escopo === 'seguintes' || b.escopo === 'todas' ? b.escopo : 'esta';
  const origem: Origem = b.origem === 'cliente' || b.origem === 'legacy' ? b.origem : 'executor';

  const r = await resolverAlvos(user, id, escopo);
  if (!r.ok) return new NextResponse(r.message, { status: r.status });
  const ids = r.alvos.map((a) => a.id);

  const admin = createAdminSupabase();
  const { error } = await admin.from('meetings').update({ status: 'canceled' }).in('id', ids).eq('status', 'scheduled');
  if (error) return new NextResponse('Falha ao cancelar: ' + error.message, { status: 500 });
  await admin.from('agenda_cancelamentos').insert(ids.map((m) => ({ meeting_id: m, origem, usuario_id: user.id })));
  await admin.from('agenda_ocorrencias').update({ status: 'cancelada' }).in('meeting_id', ids);

  after(async () => {
    const { data: secs } = await admin.from('meet_meeting_sector').select('calendar_event_id').in('meeting_id', ids);
    for (const s of (secs ?? []) as Array<{ calendar_event_id: string | null }>) {
      if (!s.calendar_event_id) continue;
      try {
        await deleteCalendarEvent(s.calendar_event_id);
      } catch (e) {
        console.error('[agenda] falha ao apagar evento do Google Agenda', e);
      }
    }
  });
  return NextResponse.json({ ok: true, cancelados: ids });
}
