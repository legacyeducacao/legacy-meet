import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// Marca (ou desfaz) o no-show de uma reunião. Só o host dono ou admin.
// Marcar: aceita reunião agendada (após o horário de início) ou realizada
// (host entrou na sala e o cliente não veio). Desfazer restaura o status
// verdadeiro: 'ended' se a reunião chegou a acontecer, senão 'scheduled'.
// O status persiste na tabela meetings (base para métricas de no-show).
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });

  const { id, undo } = (await req.json().catch(() => ({}))) as { id?: string; undo?: boolean };
  if (!id) return new NextResponse('id obrigatório', { status: 400 });

  const admin = createAdminSupabase();
  const { data: meeting } = await admin
    .from('meetings')
    .select('host_id, status, scheduled_start_at, started_at')
    .eq('id', id)
    .maybeSingle();
  if (!meeting) return new NextResponse('Reunião não encontrada', { status: 404 });
  if (!user.isAdmin && meeting.host_id !== user.id)
    return new NextResponse('Não autorizado', { status: 403 });

  if (undo) {
    if (meeting.status !== 'no_show')
      return new NextResponse('A reunião não está marcada como no-show', { status: 400 });
    const restored = meeting.started_at ? 'ended' : 'scheduled';
    const { error } = await admin.from('meetings').update({ status: restored }).eq('id', id);
    if (error)
      return new NextResponse('Falha ao desfazer no-show: ' + error.message, { status: 500 });
    return NextResponse.json({ ok: true, status: restored });
  }

  if (meeting.status !== 'scheduled' && meeting.status !== 'ended')
    return new NextResponse('Só reuniões agendadas ou realizadas podem virar no-show', {
      status: 400,
    });
  if (
    meeting.status === 'scheduled' &&
    new Date(meeting.scheduled_start_at as string).getTime() > Date.now()
  )
    return new NextResponse('A reunião ainda não chegou ao horário de início', { status: 400 });

  const { error } = await admin.from('meetings').update({ status: 'no_show' }).eq('id', id);
  if (error) return new NextResponse('Falha ao marcar no-show: ' + error.message, { status: 500 });

  return NextResponse.json({ ok: true, status: 'no_show' });
}
