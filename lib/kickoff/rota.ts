/** Acesso das rotas /api/agenda/kickoffs: equipe do Meet com a permissão de kickoff (ou admin). */
import { NextResponse } from 'next/server';
import { podeGerenciarKickoff, type CurrentUser } from '@/lib/auth';
import { usuarioAgenda } from '@/lib/agenda/rota';
import type { Resultado } from './reservas';

export async function gestorDeKickoff(): Promise<{ user: CurrentUser; res?: undefined } | { user?: undefined; res: NextResponse }> {
  const a = await usuarioAgenda();
  if (a.res) return a;
  if (!podeGerenciarKickoff(a.user)) return { res: new NextResponse('Só quem gerencia os kickoffs do Impulsão pode fazer isso', { status: 403 }) };
  return { user: a.user };
}

/** Resultado de uma operação -> resposta HTTP (erro em texto, como o resto da agenda). */
export function responder<T>(r: Resultado<T>, corpo?: (d: T) => unknown): NextResponse {
  if (!r.ok) return new NextResponse(r.message, { status: r.status });
  return NextResponse.json(corpo ? corpo(r.dados) : { ok: true, dados: r.dados });
}
