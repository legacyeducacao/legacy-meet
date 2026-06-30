import { NextResponse } from 'next/server';
import { getCurrentUser, canSeeNps } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// PostgREST embeds podem vir como objeto ou array de 1 — normaliza.
function one<T>(x: T | T[] | null | undefined): T | null {
  if (Array.isArray(x)) return x[0] ?? null;
  return x ?? null;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });
  if (!canSeeNps(user)) return new NextResponse('Sem acesso ao NPS', { status: 403 });

  const admin = createAdminSupabase();
  let q = admin
    .from('meet_nps_responses')
    .select(
      'id, meeting_id, host_id, score, comment, respondent_name, created_at, meetings:meeting_id(title, client_tenants:tenant_id(name)), users:host_id(name)',
    )
    .order('created_at', { ascending: false });
  if (!user.isAdmin) q = q.eq('host_id', user.id);
  const { data, error } = await q;
  if (error) return new NextResponse('Erro ao buscar NPS: ' + error.message, { status: 500 });

  const responses = ((data ?? []) as any[]).map((r) => {
    const meeting = one<{ title?: string | null; client_tenants?: { name?: string | null } | { name?: string | null }[] | null }>(r.meetings);
    const client = one<{ name?: string | null }>(meeting?.client_tenants);
    return {
      id: r.id as string,
      meetingId: r.meeting_id as string | null,
      title: (meeting?.title as string | null) ?? null,
      clientName: (client?.name as string | null) ?? null,
      createdAt: r.created_at as string,
      score: r.score as number,
      comment: (r.comment as string) ?? null,
      respondentName: (r.respondent_name as string) ?? null,
      hostName: (one<{ name?: string | null }>(r.users)?.name as string | null) ?? null,
      hostId: r.host_id as string | null,
    };
  });
  return NextResponse.json({ responses });
}
