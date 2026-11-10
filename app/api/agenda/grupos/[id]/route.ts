import { after, NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { deleteCalendarEvent } from '@/lib/calendar';
import { corpo, soAdmin, usuarioAgenda } from '@/lib/agenda/rota';
import { editarGrupo, type MudancasGrupo } from '@/lib/agenda/editarGrupo';

export const dynamic = 'force-dynamic';

/**
 * Editar o grupo (nome, dia, horário, duração, primeira aula, executor,
 * substituto e cliente): ver lib/agenda/editarGrupo.ts. Encerrar ({ ativo:
 * false }, só admin) cancela os encontros futuros.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  const admin = createAdminSupabase();
  const { data: g } = await admin.from('agenda_grupos').select('executor_id, ativo').eq('id', id).maybeSingle();
  if (!g) return new NextResponse('Grupo não encontrado', { status: 404 });
  const b = await corpo<MudancasGrupo & { ativo?: boolean; justificativa?: string }>(req);

  if (b.ativo !== false) {
    const { ativo: _a, justificativa, ...mudancas } = b;
    const r = await editarGrupo(id, a.user, mudancas, justificativa);
    if (r.ok) return NextResponse.json(r);
    if ('conflito' in r) return NextResponse.json(r.conflito, { status: 409 });
    return new NextResponse(r.erro, { status: r.status });
  }
  if (!a.user.isAdmin) return soAdmin();
  const { error } = await admin
    .from('agenda_grupos')
    .update({ ativo: false, fim: new Date().toISOString().slice(0, 10), atualizado_em: new Date().toISOString() })
    .eq('id', id);
  if (error) return new NextResponse('Falha ao salvar: ' + error.message, { status: 400 });

  if (b.ativo === false && g.ativo) {
    // Encerrar: cancela os encontros futuros ainda agendados.
    const { data: series } = await admin.from('agenda_series').select('id').eq('grupo_id', id);
    const serieIds = ((series ?? []) as Array<{ id: string }>).map((s) => s.id);
    const { data: ocs } = serieIds.length
      ? await admin.from('agenda_ocorrencias').select('meeting_id').in('serie_id', serieIds).not('meeting_id', 'is', null)
      : { data: [] };
    const ids = ((ocs ?? []) as Array<{ meeting_id: string }>).map((o) => o.meeting_id);
    if (ids.length) {
      const { data: futuras } = await admin
        .from('meetings')
        .select('id')
        .in('id', ids)
        .eq('status', 'scheduled')
        .gt('scheduled_start_at', new Date().toISOString());
      const cancelar = ((futuras ?? []) as Array<{ id: string }>).map((m) => m.id);
      if (cancelar.length) {
        await admin.from('meetings').update({ status: 'canceled' }).in('id', cancelar);
        await admin.from('agenda_cancelamentos').insert(cancelar.map((m) => ({ meeting_id: m, origem: 'legacy', usuario_id: a.user.id })));
        await admin.from('agenda_ocorrencias').update({ status: 'cancelada' }).in('meeting_id', cancelar);
        after(async () => {
          const { data: secs } = await admin.from('meet_meeting_sector').select('calendar_event_id').in('meeting_id', cancelar);
          for (const s of (secs ?? []) as Array<{ calendar_event_id: string | null }>) {
            if (s.calendar_event_id) await deleteCalendarEvent(s.calendar_event_id).catch(() => {});
          }
        });
      }
    }
    await admin.from('agenda_series').update({ encerrada_em: new Date().toISOString() }).eq('grupo_id', id);
  }
  return NextResponse.json({ ok: true });
}
