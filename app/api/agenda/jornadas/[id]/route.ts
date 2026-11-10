import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { corpo, usuarioAgenda } from '@/lib/agenda/rota';

export const dynamic = 'force-dynamic';

/** Presença num encontro ({numero, presenca}) ou status da jornada. Executor da jornada ou admin. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  const admin = createAdminSupabase();
  const { data: j } = await admin.from('agenda_jornadas').select('executor_id').eq('id', id).maybeSingle();
  if (!j) return new NextResponse('Jornada não encontrada', { status: 404 });
  if (!a.user.isAdmin && j.executor_id !== a.user.id) return new NextResponse('Não autorizado', { status: 403 });
  const b = await corpo<{ numero?: number; presenca?: 'pendente' | 'presente' | 'faltou'; status?: 'ativa' | 'concluida' | 'pausada' | 'cancelada' }>(req);
  if (b.numero !== undefined && b.presenca) {
    if (!['pendente', 'presente', 'faltou'].includes(b.presenca)) return new NextResponse('Presença inválida', { status: 400 });
    const { error } = await admin.from('agenda_jornada_encontros').update({ presenca: b.presenca }).eq('jornada_id', id).eq('numero', b.numero);
    if (error) return new NextResponse(error.message, { status: 400 });
  }
  if (b.status) {
    if (!['ativa', 'concluida', 'pausada', 'cancelada'].includes(b.status)) return new NextResponse('Status inválido', { status: 400 });
    await admin.from('agenda_jornadas').update({ status: b.status, atualizado_em: new Date().toISOString() }).eq('id', id);
  }
  return NextResponse.json({ ok: true });
}
