/**
 * Decisão sobre conflitos ao salvar (pura, testável):
 * - sem conflito: salva;
 * - só avisos: salva com justificativa (vai para o log);
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

export type Decisao =
  | { ok: true; registrar: Conflito[] }
  | { ok: false; resposta: RespostaConflito };

export function decidirConflitos(conflitos: Conflito[], isAdmin: boolean, justificativa?: string | null): Decisao {
  if (!conflitos.length) return { ok: true, registrar: [] };
  const just = justificativa?.trim();
  const temBloqueante = conflitos.some((c) => c.nivel === 'bloqueante');
  const resposta: RespostaConflito = { conflitos: conflitos.map(conflitoParaDTO), podeSobreporBloqueante: isAdmin };
  if (!just) return { ok: false, resposta };
  if (temBloqueante && !isAdmin) return { ok: false, resposta };
  return { ok: true, registrar: conflitos };
}
