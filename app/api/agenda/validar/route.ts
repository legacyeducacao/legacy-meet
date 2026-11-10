import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { validarConflitos } from '@/lib/agenda-engine';
import { contextoExecutor, podeUsarAgendaNova } from '@/lib/agenda/servidor';
import { conflitoParaDTO } from '@/lib/agenda/regras';

export const dynamic = 'force-dynamic';

/** Prévia de conflitos para a tela (antes de salvar). Não grava nada. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !(await podeUsarAgendaNova(user))) return new NextResponse('Não autorizado', { status: 403 });
  const b = ((await req.json().catch(() => null)) ?? {}) as {
    candidatas?: Array<{ inicio: string; fim: string; substituiEventoId?: string }>;
    executorId?: string;
  };
  const candidatas = (b.candidatas ?? [])
    .slice(0, 200)
    .map((c, k) => ({ ref: String(k), inicio: new Date(c.inicio), fim: new Date(c.fim), substituiEventoId: c.substituiEventoId }))
    .filter((c) => !isNaN(c.inicio.getTime()) && c.fim > c.inicio);
  if (!candidatas.length) return NextResponse.json({ conflitos: [] });
  const executorId = user.isAdmin && b.executorId ? b.executorId : user.id;
  const min = Math.min(...candidatas.map((c) => c.inicio.getTime()));
  const max = Math.max(...candidatas.map((c) => c.fim.getTime()));
  const ctx = await contextoExecutor(executorId, new Date(min), new Date(max + 86_400_000));
  return NextResponse.json({ conflitos: validarConflitos(candidatas, ctx).map(conflitoParaDTO), podeSobreporBloqueante: user.isAdmin });
}
