/** Acesso das rotas /api/agenda: usuário logado com a agenda nova liberada. */
import { NextResponse } from 'next/server';
import { getCurrentUser, type CurrentUser } from '@/lib/auth';
import { podeUsarAgendaNova } from './servidor';

export async function usuarioAgenda(): Promise<{ user: CurrentUser; res?: undefined } | { user?: undefined; res: NextResponse }> {
  const user = await getCurrentUser();
  if (!user || !(await podeUsarAgendaNova(user))) return { res: new NextResponse('Não autorizado', { status: 403 }) };
  return { user };
}

export const soAdmin = () => new NextResponse('Só um admin pode alterar isto', { status: 403 });

export async function corpo<T>(req: Request): Promise<T> {
  return ((await req.json().catch(() => null)) ?? {}) as T;
}

/** Executor alvo: o próprio; admin pode indicar outro. */
export function executorAlvo(user: CurrentUser, pedido?: string | null): string | null {
  if (!pedido || pedido === user.id) return user.id;
  return user.isAdmin ? pedido : null;
}
