import { NextRequest, NextResponse } from 'next/server';
import { corpo } from '@/lib/agenda/rota';
import { gestorDeKickoff, responder } from '@/lib/kickoff/rota';
import {
  atualizarParticipante,
  cancelarReserva,
  concluirKickoff,
  corrigirPresenca,
  ehUuid,
  historicoDaReserva,
  reagendar,
  registrarInterrupcao,
  registrarPresenca,
  remanejar,
} from '@/lib/kickoff/reservas';
import { gerarAcessoDaReserva } from '@/lib/kickoff/zoomAcesso';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Histórico da reserva. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const g = await gestorDeKickoff();
  if (g.res) return g.res;
  const { id } = await ctx.params;
  if (!ehUuid(id)) return new NextResponse('Reserva não encontrada.', { status: 404 });
  const historico = await historicoDaReserva(id);
  if (historico === null) return new NextResponse('As reservas de kickoff ainda não foram instaladas no banco.', { status: 503 });
  return NextResponse.json({ historico });
}

/** Corrige o participante principal. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const g = await gestorDeKickoff();
  if (g.res) return g.res;
  const { id } = await ctx.params;
  const b = await corpo<{ nome?: unknown; email?: unknown; telefone?: unknown }>(req);
  return responder(await atualizarParticipante(g.user.id, id, b), (d) => ({ ok: true, reserva: d }));
}

/**
 * Ações:
 * - { acao: 'cancelar', motivo? }
 * - { acao: 'remanejar', sessaoId, motivo? }
 * - { acao: 'presenca', presenca: 'presente' | 'ausente' }: comparecimento (não conclui)
 * - { acao: 'concluir', observacao? }: conclusão explícita e definitiva
 * - { acao: 'reagendar', sessaoId, motivo? }: só para reserva ausente ou interrompida (reserva nova)
 * - { acao: 'interromper', motivo }: compareceu e não concluiu (motivo obrigatório)
 * - { acao: 'corrigirPresenca', presenca: 'presente' | 'ausente' | 'nenhuma', motivo }: correção de engano
 * - { acao: 'gerarAcesso' }: gera ou recupera o acesso Zoom da reserva ativa (única ação que chama o Zoom);
 *   devolve o estado e o endereço da Legacy, nunca o link individual do Zoom
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await gestorDeKickoff();
  if (g.res) return g.res;
  const { id } = await ctx.params;
  const b = await corpo<{ acao?: string; sessaoId?: unknown; motivo?: unknown; presenca?: unknown; observacao?: unknown }>(req);
  const ok = (d: unknown) => ({ ok: true, reserva: d });
  switch (b.acao) {
    case 'cancelar':
      return responder(await cancelarReserva(g.user.id, id, b.motivo), ok);
    case 'remanejar':
      return responder(await remanejar(g.user.id, id, b.sessaoId, b.motivo), ok);
    case 'presenca':
      return responder(await registrarPresenca(g.user.id, id, b.presenca), ok);
    case 'concluir':
      return responder(await concluirKickoff(g.user.id, id, b.observacao), ok);
    case 'reagendar':
      return responder(await reagendar(g.user.id, id, b.sessaoId, b.motivo), ok);
    case 'interromper':
      return responder(await registrarInterrupcao(g.user.id, id, b.motivo), ok);
    case 'corrigirPresenca':
      return responder(await corrigirPresenca(g.user.id, id, b.presenca, b.motivo), ok);
    case 'gerarAcesso':
      return responder(await gerarAcessoDaReserva(g.user.id, id), (d) => ({ ok: true, acesso: d }));
    default:
      return new NextResponse('Ação inválida', { status: 400 });
  }
}
