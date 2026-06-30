import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { updateCalendarEvent } from '@/lib/calendar';

export const dynamic = 'force-dynamic';

// Edita uma reunião agendada (título, data/hora, gravar/transcrever). Só o
// host dono ou um admin. Sincroniza o evento do Google Agenda (não-fatal).
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    startAt?: string; // ISO (UTC)
    record?: boolean;
    transcribe?: boolean;
  };

  const admin = createAdminSupabase();
  const { data: meeting } = await admin
    .from('meetings')
    .select('host_id')
    .eq('id', id)
    .maybeSingle();
  if (!meeting) return new NextResponse('Reunião não encontrada', { status: 404 });
  if (!user.isAdmin && meeting.host_id !== user.id)
    return new NextResponse('Não autorizado', { status: 403 });

  const update: Record<string, unknown> = {};
  const title = (body.title ?? '').trim();
  if (body.title !== undefined) {
    if (!title) return new NextResponse('Título da reunião é obrigatório', { status: 400 });
    update.title = title;
  }
  let start: Date | null = null;
  if (body.startAt !== undefined) {
    start = new Date(body.startAt);
    if (isNaN(start.getTime())) return new NextResponse('Data e hora inválidas', { status: 400 });
    update.scheduled_start_at = start.toISOString();
    update.scheduled_end_at = new Date(start.getTime() + 60 * 60 * 1000).toISOString();
  }
  if (body.record !== undefined) update.recording_enabled = body.record;
  if (body.transcribe !== undefined) update.auto_transcribe = body.transcribe;

  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true });

  const { error } = await admin.from('meetings').update(update).eq('id', id);
  if (error) return new NextResponse('Falha ao salvar: ' + error.message, { status: 500 });

  // sincroniza o evento do Google Agenda (notifica os convidados) — não-fatal
  try {
    const { data: sec } = await admin
      .from('meet_meeting_sector')
      .select('calendar_event_id')
      .eq('meeting_id', id)
      .maybeSingle();
    if (sec?.calendar_event_id) {
      await updateCalendarEvent(sec.calendar_event_id as string, {
        summary: body.title !== undefined ? title : undefined,
        startISO: start ? start.toISOString() : undefined,
        endISO: start ? new Date(start.getTime() + 60 * 60 * 1000).toISOString() : undefined,
      });
    }
  } catch (e) {
    console.error('[meetings/edit] falha ao atualizar evento no Google Agenda:', e);
  }

  return NextResponse.json({ ok: true });
}
