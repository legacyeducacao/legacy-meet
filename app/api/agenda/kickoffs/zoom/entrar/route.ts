import { NextRequest, NextResponse } from 'next/server';
import { gestorDeKickoff } from '@/lib/kickoff/rota';
import { linkDeAnfitriaoDaSala, meetingIdDaSalaAtiva } from '@/lib/kickoff/zoomSalaServidor';

export const dynamic = 'force-dynamic';

const SEM_RASTRO = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

/**
 * Atalho da EQUIPE para entrar na sala Zoom dos kickoffs COMO ANFITRIÃO (botão
 * "Entrar na reunião" no cartão da sessão, na agenda). Só quem gerencia kickoffs.
 *
 * A reunião pertence a uma conta Zoom geral da Legacy; não dá para exigir que quem
 * conduz esteja logado nela. Por isso o servidor pede ao Zoom, a cada clique, o link
 * de início do anfitrião (start_url, só leitura da reunião) e encaminha para ele:
 * quem clica inicia a reunião como anfitrião, sem login no Zoom.
 *
 * O start_url é CREDENCIAL (vale por cerca de 2 horas): nunca é guardado, mostrado
 * em tela, devolvido em JSON ou escrito em log. Só existe no cabeçalho Location
 * desta resposta. Se o Zoom não responder ou a integração não estiver configurada,
 * cai no endereço comum da reunião (zoom.us/j/<id>), em que o Zoom pede login.
 *
 * Não é o acesso das empresas: elas entram pelo link individual, em
 * /impulsao/reuniao/<código>.
 */
export async function GET(req: NextRequest) {
  const g = await gestorDeKickoff();
  if (g.res) return g.res;
  const meetingId = await meetingIdDaSalaAtiva();
  if (!meetingId) {
    // Sem sala ativa: a seção Kickoffs mostra o aviso e onde configurar.
    const destino = req.nextUrl.clone();
    destino.pathname = '/agenda/kickoffs';
    destino.search = '';
    return NextResponse.redirect(destino, { status: 302, headers: SEM_RASTRO });
  }
  const comoAnfitriao = await linkDeAnfitriaoDaSala(meetingId);
  return new NextResponse(null, { status: 302, headers: { ...SEM_RASTRO, Location: comoAnfitriao ?? `https://zoom.us/j/${meetingId}` } });
}
