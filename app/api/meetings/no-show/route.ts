import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// Marca uma reunião agendada como no-show (o cliente não compareceu).
// Só o host dono ou admin; só depois do horário de início; a reunião sai da
// lista de próximas mas fica registrada no banco (métricas futuras).
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });

  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return new NextResponse('id obrigatório', { status: 400 });

  const admin = createAdminSupabase();
  const { data: meeting } = await admin
    .from('meetings')
    .select('host_id, status, scheduled_start_at')
    .eq('id', id)
    .maybeSingle();
  if (!meeting) return new NextResponse('Reunião não encontrada', { status: 404 });
  if (!user.isAdmin && meeting.host_id !== user.id)
    return new NextResponse('Não autorizado', { status: 403 });
  if (meeting.status !== 'scheduled')
    return new NextResponse('Só reuniões agendadas podem ser marcadas como no-show', {
      status: 400,
    });
  if (new Date(meeting.scheduled_start_at as string).getTime() > Date.now())
    return new NextResponse('A reunião ainda não chegou ao horário de início', { status: 400 });

  const { error } = await admin.from('meetings').update({ status: 'no_show' }).eq('id', id);
  if (error) return new NextResponse('Falha ao marcar no-show: ' + error.message, { status: 500 });

  return NextResponse.json({ ok: true });
}
