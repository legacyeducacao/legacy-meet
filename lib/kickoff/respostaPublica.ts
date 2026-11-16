/** Resposta das rotas públicas do kickoff: nunca em cache, nunca indexada, sem referrer. */
import { NextResponse } from 'next/server';
import { origemDoVisitante } from './origem';

export const CABECALHOS_PUBLICOS = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
} as const;

export function respostaPublica(corpo: unknown, status = 200): NextResponse {
  return NextResponse.json(corpo, { status, headers: CABECALHOS_PUBLICOS });
}

/** Falha técnica: mensagem genérica, sem detalhe do banco nem da configuração. */
export const FALHA_PUBLICA = { status: 'erro', mensagem: 'Não foi possível concluir agora. Tente de novo em instantes.' } as const;

/**
 * Origem do visitante para o limite de tentativas. Configuração errada (ex.: sem
 * KICKOFF_ORIGEM_SECRET em produção) fecha a rota: sem limite confiável, nada passa.
 */
export function origemOuFalha(headers: Headers): { origem: string } | { falha: NextResponse } {
  try {
    return { origem: origemDoVisitante(headers) };
  } catch (e) {
    console.error('[kickoff] rota pública fechada:', e instanceof Error ? e.message : e);
    return { falha: respostaPublica(FALHA_PUBLICA, 503) };
  }
}
