/**
 * No-show (cliente não compareceu): regra única usada pela Agenda
 * (/api/meetings/no-show) e pela tela de saída do executor
 * (/api/execscore/pilares). O status fica em public.meetings (base das
 * métricas de no-show) e a reunião sai da fila do ExecScore.
 */
import { createAdminSupabase } from '@/lib/supabase/admin';
import { syncForaDoScore } from '@/lib/execscore';

type MeetingRow = {
  status: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  started_at: string | null;
  ended_at: string | null;
};

export type NoShowPlan =
  | { ok: true; update: Record<string, unknown>; status: string }
  | { ok: false; httpStatus: number; message: string };

/**
 * O que gravar para marcar (ou desfazer) o no-show. Pura, para testar.
 * Marcar: agendada (depois do horário), em andamento ou realizada.
 * Desfazer: volta para 'ended' se a reunião aconteceu, senão 'scheduled'.
 */
export function planNoShow(meeting: MeetingRow, undo: boolean, nowMs = Date.now()): NoShowPlan {
  if (undo) {
    if (meeting.status !== 'no_show') {
      return { ok: false, httpStatus: 400, message: 'A reunião não está marcada como no-show' };
    }
    // Aconteceu de fato (iniciou ou foi encerrada; inclui reuniões anteriores
    // à coluna started_at ser preenchida) -> 'ended'; senão 'scheduled'.
    const restored = meeting.started_at || meeting.ended_at ? 'ended' : 'scheduled';
    return { ok: true, update: { status: restored }, status: restored };
  }

  if (meeting.status === 'no_show') return { ok: true, update: {}, status: 'no_show' };
  // 'live' entra: o executor está (ou estava) na sala e o cliente não veio.
  if (!['scheduled', 'ended', 'live'].includes(meeting.status ?? '')) {
    return { ok: false, httpStatus: 400, message: 'Só reuniões agendadas ou realizadas podem virar no-show' };
  }
  if (
    meeting.status === 'scheduled' &&
    meeting.scheduled_start_at &&
    new Date(meeting.scheduled_start_at).getTime() > nowMs
  ) {
    return { ok: false, httpStatus: 400, message: 'A reunião ainda não chegou ao horário de início' };
  }

  // Reunião realizada sem ended_at (legado ou ainda 'live'): carimba para o
  // "desfazer" saber que ela aconteceu e restaurar 'ended', não 'scheduled'.
  const update: Record<string, unknown> = { status: 'no_show' };
  if ((meeting.status === 'ended' || meeting.status === 'live') && !meeting.ended_at) {
    update.ended_at = meeting.status === 'live' ? new Date(nowMs).toISOString() : meeting.scheduled_end_at;
  }
  return { ok: true, update, status: 'no_show' };
}

/** Marca ou desfaz o no-show (sem checar permissão: quem chama já checou). */
export async function applyNoShow(meetingId: string, undo: boolean): Promise<NoShowPlan> {
  const admin = createAdminSupabase();
  const { data: meeting } = await admin
    .from('meetings')
    .select('status, scheduled_start_at, scheduled_end_at, started_at, ended_at')
    .eq('id', meetingId)
    .maybeSingle();
  if (!meeting) return { ok: false, httpStatus: 404, message: 'Reunião não encontrada' };

  const plan = planNoShow(meeting as MeetingRow, undo);
  if (!plan.ok || Object.keys(plan.update).length === 0) return plan;

  const { error } = await admin.from('meetings').update(plan.update).eq('id', meetingId);
  if (error) {
    return {
      ok: false,
      httpStatus: 500,
      message: `Falha ao ${undo ? 'desfazer' : 'marcar'} no-show: ${error.message}`,
    };
  }
  await syncForaDoScore(meetingId);
  return plan;
}
