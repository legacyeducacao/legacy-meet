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

/** Atualiza um evento existente (título/horário) e notifica os convidados. */
export async function updateCalendarEvent(
  eventId: string,
  patch: { summary?: string; description?: string; startISO?: string; endISO?: string },
): Promise<void> {
  const token = await getDriveAccessToken();
  const body: Record<string, unknown> = {};
  if (patch.summary !== undefined) body.summary = patch.summary;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.startISO) body.start = { dateTime: patch.startISO, timeZone: 'America/Sao_Paulo' };
  if (patch.endISO) body.end = { dateTime: patch.endISO, timeZone: 'America/Sao_Paulo' };
  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!resp.ok) {
    throw new Error(`calendar_update_failed ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
}

type Attendee = { email: string } & Record<string, unknown>;

/**
 * Lista nova de convidados: tira os removidos, acrescenta os novos. Os que
 * ficam são mantidos como vieram do Google (preserva a resposta ao convite).
 */
export function mergeAttendees(existing: Attendee[], add: string[], remove: string[]): Attendee[] {
  const norm = (e: string) => e.trim().toLowerCase();
  const out = existing.filter((a) => !remove.map(norm).includes(norm(a.email)));
  for (const email of add.map(norm).filter(Boolean)) {
    if (!out.some((a) => norm(a.email) === email)) out.push({ email });
  }
  return out;
}

/** Acrescenta/remove convidados de um evento e notifica quem entrou ou saiu. */
export async function changeCalendarAttendees(
  eventId: string,
  change: { add: string[]; remove: string[] },
): Promise<void> {
  if (!change.add.length && !change.remove.length) return;
  const token = await getDriveAccessToken();
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`;
  const get = await fetch(`${url}?fields=attendees`, { headers: { Authorization: `Bearer ${token}` } });
  if (!get.ok) throw new Error(`calendar_get_failed ${get.status}: ${(await get.text()).slice(0, 200)}`);
  const { attendees = [] } = (await get.json()) as { attendees?: Attendee[] };
  const resp = await fetch(`${url}?sendUpdates=all`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ attendees: mergeAttendees(attendees, change.add, change.remove) }),
  });
  if (!resp.ok) {
    throw new Error(`calendar_attendees_failed ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
}

/** Apaga um evento e notifica os convidados do cancelamento. */
export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const token = await getDriveAccessToken();
  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  );
  if (!resp.ok && resp.status !== 404 && resp.status !== 410) {
    throw new Error(`calendar_delete_failed ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
}
