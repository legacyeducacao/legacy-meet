/**
 * Turmas do Legado (encontros em grupo do Legacy Plan) como eventos da agenda.
 * Só leitura: as linhas são do Legacy Plan (Zoom, check-in, RSVP, NPS).
 * Sem dependência de servidor: pode ir para o navegador e para os testes.
 */
import type { EventoDTO } from './tipos';

const UMA_HORA_MS = 60 * 60_000;

/** Linha de cohort_sessions com a turma (cohort_schedules) embutida. */
export interface LinhaSessaoTurma {
  id: string;
  scheduled_start_at: string;
  scheduled_end_at: string | null;
  title: string | null;
  modality: string | null;
  location: string | null;
  meeting_url: string | null;
  zoom_meeting_id: string | null;
  cohort_schedules: { cohort_name: string | null } | Array<{ cohort_name: string | null }> | null;
}

/**
 * Link da aula: só o meeting_url cadastrado no Legacy Plan. Não montamos link
 * pelo ID do Zoom: o Plan pode esconder o link de propósito (check-in).
 */
export function linkDaAula(meetingUrl: string | null | undefined, _zoomId?: string | null): string | null {
  const url = meetingUrl?.trim();
  return url && /^https?:\/\//i.test(url) ? url : null;
}

const MODALIDADES: Record<string, string> = {
  online: 'Online',
  in_person: 'Presencial',
  presencial: 'Presencial',
  hybrid: 'Híbrida',
  hibrido: 'Híbrida',
};

/** Nome da modalidade para a tela. */
export function rotuloModalidade(m: string | null | undefined): string | null {
  if (!m) return null;
  return MODALIDADES[m] ?? m.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function sessaoParaEvento(r: LinhaSessaoTurma): EventoDTO {
  const turma = Array.isArray(r.cohort_schedules) ? r.cohort_schedules[0] : r.cohort_schedules;
  const inicio = new Date(r.scheduled_start_at);
  const fim = r.scheduled_end_at ? new Date(r.scheduled_end_at) : null;
  const fimValido = fim && !isNaN(fim.getTime()) && fim > inicio ? fim : new Date(inicio.getTime() + UMA_HORA_MS);
  return {
    id: `turma:${r.id}`,
    tipo: 'turma',
    titulo: r.title?.trim() || 'Encontro da turma',
    inicio: inicio.toISOString(),
    fim: fimValido.toISOString(),
    calendario: 'turmas',
    executorId: '',
    turma: turma?.cohort_name?.trim() || null,
    modalidade: r.modality ?? null,
    local: r.location?.trim() || null,
    link: linkDaAula(r.meeting_url, r.zoom_meeting_id),
    podeEditar: false,
  };
}
