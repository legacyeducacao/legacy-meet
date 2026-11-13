import { NextRequest, NextResponse } from 'next/server';
import { corpo } from '@/lib/agenda/rota';
import { gestorDeKickoff, responder } from '@/lib/kickoff/rota';
import { gerarConvite, listarConvites, reemitirConvite, revogarConvite } from '@/lib/kickoff/convites';
import { enderecoPublico } from '@/lib/kickoff/enderecoPublico';

export const dynamic = 'force-dynamic';

/** Convites em vigor, com a situação do kickoff de cada empresa. Só quem gerencia kickoffs. */
export async function GET() {
  const g = await gestorDeKickoff();
  if (g.res) return g.res;
  const convites = await listarConvites();
  if (convites === null) return new NextResponse('Os convites ainda não foram instalados no banco (migration 005 pendente).', { status: 503 });
  // Endereço oficial dos links (KICKOFF_PUBLIC_BASE_URL): a tela avisa se faltar.
  const e = enderecoPublico();
  return NextResponse.json({ convites, endereco: e.ok ? { ok: true, base: e.base } : { ok: false, motivo: e.motivo } });
}

/**
 * { acao: 'gerar' | 'reemitir' | 'revogar', tenantId, motivo?, dias? }.
 * Gerar devolve o convite em vigor ou cria um; reemitir troca o código (o link
 * antigo para de abrir); revogar desliga sem criar outro. O usuário vem da sessão.
 */
export async function POST(req: NextRequest) {
  const g = await gestorDeKickoff();
  if (g.res) return g.res;
  const b = await corpo<{ acao?: string; tenantId?: unknown; motivo?: unknown; dias?: unknown }>(req);
  switch (b.acao) {
    case 'gerar':
      return responder(await gerarConvite(g.user.id, b.tenantId, b.dias), (d) => ({ ok: true, convite: d }));
    case 'reemitir':
      return responder(await reemitirConvite(g.user.id, b.tenantId, b.motivo, b.dias), (d) => ({ ok: true, convite: d }));
    case 'revogar':
      return responder(await revogarConvite(g.user.id, b.tenantId, b.motivo), (d) => ({ ok: true, ...d }));
    default:
      return new NextResponse('Ação inválida', { status: 400 });
  }
}
