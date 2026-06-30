import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { createCalendarEvent } from '@/lib/calendar';

export const dynamic = 'force-dynamic';

// Agenda uma reunião futura (status=scheduled). Mesmo padrão do /api/meetings/local,
// mas com data/hora vinda do corpo. Gera o room_name já (link estável).
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    sector?: 'comercial' | 'executoria';
    title?: string;
    tenantId?: string;
    startAt?: string; // ISO (UTC)
    record?: boolean;
    transcribe?: boolean;
  };

  const sector = body.sector === 'comercial' ? 'comercial' : 'executoria';
  const title = (body.title ?? '').trim();
  if (!title) return new NextResponse('Título da reunião é obrigatório', { status: 400 });
  const tenantId = sector === 'comercial' ? process.env.MEET_COMMERCIAL_TENANT_ID! : body.tenantId;
  if (!tenantId) return new NextResponse('Cliente (tenant) obrigatório para Executoria', { status: 400 });

  const start = body.startAt ? new Date(body.startAt) : null;
  if (!start || isNaN(start.getTime()))
    return new NextResponse('Data e hora inválidas', { status: 400 });
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const roomName = `meet_${crypto.randomUUID()}`;
  const admin = createAdminSupabase();
  const { data: meeting, error } = await admin
    .from('meetings')
    .insert({
      tenant_id: tenantId,
      host_id: user.id,
      title,
      room_name: roomName,
      scheduled_start_at: start.toISOString(),
      scheduled_end_at: end.toISOString(),
      status: 'scheduled',
      recording_enabled: body.record !== false,
      auto_transcribe: body.transcribe !== false,
    })
    .select('id')
    .single();
  if (error || !meeting)
    return new NextResponse('Falha ao agendar: ' + (error?.message ?? ''), { status: 500 });

  const { error: sectorError } = await admin
    .from('meet_meeting_sector')
    .insert({ meeting_id: meeting.id, sector });
  if (sectorError) {
    // não deixa reunião "fantasma" sem setor: desfaz e falha.
    await admin.from('meetings').delete().eq('id', meeting.id);
    return new NextResponse('Falha ao registrar o setor: ' + sectorError.message, { status: 500 });
  }

  // Google Agenda: cria o evento e convida executor + cliente (não-fatal —
  // se o Calendar falhar, a reunião continua agendada).
  try {
    const attendees: string[] = [];
    if (user.email) attendees.push(user.email);
    if (sector === 'executoria') {
      const { data: tenant } = await admin
        .from('client_tenants')
        .select('email')
        .eq('id', tenantId)
        .maybeSingle();
      if (tenant?.email) {
        attendees.push(tenant.email as string);
      } else {
        // fallback: e-mails dos usuários CLIENT do tenant
        const { data: clientUsers } = await admin
          .from('users')
          .select('email')
          .eq('tenant_id', tenantId)
          .eq('role', 'CLIENT');
        for (const u of (clientUsers ?? []) as { email: string | null }[]) {
          if (u.email) attendees.push(u.email);
        }
      }
    }
    if (attendees.length > 0) {
      const base = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
      await createCalendarEvent({
        summary: title,
        description: base
          ? `Reunião Legacy Meet.\nLink: ${base}/rooms/${roomName}`
          : 'Reunião Legacy Meet.',
        startISO: start.toISOString(),
        endISO: end.toISOString(),
        attendees,
      });
    }
  } catch (e) {
    console.error('[schedule] falha ao criar evento no Google Agenda (segue mesmo assim):', e);
  }

  return NextResponse.json({ id: meeting.id, roomName });
}
