import { NextRequest, NextResponse } from 'next/server';
import { previaMatricula } from '@/lib/agenda/grupos';
import { usuarioAgenda } from '@/lib/agenda/rota';

export const dynamic = 'force-dynamic';

/** Prévia da matrícula: data de entrada (sempre uma Aula 1) e os encontros da jornada. Não grava. */
export async function GET(req: NextRequest) {
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  const sp = req.nextUrl.searchParams;
  const dia = Number(sp.get('diaSemana') ?? '');
  const p = await previaMatricula({
    grupoId: sp.get('grupoId') || undefined,
    diaSemana: dia >= 1 && dia <= 7 ? dia : undefined,
    aPartirDe: /^\d{4}-\d{2}-\d{2}$/.test(sp.get('aPartirDe') ?? '') ? sp.get('aPartirDe')! : undefined,
  });
  return NextResponse.json({ previa: p });
}
