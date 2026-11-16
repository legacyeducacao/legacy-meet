import { NextRequest, NextResponse } from 'next/server';
import { normalizarCodigo } from '@/lib/kickoff/convites';
import { hostsDaAplicacao } from '@/lib/kickoff/enderecoPublico';
import { passeValido, pedidoDaPropriaPagina } from '@/lib/kickoff/entradaToken';
import { origemDoVisitante } from '@/lib/kickoff/origem';
import { ehCodigoDeConvite } from '@/lib/kickoff/publico';
import { CABECALHOS_PUBLICOS } from '@/lib/kickoff/respostaPublica';
import { entradaNaReuniao } from '@/lib/kickoff/zoomAcesso';

export const dynamic = 'force-dynamic';

const texto = (mensagem: string, status: number) => new NextResponse(mensagem, { status, headers: { ...CABECALHOS_PUBLICOS, 'Content-Type': 'text/plain; charset=utf-8' } });

/**
 * PÚBLICA (sem login): a operação de entrada, acionada pelo botão "Entrar na
 * reunião" da página /impulsao/reuniao/<código> (formulário POST). É a ÚNICA rota
 * que entrega o link individual do Zoom, e só no cabeçalho Location do 303.
 *
 * Não existe GET aqui: abrir, pré-visualizar ou pré-carregar um endereço nunca
 * inscreve ninguém nem encaminha ao Zoom.
 *
 * Em ordem:
 *   1. formato do código;
 *   2. o pedido veio de uma página nossa (Sec-Fetch-Site / Origin);
 *   3. passe de 2 minutos emitido no clique, deste convite (entradaToken.ts);
 *   4. convite (expirado com reserva ativa vale; revogado não), limite de
 *      tentativas, reserva ATIVA, janela da sessão da reserva e inscrição na sala
 *      ativa, tudo de novo, no banco;
 *   5. 303 para o link individual. Qualquer recusa volta à página, que explica.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ codigo: string }> }) {
  const codigo = normalizarCodigo((await ctx.params).codigo);
  if (!ehCodigoDeConvite(codigo)) return texto('Link inválido.', 404);
  if (!pedidoDaPropriaPagina(req.headers, hostsDaAplicacao(req))) {
    return texto('Abra a página da reunião e use o botão "Entrar na reunião".', 403);
  }

  const voltar = (motivo: 'expirou' | 'pendente' | 'recusa' | 'falha') => {
    const destino = req.nextUrl.clone();
    destino.pathname = `/impulsao/reuniao/${codigo}`;
    destino.search = `?retorno=${motivo}`;
    return new NextResponse(null, { status: 303, headers: { ...CABECALHOS_PUBLICOS, Location: destino.toString() } });
  };

  let origem: string;
  let passe: unknown;
  try {
    origem = origemDoVisitante(req.headers);
    passe = (await req.formData()).get('passe');
  } catch (e) {
    console.error('[kickoff] entrada na reunião recusada:', e instanceof Error ? e.message : e);
    return voltar('falha');
  }
  if (!passeValido(passe, codigo)) return voltar('expirou');

  const e = await entradaNaReuniao(codigo, origem);
  if (!e) return voltar('falha');
  if (e.tipo === 'recusa') return voltar('recusa');
  if (e.tipo === 'pagina') return voltar('pendente');
  return new NextResponse(null, { status: 303, headers: { ...CABECALHOS_PUBLICOS, Location: e.url } });
}
