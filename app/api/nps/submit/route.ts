import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    room?: string; score?: number; comment?: string; respondentName?: string;
  };
  const room = (body.room ?? '').trim();
  const score = Number(body.score);
  if (!room) return new NextResponse('room obrigatório', { status: 400 });
  if (!Number.isInteger(score) || score < 0 || score > 10)
    return new NextResponse('score deve ser inteiro 0–10', { status: 400 });

  const admin = createAdminSupabase();
  const { data: meeting } = await admin
    .from('meetings')
    .select('id, host_id, meet_meeting_sector!inner(sector)')
    .eq('room_name', room)
    .maybeSingle();
  const sector = Array.isArray((meeting as any)?.meet_meeting_sector)
    ? (meeting as any).meet_meeting_sector[0]?.sector
    : (meeting as any)?.meet_meeting_sector?.sector;
  if (!meeting || sector !== 'executoria')
    return new NextResponse('Reunião de Executoria não encontrada', { status: 404 });

  const { error } = await admin.from('meet_nps_responses').insert({
    meeting_id: (meeting as any).id,
    room_name: room,
    host_id: (meeting as any).host_id,
    score,
    comment: (body.comment ?? '').trim() || null,
    respondent_name: (body.respondentName ?? '').trim() || null,
  });
  if (error) {
    console.error('[nps/submit] insert falhou:', error);
    return new NextResponse('Não foi possível registrar a avaliação.', { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
