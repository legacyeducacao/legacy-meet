import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { CO_HOSTS_SELECT, ownAndCoHosted, parseCoHosts } from '@/lib/meetingHosts';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// PostgREST embeds podem vir como objeto ou array de 1 — normaliza.
function one<T>(x: T | T[] | null | undefined): T | null {
  if (Array.isArray(x)) return x[0] ?? null;
  return x ?? null;
}

export type HistoryStatus = 'ended' | 'no_show' | 'scheduled' | 'live';

const LIMIT = 200;

// Histórico da Agenda: TODA reunião que já ficou para trás — encerrada,
// no-show, ou cuja data prevista já passou mesmo sem ter sido iniciada/
// encerrada (scheduled/live com scheduled_end_at no passado). É aqui que se
// marca/desfaz o no-show. Admin vê as reuniões de todo mundo (a UI filtra por
// setor e por pessoa); os demais veem as que criaram e as em que foram
// marcados como anfitrião adicional.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });

  const admin = createAdminSupabase();
  const nowIso = new Date().toISOString();
  // !inner em meet_meeting_sector: só reuniões criadas pelo Meet.
  const build = () =>
    admin
      .from('meetings')
      .select(
        `id, title, room_name, scheduled_start_at, status, host_id, recurrence_parent_id, users:host_id(name), client_tenants:tenant_id(name), meet_meeting_sector!inner(sector), ${CO_HOSTS_SELECT}`,
      )
      .or(`status.in.(ended,no_show),and(status.in.(scheduled,live),scheduled_end_at.lt.${nowIso})`)
      .order('scheduled_start_at', { ascending: false })
      .limit(LIMIT);

  const { data, error } = user.isAdmin ? await build() : await ownAndCoHosted(build, user.id);
  if (error)
    return new NextResponse('Erro ao buscar o histórico: ' + error.message, { status: 500 });

  const meetings = ((data ?? []) as any[])
    .map((m) => ({
      id: m.id as string,
      title: m.title as string,
      startAt: m.scheduled_start_at as string,
      status: m.status as HistoryStatus,
      hostId: (m.host_id ?? null) as string | null,
      hostName: (one<{ name: string | null }>(m.users)?.name ?? null) as string | null,
      coHosts: parseCoHosts(m.meet_meeting_hosts),
      clientName: (one<{ name: string | null }>(m.client_tenants)?.name ?? null) as string | null,
      sector: (one<{ sector: string | null }>(m.meet_meeting_sector)?.sector ?? null) as
        | string
        | null,
      recurrenceParentId: (m.recurrence_parent_id ?? null) as string | null,
    }))
    .sort((a, b) => b.startAt.localeCompare(a.startAt))
    .slice(0, LIMIT);

  return NextResponse.json({ meetings });
}
