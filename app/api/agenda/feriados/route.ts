import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { feriadosNacionais } from '@/lib/agenda-engine';
import { corpo, soAdmin, usuarioAgenda } from '@/lib/agenda/rota';

export const dynamic = 'force-dynamic';

/** Feriados do ano: nacionais (calculados) + cadastrados (estaduais, municipais, recessos). */
export async function GET(req: NextRequest) {
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  const ano = Number(req.nextUrl.searchParams.get('ano')) || new Date().getUTCFullYear();
  const { data } = await createAdminSupabase()
    .from('agenda_feriados')
    .select('*')
    .gte('data', `${ano}-01-01`)
    .lte('data', `${ano}-12-31`)
    .order('data');
  return NextResponse.json({ ano, nacionais: feriadosNacionais(ano), cadastrados: data ?? [], podeEditar: a.user.isAdmin });
}

/** Só admin cadastra (depois de ver a prévia do impacto). */
export async function POST(req: NextRequest) {
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  if (!a.user.isAdmin) return soAdmin();
  const b = await corpo<{ data?: string; nome?: string; escopo?: string; uf?: string | null; municipio?: string | null }>(req);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.data ?? '') || !b.nome?.trim()) return new NextResponse('Informe a data e o nome', { status: 400 });
  const escopo = ['estadual', 'municipal', 'legacy'].includes(b.escopo ?? '') ? b.escopo : 'legacy';
  const { data, error } = await createAdminSupabase()
    .from('agenda_feriados')
    .insert({
      data: b.data,
      nome: b.nome.trim(),
      escopo,
      uf: b.uf?.toUpperCase().slice(0, 2) || null,
      municipio: b.municipio?.trim() || null,
      criado_por: a.user.id,
    })
    .select('*')
    .single();
  if (error) return new NextResponse('Falha ao salvar: ' + error.message, { status: 400 });
  return NextResponse.json({ feriado: data });
}

export async function DELETE(req: NextRequest) {
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  if (!a.user.isAdmin) return soAdmin();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return new NextResponse('id obrigatório', { status: 400 });
  const { error } = await createAdminSupabase().from('agenda_feriados').delete().eq('id', id);
  if (error) return new NextResponse(error.message, { status: 400 });
  return NextResponse.json({ ok: true });
}
