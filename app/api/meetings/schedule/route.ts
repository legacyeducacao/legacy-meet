import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { createCalendarEvent } from '@/lib/calendar';
import { computeOccurrences, type Frequency } from '@/lib/recurrence';

export const dynamic = 'force-dynamic';

const FREQUENCIES: Frequency[] = ['daily', 'weekly', 'biweekly', 'monthly'];

// Agenda uma reunião futura (status=scheduled) — ou uma SÉRIE recorrente, com
// todas as ocorrências criadas em massa (cada uma com sala/link próprios,
// ligadas por recurrence_parent_id = id da primeira). Os eventos do Google
// Agenda são criados em segundo plano (after) para a tela responder na hora.
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
    recurrence?: {
      frequency?: string;
      until?: string; // 'yyyy-mm-dd' (inclusive) — exclusivo com count
      count?: number;
    };
  };

  const sector = body.sector === 'comercial' ? 'comercial' : 'executoria';
  const title = (body.title ?? '').trim();
  if (!title) return new NextResponse('Título da reunião é obrigatório', { status: 400 });
  const tenantId = sector === 'comercial' ? process.env.MEET_COMMERCIAL_TENANT_ID! : body.tenantId;
  if (!tenantId) return new NextResponse('Cliente (tenant) obrigatório para Executoria', { status: 400 });

  const start = body.startAt ? new Date(body.startAt) : null;
  if (!start || isNaN(start.getTime()))
    return new NextResponse('Data e hora inválidas', { status: 400 });

  // Datas da série (reunião avulsa = série de 1).
  let occurrences: Date[] = [start];
  let recurrenceRule: string | null = null;
  if (body.recurrence) {
    const frequency = body.recurrence.frequency as Frequency;
    if (!FREQUENCIES.includes(frequency)) {
      return new NextResponse('Frequência de repetição inválida', { status: 400 });
    }
    // Data limite chega como 'yyyy-mm-dd' — inclusiva até o fim do dia em São Paulo.
    const until = body.recurrence.until
      ? new Date(
          /^\d{4}-\d{2}-\d{2}$/.test(body.recurrence.until)
            ? `${body.recurrence.until}T23:59:59.999-03:00`
            : body.recurrence.until,
        )
      : undefined;
    if (until && isNaN(until.getTime())) {
      return new NextResponse('Data limite da repetição inválida', { status: 400 });
    }
    try {
      occurrences = computeOccurrences(start, { frequency, until, count: body.recurrence.count });
    } catch (e) {
      return new NextResponse(e instanceof Error ? e.message : 'Recorrência inválida', {
        status: 400,
      });
    }
    if (occurrences.length === 0) {
      return new NextResponse('A data limite é anterior à primeira reunião', { status: 400 });
    }
    recurrenceRule = until
      ? `${frequency};until=${until.toISOString().slice(0, 10)}`
      : `${frequency};count=${occurrences.length}`;
  }

  const ids = occurrences.map(() => crypto.randomUUID());
  const roomNames = occurrences.map(() => `meet_${crypto.randomUUID()}`);
  const isSeries = occurrences.length > 1;

  const rows = occurrences.map((occ, i) => ({
    id: ids[i],
    tenant_id: tenantId,
    host_id: user.id,
    title,
    room_name: roomNames[i],
    scheduled_start_at: occ.toISOString(),
    scheduled_end_at: new Date(occ.getTime() + 60 * 60 * 1000).toISOString(),
    status: 'scheduled',
    recording_enabled: body.record !== false,
    auto_transcribe: body.transcribe !== false,
    recurrence_parent_id: isSeries ? ids[0] : null,
    recurrence_rule: isSeries ? recurrenceRule : null,
  }));

  const admin = createAdminSupabase();
  const { error } = await admin.from('meetings').insert(rows);
  if (error) return new NextResponse('Falha ao agendar: ' + error.message, { status: 500 });

  const { error: sectorError } = await admin
    .from('meet_meeting_sector')
    .insert(ids.map((meetingId) => ({ meeting_id: meetingId, sector })));
  if (sectorError) {
    // não deixa reuniões "fantasma" sem setor: desfaz tudo e falha.
    await admin.from('meetings').delete().in('id', ids);
    return new NextResponse('Falha ao registrar o setor: ' + sectorError.message, { status: 500 });
  }

  // Google Agenda: um evento por ocorrência (com o link daquela sala), criados
  // em SEGUNDO PLANO — uma série de 52 não pode travar a resposta. Erros são
  // por ocorrência e não-fatais (a reunião continua agendada sem o evento).
  const attendees: string[] = [];
  try {
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
  } catch (e) {
    console.error('[schedule] falha ao resolver convidados do Calendar:', e);
  }

  if (attendees.length > 0) {
    const base = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
    after(async () => {
      for (let i = 0; i < occurrences.length; i++) {
        try {
          // A série pode ter sido cancelada/editada nos segundos entre a
          // resposta e este loop — só cria o convite se ainda estiver agendada.
          const { data: current } = await admin
            .from('meetings')
            .select('status')
            .eq('id', ids[i])
            .maybeSingle();
          if (!current || current.status !== 'scheduled') continue;
          const eventId = await createCalendarEvent({
            summary: title,
            description: base
              ? `Reunião Legacy Meet.\nLink: ${base}/rooms/${roomNames[i]}`
              : 'Reunião Legacy Meet.',
            startISO: occurrences[i].toISOString(),
            endISO: new Date(occurrences[i].getTime() + 60 * 60 * 1000).toISOString(),
            attendees,
          });
          if (eventId) {
            await admin
              .from('meet_meeting_sector')
              .update({ calendar_event_id: eventId })
              .eq('meeting_id', ids[i]);
          }
        } catch (e) {
          console.error(`[schedule] falha no evento do Calendar (ocorrência ${i + 1}):`, e);
        }
      }
    });
  }

  return NextResponse.json({ id: ids[0], roomName: roomNames[0], occurrences: ids.length });
}
