import { NextRequest } from 'next/server';
import { corpo } from '@/lib/agenda/rota';
import { gestorDeKickoff, responder } from '@/lib/kickoff/rota';
import { reservar } from '@/lib/kickoff/reservas';

export const dynamic = 'force-dynamic';

/** Inscreve uma empresa numa sessão de kickoff. O usuário vem da sessão, nunca do corpo. */
export async function POST(req: NextRequest) {
  const g = await gestorDeKickoff();
  if (g.res) return g.res;
  const b = await corpo<{ sessaoId?: unknown; tenantId?: unknown; nome?: unknown; email?: unknown; telefone?: unknown }>(req);
  return responder(await reservar(g.user.id, b), (d) => ({ ok: true, reserva: d }));
}
