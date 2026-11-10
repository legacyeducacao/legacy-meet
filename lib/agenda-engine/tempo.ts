/**
 * Datas e fuso horário do motor de agenda. Puro: sem Date.now(), sem fuso do
 * servidor. Instantes são `Date` (UTC); datas de calendário são 'YYYY-MM-DD'
 * (Ymd) e horas locais 'HH:MM' (Hm), sempre interpretadas num fuso IANA.
 * Usa só Intl (ICU do Node), então horário de verão (inclusive o histórico do
 * Brasil até 2019) é respeitado.
 */

export type Ymd = string;
export type Hm = string;
export const FUSO_PADRAO = 'America/Sao_Paulo';

export interface LocalDateTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second?: number;
}

const DAY_MS = 86_400_000;
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Instante -> data/hora de parede no fuso. */
export function utcToLocal(d: Date, tz: string = FUSO_PADRAO): Required<LocalDateTime> {
  const parts: Record<string, number> = {};
  for (const p of fmt(tz).formatToParts(d)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function offsetMs(instant: number, tz: string): number {
  const l = utcToLocal(new Date(instant), tz);
  const asUtc = Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute, l.second);
  return asUtc - (instant - (((instant % 1000) + 1000) % 1000));
}

function sameLocal(a: LocalDateTime, b: LocalDateTime): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;
}

/**
 * Data/hora de parede no fuso -> instante. Hora repetida (fim do horário de
 * verão): o primeiro instante. Hora que não existe (início do horário de
 * verão): empurra para frente, como o Google Agenda.
 */
export function localToUtc(l: LocalDateTime, tz: string = FUSO_PADRAO): Date {
  const t = Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute, l.second ?? 0);
  const antes = offsetMs(t - 1.5 * DAY_MS, tz);
  const depois = offsetMs(t + 1.5 * DAY_MS, tz);
  const candidatos = [...new Set([t - antes, t - depois])].filter((c) =>
    sameLocal(utcToLocal(new Date(c), tz), l),
  );
  if (candidatos.length) return new Date(Math.min(...candidatos));
  return new Date(t - Math.min(antes, depois));
}

// ------------------------------ Ymd / Hm ------------------------------

export function parseYmd(d: Ymd): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new Error(`data inválida: ${d}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function parseHm(h: Hm): { hour: number; minute: number } {
  const m = /^(\d{2}):(\d{2})$/.exec(h);
  if (!m || Number(m[1]) > 24 || Number(m[2]) > 59) throw new Error(`hora inválida: ${h}`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

const pad = (n: number) => String(n).padStart(2, '0');

function ymdFromUtcMs(ms: number): Ymd {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function ymdToUtcMs(d: Ymd): number {
  const { year, month, day } = parseYmd(d);
  return Date.UTC(year, month - 1, day);
}

export function addDays(d: Ymd, n: number): Ymd {
  return ymdFromUtcMs(ymdToUtcMs(d) + n * DAY_MS);
}

/** Dias de calendário de `a` até `b` (b - a). */
export function diffDays(a: Ymd, b: Ymd): number {
  return Math.round((ymdToUtcMs(b) - ymdToUtcMs(a)) / DAY_MS);
}

/** 1 = segunda ... 7 = domingo (ISO). */
export function weekdayIso(d: Ymd): number {
  const w = new Date(ymdToUtcMs(d)).getUTCDay();
  return w === 0 ? 7 : w;
}

/** Segunda-feira da semana de `d`. */
export function startOfWeek(d: Ymd): Ymd {
  return addDays(d, 1 - weekdayIso(d));
}

/** Semanas (segunda a domingo) de `a` até `b`; negativo se b vem antes. */
export function weeksBetween(a: Ymd, b: Ymd): number {
  return diffDays(startOfWeek(a), startOfWeek(b)) / 7;
}

/** Data local (no fuso) de um instante. */
export function localYmd(d: Date, tz: string = FUSO_PADRAO): Ymd {
  const l = utcToLocal(d, tz);
  return `${l.year}-${pad(l.month)}-${pad(l.day)}`;
}

/** Instante de `data` às `hora` no fuso. */
export function instante(data: Ymd, hora: Hm, tz: string = FUSO_PADRAO): Date {
  const { year, month, day } = parseYmd(data);
  const { hour, minute } = parseHm(hora);
  if (hour === 24) return localToUtc({ ...parseYmd(addDays(data, 1)), hour: 0, minute }, tz);
  return localToUtc({ year, month, day, hour, minute }, tz);
}

/** Datas de `de` até `ate`, inclusive. */
export function eachDay(de: Ymd, ate: Ymd): Ymd[] {
  const out: Ymd[] = [];
  for (let d = de; diffDays(d, ate) >= 0; d = addDays(d, 1)) out.push(d);
  return out;
}

export const mod = (n: number, m: number) => ((n % m) + m) % m;
export const MIN_MS = 60_000;
export const HORA_MS = 3_600_000;

// ------------------------------ Intervalos ------------------------------

/** Intervalo [inicio, fim) em ms. */
export type Iv = readonly [number, number];

export function mergeIv(ivs: readonly Iv[]): Iv[] {
  const s = ivs.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** a - b (o que sobra de `a` sem `b`). */
export function subtractIv(a: readonly Iv[], b: readonly Iv[]): Iv[] {
  let res: Iv[] = mergeIv(a);
  for (const [bs, be] of mergeIv(b)) {
    const next: Iv[] = [];
    for (const [s, e] of res) {
      if (be <= s || bs >= e) next.push([s, e]);
      else {
        if (bs > s) next.push([s, bs]);
        if (be < e) next.push([be, e]);
      }
    }
    res = next;
  }
  return res;
}

export function totalMs(ivs: readonly Iv[]): number {
  return mergeIv(ivs).reduce((t, [a, b]) => t + (b - a), 0);
}

export function overlapMs(a: readonly Iv[], b: readonly Iv[]): number {
  return totalMs(a) - totalMs(subtractIv(a, b));
}

export const overlaps = (a: Iv, b: Iv) => a[0] < b[1] && b[0] < a[1];
