import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { deleteCalendarEvent } from '@/lib/calendar';

export const dynamic = 'force-dynamic';

// Cancela uma reunião agendada: marca status=canceled (mantém histórico).
// scope='future' (para reunião de série recorrente) cancela esta e todas as
// ocorrências futuras da mesma série. Só o host dono (ou MASTER) pode cancelar.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });

  const { id, scope } = (await req.json().catch(() => ({}))) as {
    id?: string;
    scope?: 'single' | 'future';
  };
  if (!id) return new NextResponse('id obrigatório', { status: 400 });

  const admin = createAdminSupabase();
  const { data: meeting } = await admin
    .from('meetings')
    .select('host_id, recurrence_parent_id, scheduled_start_at')
    .eq('id', id)
    .maybeSingle();
  if (!meeting) return new NextResponse('Reunião não encontrada', { status: 404 });
  if (!user.isAdmin && meeting.host_id !== user.id)
    return new NextResponse('Não autorizado', { status: 403 });

  // Reuniões a cancelar: só esta, ou esta + futuras da mesma série.
  let targetIds = [id];
  if (scope === 'future' && meeting.recurrence_parent_id) {
    const { data: futures } = await admin
      .from('meetings')
      .select('id')
      .eq('recurrence_parent_id', meeting.recurrence_parent_id)
      .eq('status', 'scheduled')
      .gte('scheduled_start_at', meeting.scheduled_start_at as string);
    targetIds = ((futures ?? []) as { id: string }[]).map((m) => m.id);
    if (!targetIds.includes(id)) targetIds.push(id);
  }

  const { error } = await admin
    .from('meetings')
    .update({ status: 'canceled' })
    .in('id', targetIds);
  if (error) return new NextResponse('Falha ao cancelar: ' + error.message, { status: 500 });

  // Remove os eventos do Google Agenda (notifica os convidados) em segundo
  // plano — uma série pode ter dezenas de eventos. Não-fatal.
  after(async () => {
    try {
      const { data: secs } = await admin
        .from('meet_meeting_sector')
        .select('meeting_id, calendar_event_id')
        .in('meeting_id', targetIds);
      for (const sec of (secs ?? []) as { calendar_event_id: string | null }[]) {
        if (!sec.calendar_event_id) continue;
        try {
          await deleteCalendarEvent(sec.calendar_event_id);
        } catch (e) {
          console.error('[cancel] falha ao apagar evento do Google Agenda:', e);
        }
      }
    } catch (e) {
      console.error('[cancel] falha ao buscar eventos do Google Agenda:', e);
    }
  });

  return NextResponse.json({ ok: true, canceled: targetIds.length });
}
