import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { corpo, soAdmin, usuarioAgenda } from '@/lib/agenda/rota';
import { limparTemplate } from '@/lib/agenda/templates';

export const dynamic = 'force-dynamic';

/** Só admin edita modelos (sequência, defasagem, duração, feriado, campos liberados...). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  if (!a.user.isAdmin) return soAdmin();
  const b = limparTemplate(await corpo<Record<string, unknown>>(req));
  const { data, error } = await createAdminSupabase()
    .from('agenda_templates')
    .update({ ...b, atualizado_em: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) return new NextResponse('Falha ao salvar: ' + error.message, { status: 400 });
  return NextResponse.json({ template: data });
}
