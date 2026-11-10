import { after, NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { deleteCalendarEvent } from '@/lib/calendar';
import { corpo, soAdmin, usuarioAgenda } from '@/lib/agenda/rota';

export const dynamic = 'force-dynamic';

/**
 * Admin: nome, substituto, cliente da reunião e encerrar o grupo (cancela os
 * encontros futuros). Executor do grupo: só o nome. Mudar dia/hora = encerrar
 * e criar outro grupo (o histórico fica).
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  const admin = createAdminSupabase();
  const { data: g } = await admin.from('agenda_grupos').select('executor_id, ativo').eq('id', id).maybeSingle();
  if (!g) return new NextResponse('Grupo não encontrado', { status: 404 });
  const b = await corpo<{ nome?: string; substitutoId?: string | null; tenantId?: string | null; ativo?: boolean }>(req);
  const dono = g.executor_id === a.user.id;
  if (!a.user.isAdmin && (!dono || b.substitutoId !== undefined || b.tenantId !== undefined || b.ativo !== undefined)) return soAdmin();

  const upd: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
  if (b.nome?.trim()) upd.nome = b.nome.trim();
  if (b.substitutoId !== undefined) upd.substituto_id = b.substitutoId;
  if (b.tenantId !== undefined) upd.tenant_id = b.tenantId;
  if (b.ativo === false) {
    upd.ativo = false;
    upd.fim = new Date().toISOString().slice(0, 10);
  }
  const { error } = await admin.from('agenda_grupos').update(upd).eq('id', id);
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
