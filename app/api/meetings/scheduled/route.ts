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

// Próximas: reuniões agendadas cujo horário de término previsto ainda não
// passou (as que passaram vão para o Histórico, onde se marca o no-show).
// Admin vê as de todo mundo (UI filtra por setor/pessoa); demais veem as que
// criaram e as em que foram marcados como anfitrião adicional.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });

  const admin = createAdminSupabase();
  const nowIso = new Date().toISOString();
  // !inner em meet_meeting_sector: traz SOMENTE reuniões criadas pelo Meet
  // (ignora as do Planner do Legacy Plan, que compartilham a tabela `meetings`).
  const build = () =>
    admin
      .from('meetings')
      .select(
        `id, title, room_name, scheduled_start_at, recording_enabled, auto_transcribe, host_id, recurrence_parent_id, users:host_id(name), client_tenants:tenant_id(name), meet_meeting_sector!inner(sector), ${CO_HOSTS_SELECT}`,
      )
      .eq('status', 'scheduled')
      .gte('scheduled_end_at', nowIso)
      .order('scheduled_start_at', { ascending: true });

  const { data, error } = user.isAdmin ? await build() : await ownAndCoHosted(build, user.id);
  if (error) return new NextResponse('Erro ao buscar a agenda: ' + error.message, { status: 500 });

  const meetings = ((data ?? []) as any[])
    .map((m) => ({
      id: m.id as string,
      title: m.title as string,
      roomName: m.room_name as string,
      startAt: m.scheduled_start_at as string,
      record: m.recording_enabled !== false,
      transcribe: m.auto_transcribe !== false,
      recurrenceParentId: (m.recurrence_parent_id ?? null) as string | null,
      hostId: (m.host_id ?? null) as string | null,
      hostName: (one<{ name: string | null }>(m.users)?.name ?? null) as string | null,
      coHosts: parseCoHosts(m.meet_meeting_hosts),
      clientName: (one<{ name: string | null }>(m.client_tenants)?.name ?? null) as string | null,
      sector: (one<{ sector: string | null }>(m.meet_meeting_sector)?.sector ?? null) as string | null,
    }))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));

  return NextResponse.json({ meetings });
}
