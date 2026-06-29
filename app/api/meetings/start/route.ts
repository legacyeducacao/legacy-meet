import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// Inicia uma reunião agendada: marca status=live e devolve o room_name.
// Só o host dono (ou MASTER) pode iniciar.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });

  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return new NextResponse('id obrigatório', { status: 400 });

  const admin = createAdminSupabase();
  const { data: meeting } = await admin
    .from('meetings')
    .select('host_id, room_name')
    .eq('id', id)
    .maybeSingle();
  if (!meeting) return new NextResponse('Reunião não encontrada', { status: 404 });
  if (!user.isAdmin && meeting.host_id !== user.id)
    return new NextResponse('Não autorizado', { status: 403 });

  await admin.from('meetings').update({ status: 'live' }).eq('id', id);
  return NextResponse.json({ roomName: meeting.room_name });
}
