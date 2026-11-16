import { NextRequest, NextResponse } from 'next/server';
import { gestorDeKickoff } from '@/lib/kickoff/rota';
import { meetingIdDaSalaAtiva } from '@/lib/kickoff/zoomSalaServidor';

export const dynamic = 'force-dynamic';

/**
 * Atalho da EQUIPE para abrir a sala Zoom dos kickoffs (botão no cartão da sessão,
 * na agenda). Só quem gerencia kickoffs. Encaminha ao endereço da reunião no Zoom
 * (zoom.us/j/<Meeting ID da sala ativa>): quem estiver logado no Zoom com a conta
 * dona da reunião (ou como anfitrião alternativo) inicia como anfitrião.
 *
 * Não chama a API do Zoom e não usa o link de início do anfitrião (start_url), que
 * é uma credencial. Não é o acesso das empresas: elas entram pelo link individual,
 * em /impulsao/reuniao/<código>.
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
    return NextResponse.redirect(destino, { status: 302, headers: { 'Cache-Control': 'no-store' } });
  }
  return new NextResponse(null, { status: 302, headers: { Location: `https://zoom.us/j/${meetingId}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
