import { NextRequest, NextResponse } from 'next/server';
import { diffDays } from '@/lib/agenda-engine';
import { montarPainel } from '@/lib/agenda/painel';
import { sincronizarDuracoes } from '@/lib/agenda/duracoes';
import { usuarioAgenda, soAdmin } from '@/lib/agenda/rota';

export const dynamic = 'force-dynamic';

const ymd = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET ?de=YYYY-MM-DD&ate=YYYY-MM-DD&executor=<id>|todos&produto=&tenantId=
 * Só admin (gestão) vê o painel: todos os executores ou um deles.
 */
export async function GET(req: NextRequest) {
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  if (!a.user.isAdmin) return new NextResponse('O painel da agenda é só para admins', { status: 403 });
  const sp = req.nextUrl.searchParams;
  const de = sp.get('de') ?? '';
  const ate = sp.get('ate') ?? '';
  if (!ymd.test(de) || !ymd.test(ate) || ate < de) return new NextResponse('Período inválido', { status: 400 });
  if (diffDays(de, ate) > 366) return new NextResponse('Período de no máximo 1 ano', { status: 400 });
  const pedido = sp.get('executor');
  const executores = pedido && pedido !== 'todos' ? [pedido] : pedido === 'todos' ? null : [a.user.id];
  try {
    const painel = await montarPainel({
      periodo: { de, ate },
      executores,
      produto: sp.get('produto') || null,
      tenantId: sp.get('tenantId') || null,
    });
    return NextResponse.json({ ...painel, gestor: a.user.isAdmin });
  } catch (e) {
    console.error('agenda kpis', e);
    return new NextResponse('Erro ao calcular o painel', { status: 500 });
  }
}

/** Admin: busca no armazenamento as durações de gravações que ainda faltam no banco. */
export async function POST() {
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  if (!a.user.isAdmin) return soAdmin();
  return NextResponse.json(await sincronizarDuracoes(300));
}
