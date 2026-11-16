import { NextRequest, NextResponse } from 'next/server';
import { corpo } from '@/lib/agenda/rota';
import { gestorDeKickoff, responder } from '@/lib/kickoff/rota';
import { cancelarSessoes, configurarSessao, ehUuid } from '@/lib/kickoff/reservas';
import { sincronizarPresenca } from '@/lib/kickoff/zoomPresencaServidor';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Capacidade e bloqueio de novas reservas ({ capacidade?, aceitaReservas? }). */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const g = await gestorDeKickoff();
  if (g.res) return g.res;
  const { id } = await ctx.params;
  const b = await corpo<{ capacidade?: unknown; aceitaReservas?: unknown }>(req);
  return responder(await configurarSessao(g.user.id, id, b), (d) => ({ ok: true, sessao: d }));
}

/**
 * { acao: 'cancelar', comReservas: true, motivo? }: cancela ESTA sessão junto com
 * as reservas ativas dela (decisão explícita; nada é remanejado sozinho). Sem
 * reservas, cancelar pela agenda já basta. Só uma sessão por vez.
 *
 * { acao: 'sincronizarPresenca' }: lê os relatórios do Zoom (só leitura) e registra
 * "presente" nas reservas com participação comprovada (Zoom E3). Nunca marca
 * ausência nem conclui; repetir não duplica nada.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await gestorDeKickoff();
  if (g.res) return g.res;
  const { id } = await ctx.params;
  const b = await corpo<{ acao?: string; comReservas?: unknown; motivo?: unknown }>(req);
  if (b.acao === 'sincronizarPresenca') return responder(await sincronizarPresenca(g.user.id, id), (d) => ({ ok: true, resumo: d }));
  if (b.acao !== 'cancelar') return new NextResponse('Ação inválida', { status: 400 });
  if (!ehUuid(id)) return new NextResponse('Sessão de kickoff não encontrada.', { status: 404 });
  if (b.comReservas !== true) return new NextResponse('Confirme o cancelamento das reservas junto com a sessão', { status: 400 });
  const motivo = typeof b.motivo === 'string' ? b.motivo : null;
  return responder(await cancelarSessoes(g.user.id, [id], { comReservas: true, motivo, origem: 'legacy' }), (d) => ({ ok: true, ...d }));
}
