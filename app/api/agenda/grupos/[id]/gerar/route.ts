import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { gerarGrupo } from '@/lib/agenda/grupos';
import { corpo, usuarioAgenda } from '@/lib/agenda/rota';

export const dynamic = 'force-dynamic';

/** Gera (ou estende) os encontros do grupo até o horizonte. Admin ou o executor do grupo. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  const { data: g } = await createAdminSupabase().from('agenda_grupos').select('executor_id').eq('id', id).maybeSingle();
  if (!g) return new NextResponse('Grupo não encontrado', { status: 404 });
  if (!a.user.isAdmin && g.executor_id !== a.user.id) return new NextResponse('Só o executor do grupo ou um admin', { status: 403 });
  const b = await corpo<{ justificativa?: string }>(req);
  const r = await gerarGrupo(id, a.user, { justificativa: b.justificativa });
  if (!r.ok) {
    if ('conflito' in r) return NextResponse.json(r.conflito, { status: 409 });
    return new NextResponse(r.erro, { status: 400 });
  }
  return NextResponse.json(r);
}
