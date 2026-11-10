import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { usuarioAgenda } from '@/lib/agenda/rota';

export const dynamic = 'force-dynamic';

/** Remove o bloqueio (o próprio executor ou admin). */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  const admin = createAdminSupabase();
  const { data } = await admin.from('agenda_bloqueios').select('executor_id').eq('id', id).maybeSingle();
  if (!data) return new NextResponse('Bloqueio não encontrado', { status: 404 });
  if (!a.user.isAdmin && data.executor_id !== a.user.id) return new NextResponse('Não autorizado', { status: 403 });
  const { error } = await admin.from('agenda_bloqueios').delete().eq('id', id);
  if (error) return new NextResponse(error.message, { status: 400 });
  return NextResponse.json({ ok: true });
}
