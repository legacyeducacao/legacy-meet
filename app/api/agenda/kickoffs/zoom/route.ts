import { NextRequest, NextResponse } from 'next/server';
import { corpo } from '@/lib/agenda/rota';
import { gestorDeKickoff, responder } from '@/lib/kickoff/rota';
import { ativarSala, estadoDaSala, verificarSala, verificarSalaAtiva } from '@/lib/kickoff/zoomSalaServidor';

export const dynamic = 'force-dynamic';

/**
 * Sala Zoom dos kickoffs (Zoom E1). Só quem gerencia kickoffs (ou admin).
 * GET lê só o banco: abrir a tela nunca chama o Zoom.
 */
export async function GET() {
  const g = await gestorDeKickoff();
  if (g.res) return g.res;
  try {
    return NextResponse.json(await estadoDaSala());
  } catch {
    return new NextResponse('Não foi possível ler a configuração da sala Zoom.', { status: 500 });
  }
}

/**
 * { acao: 'verificar', entrada }            consulta o Zoom e devolve o resultado (não grava);
 * { acao: 'ativar', entrada, motivo? }      verifica de novo e, se aprovada, ativa (motivo obrigatório para trocar);
 * { acao: 'verificar_ativa' }               verifica a sala ativa e grava o resultado.
 * Nada é criado nem alterado na conta Zoom. O usuário vem da sessão.
 */
export async function POST(req: NextRequest) {
  const g = await gestorDeKickoff();
  if (g.res) return g.res;
  const b = await corpo<{ acao?: string; entrada?: unknown; motivo?: unknown }>(req);
  switch (b.acao) {
    case 'verificar':
      return NextResponse.json({ verificacao: await verificarSala(b.entrada) });
    case 'ativar':
      return responder(await ativarSala(g.user.id, b.entrada, b.motivo), (d) => ({ ok: true, ...d }));
    case 'verificar_ativa':
      return responder(await verificarSalaAtiva(g.user.id), (d) => ({ ok: true, verificacao: d }));
    default:
      return new NextResponse('Ação inválida', { status: 400 });
  }
}
