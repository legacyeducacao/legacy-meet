import { getDriveAccessToken } from './drive';

export interface CalendarEventInput {
  summary: string;
  description?: string;
  startISO: string; // RFC3339/ISO (UTC ok)
  endISO: string;
  attendees: string[]; // e-mails dos convidados
}

/**
 * Cria um evento no Google Agenda da conta de integração e convida os
 * `attendees` (executor + cliente). Com `sendUpdates=all`, o Google envia o
 * convite e coloca o evento na agenda do Gmail de cada convidado.
 *
 * Requer que o GOOGLE_OAUTH_REFRESH_TOKEN tenha o escopo
 * `https://www.googleapis.com/auth/calendar.events` (além do escopo do Drive).
 * Reaproveita o mesmo OAuth do Drive (o access token vale para todos os
 * escopos concedidos ao refresh token).
 */
export async function createCalendarEvent(input: CalendarEventInput): Promise<string | null> {
  const emails = [
    ...new Set(input.attendees.map((e) => e.trim().toLowerCase()).filter(Boolean)),
  ];
  if (emails.length === 0) return null;

  const token = await getDriveAccessToken();
  const resp = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: input.summary,
        description: input.description,
        start: { dateTime: input.startISO, timeZone: 'America/Sao_Paulo' },
        end: { dateTime: input.endISO, timeZone: 'America/Sao_Paulo' },
        attendees: emails.map((email) => ({ email })),
        reminders: { useDefault: true },
      }),
    },
  );
  if (!resp.ok) {
    throw new Error(
      `calendar_insert_failed ${resp.status}: ${(await resp.text()).slice(0, 200)}`,
    );
  }
  const data = (await resp.json()) as { id?: string };
  return data.id ?? null;
}
