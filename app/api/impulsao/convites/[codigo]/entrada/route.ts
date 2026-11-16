import { NextRequest } from 'next/server';
import { hostsDaAplicacao } from '@/lib/kickoff/enderecoPublico';
import { pedidoDaPropriaPagina } from '@/lib/kickoff/entradaToken';
import { FALHA_PUBLICA, origemOuFalha, respostaPublica } from '@/lib/kickoff/respostaPublica';
import { prepararEntrada } from '@/lib/kickoff/zoomAcesso';

export const dynamic = 'force-dynamic';

/**
 * PÚBLICA (sem login): primeiro passo do botão "Entrar na reunião". Confere, só no
 * banco, se a empresa do convite pode entrar agora (convite, reserva ativa, horário
 * da sessão) e devolve um passe de 2 minutos para o POST de entrada. Não chama o
 * Zoom, não cria inscrição e nunca devolve o link da reunião.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await ctx.params;
  if (!pedidoDaPropriaPagina(req.headers, hostsDaAplicacao(req))) return respostaPublica(FALHA_PUBLICA, 403);
  const o = origemOuFalha(req.headers);
  if ('falha' in o) return o.falha;
  const r = await prepararEntrada(codigo, o.origem);
  if (!r) return respostaPublica(FALHA_PUBLICA, 503);
  return respostaPublica(r);
}
