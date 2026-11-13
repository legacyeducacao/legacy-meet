import { NextRequest } from 'next/server';
import { FALHA_PUBLICA, origemOuFalha, respostaPublica } from '@/lib/kickoff/respostaPublica';
import { acessoDoConvite } from '@/lib/kickoff/zoomAcesso';

export const dynamic = 'force-dynamic';

/**
 * PÚBLICA (sem login): a empresa pede de novo o acesso à reunião ("Tentar de novo"
 * na página do agendamento). Garante a inscrição da reserva ATIVA da empresa do
 * convite na sala Zoom. Nada vem do corpo: empresa e reserva saem do convite.
 * A resposta leva só o estado e o endereço da Legacy, nunca o link do Zoom.
 * Limite: 30 pedidos por convite em 15 minutos (no banco).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await ctx.params;
  const o = origemOuFalha(req.headers);
  if ('falha' in o) return o.falha;
  const r = await acessoDoConvite(codigo, o.origem, { tentar: true });
  if (!r) return respostaPublica(FALHA_PUBLICA, 503);
  return respostaPublica(r);
}
