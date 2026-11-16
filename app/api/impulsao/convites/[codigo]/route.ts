import { NextRequest } from 'next/server';
import { abrirConvite } from '@/lib/kickoff/convites';
import { FALHA_PUBLICA, origemOuFalha, respostaPublica } from '@/lib/kickoff/respostaPublica';
import { acessoDoConvite } from '@/lib/kickoff/zoomAcesso';

export const dynamic = 'force-dynamic';

/**
 * PÚBLICA (sem login): o que a página /impulsao/agendar/<código> mostra, só da
 * empresa do convite. O código vem da URL; a origem (HMAC do IP) é calculada aqui
 * para o limite de tentativas do banco.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await ctx.params;
  const o = origemOuFalha(req.headers);
  if ('falha' in o) return o.falha;
  const r = await abrirConvite(codigo, o.origem);
  if (!r) return respostaPublica(FALHA_PUBLICA, 503);
  // Com reserva marcada: estado do acesso à reunião (só o banco; abrir a página não
  // chama o Zoom). Sem a migration 007 ou com falha, a página segue como na M3.
  if (r.status === 'ok' && r.situacao === 'reservada') {
    const a = await acessoDoConvite(codigo, o.origem, { tentar: false });
    if (a?.status === 'ok') return respostaPublica({ ...r, acesso: a.acesso });
  }
  return respostaPublica(r);
}
