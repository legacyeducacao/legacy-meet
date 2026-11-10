/**
 * Criação de reuniões agendadas (uma ou uma série), usada pela Agenda atual
 * (/api/meetings/schedule) e pela agenda nova (/api/agenda/eventos). Cada
 * ocorrência é uma linha em public.meetings com sala própria, setor,
 * anfitriões adicionais e convite no Google Agenda (em segundo plano).
 */
import { after } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { createCalendarEvent } from '@/lib/calendar';

export interface MembroEquipe {
  id: string;
  email?: string | null;
}

export interface CriarReunioesInput {
  /** Anfitrião (executor) das reuniões. */
  hostId: string;
  /** E-mail do anfitrião (recebe o convite). */
  hostEmail?: string | null;
  sector: 'executoria' | 'comercial';
  tenantId: string;
  title: string;
  ocorrencias: Array<{ inicio: Date; fim: Date }>;
  record: boolean;
  transcribe: boolean;
  onboarding: boolean;
  /** Já normalizados (só equipe, sem o anfitrião). */
  coHostIds: string[];
  team: MembroEquipe[];
  guestEmails: string[];
  /** Texto gravado em meetings.recurrence_rule quando há mais de uma. */
  recurrenceRule: string | null;
}

export type CriarReunioesResult =
  | { ok: true; ids: string[]; roomNames: string[] }
  | { ok: false; status: number; message: string };

export async function criarReunioes(i: CriarReunioesInput): Promise<CriarReunioesResult> {
  if (!i.ocorrencias.length) return { ok: false, status: 400, message: 'Nenhuma ocorrência para criar' };
  const ids = i.ocorrencias.map(() => crypto.randomUUID());
  const roomNames = i.ocorrencias.map(() => `meet_${crypto.randomUUID()}`);
  const isSeries = i.ocorrencias.length > 1;

  const rows = i.ocorrencias.map((occ, k) => ({
    id: ids[k],
    tenant_id: i.tenantId,
    host_id: i.hostId,
    title: i.title,
    room_name: roomNames[k],
    scheduled_start_at: occ.inicio.toISOString(),
    scheduled_end_at: occ.fim.toISOString(),
    status: 'scheduled',
    recording_enabled: i.record,
    auto_transcribe: i.transcribe,
    recurrence_parent_id: isSeries ? ids[0] : null,
    recurrence_rule: isSeries ? i.recurrenceRule : null,
  }));

  const admin = createAdminSupabase();
  const { error } = await admin.from('meetings').insert(rows);
  if (error) return { ok: false, status: 500, message: 'Falha ao agendar: ' + error.message };

  const { error: sectorError } = await admin.from('meet_meeting_sector').insert(
    ids.map((meetingId) => ({
      meeting_id: meetingId,
      sector: i.sector,
      onboarding: i.sector === 'executoria' && i.onboarding,
    })),
  );
  if (sectorError) {
    // não deixa reuniões "fantasma" sem setor: desfaz tudo e falha.
    await admin.from('meetings').delete().in('id', ids);
    return { ok: false, status: 500, message: 'Falha ao registrar o setor: ' + sectorError.message };
  }

  if (i.coHostIds.length) {
    const { error: hostsError } = await admin
      .from('meet_meeting_hosts')
      .insert(ids.flatMap((meetingId) => i.coHostIds.map((userId) => ({ meeting_id: meetingId, user_id: userId }))));
    if (hostsError) {
      await admin.from('meetings').delete().in('id', ids);
      return { ok: false, status: 500, message: 'Falha ao registrar os anfitriões: ' + hostsError.message };
    }
  }

  // Google Agenda: um evento por ocorrência (com o link daquela sala), criados
  // em SEGUNDO PLANO: uma série de 52 não pode travar a resposta. Erros são
  // por ocorrência e não fatais (a reunião continua agendada sem o evento).
  const attendees: string[] = [];
  try {
    if (i.hostEmail) attendees.push(i.hostEmail);
    for (const m of i.team) if (i.coHostIds.includes(m.id) && m.email) attendees.push(m.email);
    attendees.push(...i.guestEmails);
    if (i.sector === 'executoria') {
      const { data: tenant } = await admin.from('client_tenants').select('email').eq('id', i.tenantId).maybeSingle();
      if (tenant?.email) {
        attendees.push(tenant.email as string);
      } else {
        // fallback: e-mails dos usuários CLIENT do tenant
        const { data: clientUsers } = await admin
          .from('users')
          .select('email')
          .eq('tenant_id', i.tenantId)
          .eq('role', 'CLIENT');
        for (const u of (clientUsers ?? []) as { email: string | null }[]) {
          if (u.email) attendees.push(u.email);
        }
      }
    }
  } catch (e) {
    console.error('[reunioes] falha ao resolver convidados do Calendar:', e);
  }

  if (attendees.length > 0) {
    const base = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
    after(async () => {
      for (let k = 0; k < i.ocorrencias.length; k++) {
        try {
          // A série pode ter sido cancelada/editada nos segundos entre a
          // resposta e este loop: só cria o convite se ainda estiver agendada.
          const { data: current } = await admin
            .from('meetings')
            .select('status, scheduled_start_at, scheduled_end_at')
            .eq('id', ids[k])
            .maybeSingle();
          if (!current || current.status !== 'scheduled') continue;
          const eventId = await createCalendarEvent({
            summary: i.title,
            description: base ? `Reunião Legacy Meet.\nLink: ${base}/rooms/${roomNames[k]}` : 'Reunião Legacy Meet.',
            startISO: new Date(current.scheduled_start_at as string).toISOString(),
            endISO: new Date(current.scheduled_end_at as string).toISOString(),
            attendees,
          });
          if (eventId) {
            await admin.from('meet_meeting_sector').update({ calendar_event_id: eventId }).eq('meeting_id', ids[k]);
          }
        } catch (e) {
          console.error(`[reunioes] falha no evento do Calendar (ocorrência ${k + 1}):`, e);
        }
      }
    });
  }

  return { ok: true, ids, roomNames };
}
