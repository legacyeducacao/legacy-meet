/**
 * Decisão sobre conflitos ao salvar (pura, testável):
 * - sem conflito: salva;
 * - só avisos: salva com justificativa (vai para o log);
 * - só avisos de feriado ou fora do expediente: basta confirmar, sem motivo
 *   (trabalhar em feriado e fim de semana é comum); a confirmação vai para o log;
 * - bloqueante: só admin passa por cima, e com justificativa.
 */
import type { Conflito } from '@/lib/agenda-engine';
import type { ConflitoDTO, RespostaConflito } from './tipos';

export function conflitoParaDTO(c: Conflito): ConflitoDTO {
  return {
    ref: c.ref,
    inicio: c.inicio.toISOString(),
    tipo: c.tipo,
    nivel: c.nivel,
    detalhe: c.detalhe,
    acaoSugerida: c.acaoSugerida,
    ...(c.sugestao ? { sugestao: c.sugestao.toISOString() } : {}),
  };
}

/**
 * Quem altera (move, renomeia, cancela) uma reunião: o dono, um admin e, no
 * Comercial, os anfitriões adicionais. Caso real: o SDR agenda para o Closer
 * (dono) e continua podendo remarcar ou cancelar o que agendou.
 */
export function podeAlterarReuniao(r: {
  userId: string;
  isAdmin: boolean;
  hostId: string | null;
  setor: string | null | undefined;
  coHostIds: readonly string[];
}): boolean {
  if (r.isAdmin || r.hostId === r.userId) return true;
  return r.setor === 'comercial' && r.coHostIds.includes(r.userId);
}

/**
 * Avisos que só pedem confirmação, sem motivo: feriado e fora do expediente (fim de
 * semana, noite). Se o admin configurar um deles como bloqueante, vale o bloqueio.
 */
const SO_CONFIRMACAO = new Set(['feriado', 'fora_expediente']);
export const pedeSoConfirmacao = (c: { tipo: string; nivel: string }) => c.nivel === 'aviso' && SO_CONFIRMACAO.has(c.tipo);

/** Texto registrado no log quando o aviso foi só confirmado. */
export const MOTIVO_CONFIRMADO = 'Confirmado ao salvar (aviso de feriado ou fora do expediente).';

export type Decisao =
  | { ok: true; registrar: Conflito[]; motivo: string }
  | { ok: false; resposta: RespostaConflito };

/**
 * confirmado: quem salvou viu os avisos e confirmou (formulário ou diálogo). Só
 * dispensa o motivo dos avisos de pedeSoConfirmacao.
 */
export function decidirConflitos(conflitos: Conflito[], isAdmin: boolean, justificativa?: string | null, confirmado = false): Decisao {
  if (!conflitos.length) return { ok: true, registrar: [], motivo: '' };
  const just = justificativa?.trim();
  const temBloqueante = conflitos.some((c) => c.nivel === 'bloqueante');
  const resposta: RespostaConflito = { conflitos: conflitos.map(conflitoParaDTO), podeSobreporBloqueante: isAdmin };
  if (!just) {
    if (confirmado && conflitos.every(pedeSoConfirmacao)) return { ok: true, registrar: conflitos, motivo: MOTIVO_CONFIRMADO };
    return { ok: false, resposta };
  }
  if (temBloqueante && !isAdmin) return { ok: false, resposta };
  return { ok: true, registrar: conflitos, motivo: just };
}
