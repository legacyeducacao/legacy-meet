import { NextResponse } from 'next/server';
import { getCurrentUser, canSeeNps } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });
  if (!canSeeNps(user)) return new NextResponse('Sem acesso ao NPS', { status: 403 });

  const admin = createAdminSupabase();
  let q = admin
    .from('meet_nps_responses')
    .select('id, meeting_id, host_id, score, comment, respondent_name, created_at, meetings:meeting_id(title), users:host_id(name)')
    .order('created_at', { ascending: false });
  if (!user.isAdmin) q = q.eq('host_id', user.id);
  const { data, error } = await q;
  if (error) return new NextResponse('Erro ao buscar NPS: ' + error.message, { status: 500 });

  const responses = ((data ?? []) as any[]).map((r) => ({
    id: r.id as string,
    meetingId: r.meeting_id as string | null,
    title: (Array.isArray(r.meetings) ? r.meetings[0]?.title : r.meetings?.title) ?? null,
    createdAt: r.created_at as string,
    score: r.score as number,
    comment: (r.comment as string) ?? null,
    respondentName: (r.respondent_name as string) ?? null,
    hostName: (Array.isArray(r.users) ? r.users[0]?.name : r.users?.name) ?? null,
    hostId: r.host_id as string | null,
  }));
  return NextResponse.json({ responses });
}
