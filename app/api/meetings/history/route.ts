import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// PostgREST embeds podem vir como objeto ou array de 1 — normaliza.
function one<T>(x: T | T[] | null | undefined): T | null {
  if (Array.isArray(x)) return x[0] ?? null;
  return x ?? null;
}

export type HistoryStatus = 'ended' | 'no_show' | 'scheduled' | 'live';

// Histórico da Agenda: TODA reunião que já ficou para trás — encerrada,
// no-show, ou cuja data prevista já passou mesmo sem ter sido iniciada/
// encerrada (scheduled/live com scheduled_end_at no passado). É aqui que se
// marca/desfaz o no-show. Admin vê as reuniões de todo mundo (a UI filtra por
// setor e por pessoa); os demais veem só as suas.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });

  const admin = createAdminSupabase();
  const nowIso = new Date().toISOString();
  // !inner em meet_meeting_sector: só reuniões criadas pelo Meet.
  let query = admin
    .from('meetings')
    .select(
      'id, title, room_name, scheduled_start_at, status, host_id, recurrence_parent_id, users:host_id(name), client_tenants:tenant_id(name), meet_meeting_sector!inner(sector)',
    )
    .or(`status.in.(ended,no_show),and(status.in.(scheduled,live),scheduled_end_at.lt.${nowIso})`)
    .order('scheduled_start_at', { ascending: false })
    .limit(200);
  if (!user.isAdmin) query = query.eq('host_id', user.id);

  const { data, error } = await query;
  if (error)
    return new NextResponse('Erro ao buscar o histórico: ' + error.message, { status: 500 });

  const meetings = ((data ?? []) as any[]).map((m) => ({
    id: m.id as string,
    title: m.title as string,
    startAt: m.scheduled_start_at as string,
    status: m.status as HistoryStatus,
    hostId: (m.host_id ?? null) as string | null,
    hostName: (one<{ name: string | null }>(m.users)?.name ?? null) as string | null,
    clientName: (one<{ name: string | null }>(m.client_tenants)?.name ?? null) as string | null,
    sector: (one<{ sector: string | null }>(m.meet_meeting_sector)?.sector ?? null) as
      | string
      | null,
    recurrenceParentId: (m.recurrence_parent_id ?? null) as string | null,
  }));

  return NextResponse.json({ meetings });
}
