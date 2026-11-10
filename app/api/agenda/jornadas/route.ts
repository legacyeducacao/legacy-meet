import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { matricular } from '@/lib/agenda/grupos';
import { corpo, usuarioAgenda } from '@/lib/agenda/rota';

export const dynamic = 'force-dynamic';

/** Jornadas (Impulsão e Legado) com encontros e progresso. ?grupoId= ou ?tenantId= */
export async function GET(req: NextRequest) {
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  const grupoId = req.nextUrl.searchParams.get('grupoId');
  const tenantId = req.nextUrl.searchParams.get('tenantId');
  let q = createAdminSupabase()
    .from('agenda_jornadas')
    .select('*, client_tenants(name), agenda_jornada_encontros(numero, rotulo, data, grupo_id, meeting_id, recuperacao, presenca)')
    .order('inicio', { ascending: false })
    .limit(300);
  if (grupoId) q = q.eq('grupo_id', grupoId);
  if (tenantId) q = q.eq('tenant_id', tenantId);
  if (!a.user.isAdmin) q = q.eq('executor_id', a.user.id);
  const { data, error } = await q;
  if (error) return new NextResponse(error.message, { status: 500 });
  const hoje = new Date().toISOString().slice(0, 10);
  return NextResponse.json({
    jornadas: ((data ?? []) as Array<Record<string, unknown> & { agenda_jornada_encontros: Array<{ numero: number; data: string | null; presenca: string }>; encontros_previstos: number; client_tenants: { name: string } | null }>).map((j) => {
      const encontros = [...j.agenda_jornada_encontros].sort((x, y) => x.numero - y.numero);
      const feitos = encontros.filter((e) => e.data && e.data < hoje).length;
      return { ...j, cliente: j.client_tenants?.name ?? null, agenda_jornada_encontros: encontros, progresso: `${feitos}/${j.encontros_previstos}` };
    }),
  });
}

/** Matricula o cliente no Impulsão (entrada sugerida pela regra + 4 encontros). */
export async function POST(req: NextRequest) {
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  const b = await corpo<{ tenantId?: string; grupoId?: string; diaSemana?: number; aPartirDe?: string }>(req);
  if (!b.tenantId) return new NextResponse('Selecione o cliente', { status: 400 });
  const { data: t } = await createAdminSupabase().from('client_tenants').select('executor_id').eq('id', b.tenantId).maybeSingle();
  if (!t) return new NextResponse('Cliente não encontrado', { status: 404 });
  if (!a.user.isAdmin && t.executor_id !== a.user.id) return new NextResponse('Só clientes da sua carteira', { status: 403 });
  const r = await matricular(b.tenantId, a.user, { grupoId: b.grupoId, diaSemana: b.diaSemana, aPartirDe: b.aPartirDe });
  if (!r.ok) {
    if (r.conflito) return NextResponse.json(r.conflito, { status: 409 });
    return new NextResponse(r.erro, { status: 400 });
  }
  return NextResponse.json(r);
}
