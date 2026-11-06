import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { isMeetingHost } from '@/lib/meetingHosts';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { findPreviousSummary } from '@/lib/meetingSummary';

export const dynamic = 'force-dynamic';

/**
 * Resumo da última reunião da Executoria com o mesmo cliente, para o executor
 * se preparar para esta. Quem pode ver esta reunião (anfitrião, anfitrião
 * adicional ou admin) vê o resumo anterior, mesmo que outro executor tenha
 * conduzido aquela.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });

  const { data: m } = await createAdminSupabase()
    .from('meetings')
    .select('id, host_id, tenant_id, room_name, scheduled_start_at, started_at')
    .eq('id', id)
    .maybeSingle();
  if (!m) return new NextResponse('Reunião não encontrada', { status: 404 });
  if (!user.isAdmin && !(await isMeetingHost({ id: m.id, host_id: m.host_id }, user.id)))
    return new NextResponse('Não autorizado', { status: 403 });
  if (!m.tenant_id) return NextResponse.json({ resumo: null });

  const before = m.started_at ?? m.scheduled_start_at ?? new Date().toISOString();
  const resumo = await findPreviousSummary(m.tenant_id, before, m.room_name ?? undefined);
  return NextResponse.json({ resumo });
}
