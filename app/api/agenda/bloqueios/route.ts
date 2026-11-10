import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { reunioesAfetadas } from '@/lib/agenda-engine';
import { buscarBloqueios, contextoExecutor, FUSO } from '@/lib/agenda/servidor';
import { corpo, executorAlvo, usuarioAgenda } from '@/lib/agenda/rota';

export const dynamic = 'force-dynamic';

type Corpo = { inicio?: string; fim?: string; diaInteiro?: boolean; motivo?: string; rrule?: string | null; executorId?: string };

/**
 * Cria bloqueio pessoal (pontual ou recorrente, dia inteiro ou faixa). Devolve
 * as reuniões já marcadas que ele atinge (próximos 6 meses), para a tela mostrar.
 */
export async function POST(req: NextRequest) {
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  const b = await corpo<Corpo>(req);
  const executorId = executorAlvo(a.user, b.executorId);
  if (!executorId) return new NextResponse('Só admin bloqueia a agenda de outra pessoa', { status: 403 });
  const inicio = new Date(b.inicio ?? '');
  const fim = new Date(b.fim ?? '');
  if (isNaN(inicio.getTime()) || isNaN(fim.getTime()) || fim <= inicio) return new NextResponse('Horário inválido', { status: 400 });
  const rrule = b.rrule?.trim() || null;
  if (rrule && !/^FREQ=/.test(rrule)) return new NextResponse('Repetição inválida', { status: 400 });

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from('agenda_bloqueios')
    .insert({
      executor_id: executorId,
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
      dia_inteiro: !!b.diaInteiro,
      rrule,
      fuso: FUSO,
      motivo: b.motivo?.trim() || null,
      criado_por: a.user.id,
    })
    .select('id')
    .single();
  if (error) return new NextResponse('Falha ao bloquear: ' + error.message, { status: 400 });

  const ate = rrule ? new Date(inicio.getTime() + 183 * 86_400_000) : fim;
  const [ctx, ocorrencias] = await Promise.all([
    contextoExecutor(executorId, inicio, new Date(ate.getTime() + 86_400_000)),
    buscarBloqueios([executorId], inicio, ate),
  ]);
  const afetadas = new Map<string, { id: string; titulo: string; inicio: string }>();
  for (const o of ocorrencias.filter((x) => x.id === data.id)) {
    for (const e of reunioesAfetadas({ inicio: new Date(o.inicio), fim: new Date(o.fim) }, ctx.eventos)) {
      afetadas.set(e.id, { id: e.id, titulo: e.titulo ?? 'Reunião', inicio: e.inicio.toISOString() });
    }
  }
  return NextResponse.json({ id: data.id, afetadas: [...afetadas.values()].sort((x, y) => x.inicio.localeCompare(y.inicio)) });
}
