import { NextRequest, NextResponse } from 'next/server';
import { canSeeComercial, getCurrentUser } from '@/lib/auth';
import { validarConflitos } from '@/lib/agenda-engine';
import { carregarConfig, contextoExecutor, podeUsarAgendaNova } from '@/lib/agenda/servidor';
import { listarClosers } from '@/lib/comercial/closers';

export const dynamic = 'force-dynamic';

/**
 * GET ?inicio=ISO&fim=ISO : Closers do Comercial e se cada um está livre no
 * horário (sem reunião, como dono ou anfitrião adicional, nem bloqueio). Usado
 * pelo SDR ao escolher o Closer; a criação confere de novo ao salvar.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !(await podeUsarAgendaNova(user)) || !canSeeComercial(user)) return new NextResponse('Não autorizado', { status: 403 });
  const inicio = new Date(req.nextUrl.searchParams.get('inicio') ?? '');
  const fim = new Date(req.nextUrl.searchParams.get('fim') ?? '');
  const closers = await listarClosers();
  if (isNaN(inicio.getTime()) || isNaN(fim.getTime()) || fim <= inicio) {
    return NextResponse.json({ closers: closers.map((c) => ({ id: c.id, name: c.name, livre: null })) });
  }
  const cfg = await carregarConfig();
  const ate = new Date(fim.getTime() + 86_400_000);
  const lista = await Promise.all(
    closers.map(async (c) => {
      try {
        const ctx = await contextoExecutor(c.id, inicio, ate, cfg, { coAnfitriao: true });
        const travas = validarConflitos([{ ref: '0', inicio, fim }], ctx).filter((x) => x.nivel === 'bloqueante');
        return { id: c.id, name: c.name, livre: travas.length === 0, motivo: travas[0]?.detalhe ?? null };
      } catch (e) {
        console.error('agenda closers: falha ao conferir', c.id, e);
        return { id: c.id, name: c.name, livre: null, motivo: null };
      }
    }),
  );
  return NextResponse.json({ closers: lista });
}
