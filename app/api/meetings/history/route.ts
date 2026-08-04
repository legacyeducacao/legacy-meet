import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// PostgREST embeds podem vir como objeto ou array de 1 — normaliza.
function one<T>(x: T | T[] | null | undefined): T | null {
  if (Array.isArray(x)) return x[0] ?? null;
  return x ?? null;
}

// Histórico da Agenda: reuniões realizadas (ended) e no-shows do host logado,
// da mais recente para a mais antiga. Permite marcar/desfazer o no-show depois
// que a reunião saiu da lista de próximas.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });

  const admin = createAdminSupabase();
  // !inner em meet_meeting_sector: só reuniões criadas pelo Meet.
  const { data, error } = await admin
    .from('meetings')
    .select(
      'id, title, room_name, scheduled_start_at, status, host_id, recurrence_parent_id, users:host_id(name), client_tenants:tenant_id(name), meet_meeting_sector!inner(sector)',
    )
    .in('status', ['ended', 'no_show'])
    .eq('host_id', user.id)
    .order('scheduled_start_at', { ascending: false })
    .limit(100);
  if (error)
    return new NextResponse('Erro ao buscar o histórico: ' + error.message, { status: 500 });

  const meetings = ((data ?? []) as any[]).map((m) => ({
    id: m.id as string,
    title: m.title as string,
    startAt: m.scheduled_start_at as string,
    status: m.status as 'ended' | 'no_show',
    hostName: (one<{ name: string | null }>(m.users)?.name ?? null) as string | null,
    clientName: (one<{ name: string | null }>(m.client_tenants)?.name ?? null) as string | null,
    sector: (one<{ sector: string | null }>(m.meet_meeting_sector)?.sector ?? null) as
      | string
      | null,
    recurrenceParentId: (m.recurrence_parent_id ?? null) as string | null,
  }));

  return NextResponse.json({ meetings });
}
