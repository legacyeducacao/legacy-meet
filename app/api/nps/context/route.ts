import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const room = req.nextUrl.searchParams.get('room') ?? '';
  if (!room) return NextResponse.json({ needsNps: false });

  // staff logado não responde NPS
  const me = await getCurrentUser();
  if (me?.isStaff) return NextResponse.json({ needsNps: false });

  const admin = createAdminSupabase();
  const { data } = await admin
    .from('meetings')
    .select('id, title, users:host_id(name), meet_meeting_sector!inner(sector)')
    .eq('room_name', room)
    .maybeSingle();
  const sector = Array.isArray((data as any)?.meet_meeting_sector)
    ? (data as any).meet_meeting_sector[0]?.sector
    : (data as any)?.meet_meeting_sector?.sector;
  if (!data || sector !== 'executoria') return NextResponse.json({ needsNps: false });
  const hostName = Array.isArray((data as any).users)
    ? (data as any).users[0]?.name
    : (data as any).users?.name;
  return NextResponse.json({ needsNps: true, meetingId: (data as any).id, hostName: hostName ?? null });
}
