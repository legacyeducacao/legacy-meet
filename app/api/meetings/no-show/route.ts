import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { isMeetingHost } from '@/lib/meetingHosts';
import { applyNoShow } from '@/lib/noShow';
import { ehSessaoDeKickoff, SO_PELA_AGENDA } from '@/lib/kickoff/servidor';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// Marca (ou desfaz) o no-show de uma reunião. Só o host dono, anfitrião adicional ou admin.
// Regras em lib/noShow.ts (mesmas da tela de saída do executor).
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });

  const { id, undo } = (await req.json().catch(() => ({}))) as { id?: string; undo?: boolean };
  if (!id) return new NextResponse('id obrigatório', { status: 400 });

  const { data: meeting } = await createAdminSupabase()
    .from('meetings')
    .select('host_id')
    .eq('id', id)
    .maybeSingle();
  if (!meeting) return new NextResponse('Reunião não encontrada', { status: 404 });
  // Anfitrião adicional (ex.: o Closer marcado pelo SDR) também pode.
  if (!user.isAdmin && !(await isMeetingHost({ id, host_id: meeting.host_id }, user.id)))
    return new NextResponse('Não autorizado', { status: 403 });
  // Kickoff: a ausência é por empresa (reservas), não da sessão inteira.
  if (await ehSessaoDeKickoff(id)) return new NextResponse(SO_PELA_AGENDA, { status: 409 });

  const r = await applyNoShow(id, !!undo);
  if (!r.ok) return new NextResponse(r.message, { status: r.httpStatus });
  return NextResponse.json({ ok: true, status: r.status });
}
