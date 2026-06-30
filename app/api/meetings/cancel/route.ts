import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { deleteCalendarEvent } from '@/lib/calendar';

export const dynamic = 'force-dynamic';

// Cancela uma reunião agendada: marca status=canceled (mantém histórico).
// Só o host dono (ou MASTER) pode cancelar.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });

  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return new NextResponse('id obrigatório', { status: 400 });

  const admin = createAdminSupabase();
  const { data: meeting } = await admin
    .from('meetings')
    .select('host_id')
    .eq('id', id)
    .maybeSingle();
  if (!meeting) return new NextResponse('Reunião não encontrada', { status: 404 });
  if (!user.isAdmin && meeting.host_id !== user.id)
    return new NextResponse('Não autorizado', { status: 403 });

  await admin.from('meetings').update({ status: 'canceled' }).eq('id', id);

  // remove o evento do Google Agenda (notifica os convidados) — não-fatal
  try {
    const { data: sec } = await admin
      .from('meet_meeting_sector')
      .select('calendar_event_id')
      .eq('meeting_id', id)
      .maybeSingle();
    if (sec?.calendar_event_id) await deleteCalendarEvent(sec.calendar_event_id as string);
  } catch (e) {
    console.error('[cancel] falha ao apagar evento do Google Agenda:', e);
  }

  return NextResponse.json({ ok: true });
}
