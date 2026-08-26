import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// PostgREST embeds podem vir como objeto ou array de 1 — normaliza.
function one<T>(x: T | T[] | null | undefined): T | null {
  if (Array.isArray(x)) return x[0] ?? null;
  return x ?? null;
}

// Próximas: reuniões agendadas cujo horário de término previsto ainda não
// passou (as que passaram vão para o Histórico, onde se marca o no-show).
// Admin vê as de todo mundo (UI filtra por setor/pessoa); demais só as suas.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });

  const admin = createAdminSupabase();
  // !inner em meet_meeting_sector: traz SOMENTE reuniões criadas pelo Meet
  // (ignora as do Planner do Legacy Plan, que compartilham a tabela `meetings`).
  let query = admin
    .from('meetings')
    .select(
      'id, title, room_name, scheduled_start_at, recording_enabled, auto_transcribe, host_id, recurrence_parent_id, users:host_id(name), client_tenants:tenant_id(name), meet_meeting_sector!inner(sector)',
    )
    .eq('status', 'scheduled')
    .gte('scheduled_end_at', new Date().toISOString())
    .order('scheduled_start_at', { ascending: true });
  if (!user.isAdmin) query = query.eq('host_id', user.id);

  const { data, error } = await query;
  if (error) return new NextResponse('Erro ao buscar a agenda: ' + error.message, { status: 500 });

  const meetings = ((data ?? []) as any[]).map((m) => ({
    id: m.id as string,
    title: m.title as string,
    roomName: m.room_name as string,
    startAt: m.scheduled_start_at as string,
    record: m.recording_enabled !== false,
    transcribe: m.auto_transcribe !== false,
    recurrenceParentId: (m.recurrence_parent_id ?? null) as string | null,
    hostId: (m.host_id ?? null) as string | null,
    hostName: (one<{ name: string | null }>(m.users)?.name ?? null) as string | null,
    clientName: (one<{ name: string | null }>(m.client_tenants)?.name ?? null) as string | null,
    sector: (one<{ sector: string | null }>(m.meet_meeting_sector)?.sector ?? null) as string | null,
  }));

  return NextResponse.json({ meetings });
}
