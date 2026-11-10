import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { corpo, soAdmin, usuarioAgenda } from '@/lib/agenda/rota';
import { limparTemplate } from '@/lib/agenda/templates';

export const dynamic = 'force-dynamic';

/** Modelos padrão criados na primeira vez (o admin edita depois). */
const PADRAO = [
  {
    nome: 'Impulsão',
    produto: 'impulsao',
    duracao_min: 120,
    rrule_padrao: 'FREQ=WEEKLY',
    hora_padrao: '19:00',
    sequencia: ['F1', 'F2', 'C1', 'C2'],
    defasagem_padrao: 0,
    entradas_permitidas: ['F1', 'C1'],
    politica_feriado: 'pausa',
    encontros_total: 4,
    campos_editaveis: ['dia_semana', 'hora', 'ancora', 'defasagem'],
  },
  {
    nome: 'Legado: jornada 1 a 1',
    produto: 'legado',
    duracao_min: 60,
    rrule_padrao: 'FREQ=WEEKLY;COUNT=12',
    hora_padrao: null,
    sequencia: [],
    defasagem_padrao: 0,
    entradas_permitidas: [],
    politica_feriado: 'pular',
    encontros_total: 12,
    limite_remarcacoes: 2,
    campos_editaveis: ['dia_semana', 'hora', 'duracao_min'],
  },
];

export async function GET() {
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  const admin = createAdminSupabase();
  let { data } = await admin.from('agenda_templates').select('*').order('criado_em');
  if (!data?.length) {
    await admin.from('agenda_templates').insert(PADRAO);
    ({ data } = await admin.from('agenda_templates').select('*').order('criado_em'));
  }
  return NextResponse.json({ templates: data ?? [], podeEditar: a.user.isAdmin });
}

/** Só admin cria modelos. */
export async function POST(req: NextRequest) {
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  if (!a.user.isAdmin) return soAdmin();
  const b = limparTemplate(await corpo<Record<string, unknown>>(req));
  if (!b.nome || !b.produto) return new NextResponse('Informe nome e produto', { status: 400 });
  const { data, error } = await createAdminSupabase()
    .from('agenda_templates')
    .insert({ ...b, criado_por: a.user.id })
    .select('*')
    .single();
  if (error) return new NextResponse('Falha ao salvar: ' + error.message, { status: 400 });
  return NextResponse.json({ template: data });
}
