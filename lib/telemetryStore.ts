import { randomBytes } from 'node:crypto';
import { listJsonKeys, readJson, writeJson } from './recordings';

const TELEMETRY_PREFIX = process.env.TELEMETRY_PREFIX ?? 'telemetry/';
const EVENT_RE = /^[a-z_]{3,40}$/;
const MAX_STR = 500;

export interface TelemetryRecord {
  evt: string;
  at: string;
  receivedAt: string;
  room?: string;
  identity?: string;
  isHost?: boolean;
  browser?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

const str = (v: unknown, max = MAX_STR) => (typeof v === 'string' ? v.slice(0, max) : undefined);

// Aceita só o formato que lib/telemetry.ts envia; corta strings longas e
// descarta o resto. `data` e `browser` são copiados rasos (valores primitivos
// ou objetos pequenos já limitados pelo tamanho total do payload).
export function validateTelemetry(body: unknown): TelemetryRecord | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const evt = str(b.evt, 40);
  if (!evt || !EVENT_RE.test(evt)) return null;
  const at = str(b.at, 40);
  const record: TelemetryRecord = {
    evt,
    at: at && !isNaN(Date.parse(at)) ? at : new Date().toISOString(),
    receivedAt: new Date().toISOString(),
  };
  const room = str(b.room, 80);
  if (room) record.room = room;
  const identity = str(b.identity, 120);
  if (identity) record.identity = identity;
  if (typeof b.isHost === 'boolean') record.isHost = b.isHost;
  if (b.browser && typeof b.browser === 'object') record.browser = b.browser as Record<string, unknown>;
  if (b.data && typeof b.data === 'object') record.data = b.data as Record<string, unknown>;
  return record;
}

export function telemetryKey(record: TelemetryRecord): string {
  const day = record.receivedAt.slice(0, 10);
  const stamp = record.receivedAt.replace(/[:.]/g, '-');
  return `${TELEMETRY_PREFIX}${day}/${stamp}-${randomBytes(3).toString('hex')}.json`;
}

export async function storeTelemetry(record: TelemetryRecord): Promise<void> {
  await writeJson(telemetryKey(record), record);
}

/** Teto de eventos lidos por dia: as chaves têm o horário no nome, então os
 *  mais recentes ficam no fim da listagem. Evita centenas de GETs no MinIO. */
export const MAX_TELEMETRY_PER_DAY = 1500;

export async function listTelemetry(date: string): Promise<TelemetryRecord[]> {
  const keys = await listJsonKeys(`${TELEMETRY_PREFIX}${date}/`);
  const recent = keys.slice(-MAX_TELEMETRY_PER_DAY);
  const items = await Promise.all(recent.map((k) => readJson<TelemetryRecord>(k)));
  return items.filter((r): r is TelemetryRecord => !!r).sort((a, b) => a.at.localeCompare(b.at));
}
