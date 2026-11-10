import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { addDays, instante, localYmd, previaImpactoFeriado, type Feriado } from '@/lib/agenda-engine';
import { carregarFeriados, FUSO } from '@/lib/agenda/servidor';
import { gruposAtivos, paraConfig } from '@/lib/agenda/grupos';
import { corpo, usuarioAgenda } from '@/lib/agenda/rota';

export const dynamic = 'force-dynamic';

/**
 * Antes de cadastrar um feriado: o que muda nos grupos do Impulsão (semana
 * pausada, conteúdo que anda ou aula perdida) e quantas reuniões já estão
 * marcadas no dia.
 */
export async function POST(req: NextRequest) {
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  const b = await corpo<{ data?: string; nome?: string }>(req);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.data ?? '')) return new NextResponse('Data inválida', { status: 400 });
  const data = b.data!;
  const novo: Feriado = { data, nome: b.nome?.trim() || 'Feriado', escopo: 'legacy' };
  const hoje = localYmd(new Date(), FUSO);
  const ate = addDays(data > hoje ? data : hoje, 120);
  const grupos = await gruposAtivos();
  const atuais = await carregarFeriados(new Date(), new Date(Date.parse(`${ate}T00:00:00Z`)));
  const impacto = previaImpactoFeriado(grupos.map(paraConfig), novo, atuais, hoje, ate);
  const nomes = new Map(grupos.map((g) => [g.id, g.nome]));

  const { count } = await createAdminSupabase()
    .from('meetings')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'scheduled')
    .gte('scheduled_start_at', instante(data, '00:00', FUSO).toISOString())
    .lt('scheduled_start_at', instante(addDays(data, 1), '00:00', FUSO).toISOString());

  return NextResponse.json({
    grupos: impacto.map((i) => ({ ...i, grupoNome: nomes.get(i.grupoId) ?? i.grupoId })),
    reunioesNoDia: count ?? 0,
  });
}
