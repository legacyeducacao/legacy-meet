/**
 * Mapeamento DETERMINÍSTICO de falantes por atividade de voz: durante a
 * chamada, o cliente do anfitrião registra no servidor "quem estava falando em
 * cada instante" (RoomEvent.ActiveSpeakersChanged do LiveKit — identidade real,
 * sem adivinhação). Aqui esses intervalos são cruzados com os horários das
 * falas diarizadas: o nome cuja atividade mais se sobrepõe às falas de um
 * rótulo (A, B, C…) é o dono daquele rótulo. O LLM vira reserva para o que
 * a atividade de voz não cobrir.
 */
import { norm } from './participants';
import type { Utterance } from './text';
import type { SpeakerMap } from './speakerMap';

/** Intervalo de fala de um participante, em ms de época (relógio do servidor). */
export interface SpeakerEvent {
  name: string;
  start: number;
  end: number;
}

export interface VoiceActivityOptions {
  /** Sobreposição mínima (s) do vencedor para confiar no rótulo. */
  minSeconds: number;
  /** Fatia mínima do vencedor sobre o total sobreposto do rótulo (0–1). */
  minShare: number;
  /** Folga (ms) nas bordas dos eventos — absorve atraso de detecção e clock. */
  padMs: number;
}

export const DEFAULT_VOICE_ACTIVITY: VoiceActivityOptions = {
  minSeconds: 5,
  minShare: 0.65,
  padMs: 1500,
};

/** Lê o speakers/<room>.json com tolerância a lixo (arquivo é append de rede). */
export function parseSpeakerEvents(raw: unknown): SpeakerEvent[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { events?: unknown }).events)
      ? ((raw as { events: unknown[] }).events as unknown[])
      : [];
  const out: SpeakerEvent[] = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const { name, start, end } = e as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim()) continue;
    const s = Number(start);
    const f = Number(end);
    if (!Number.isFinite(s) || !Number.isFinite(f) || f <= s) continue;
    out.push({ name: name.trim(), start: s, end: f });
  }
  return out;
}

export interface VoiceActivityResult {
  /** Apenas os rótulos resolvidos com confiança. */
  map: SpeakerMap;
  /** Sobreposição (s) por rótulo e nome — diagnóstico/log. */
  votes: Record<string, Record<string, number>>;
}

/**
 * Cruza as falas (tempos RELATIVOS à gravação, em segundos) com os intervalos
 * de atividade de voz (ms de época). `recordingStartMs` ancora os dois eixos.
 * Nomes dos eventos são canonicalizados para a grafia da lista de
 * participantes quando houver correspondência (sem caixa/acento).
 */
export function mapFromVoiceActivity(
  utts: Utterance[],
  events: SpeakerEvent[],
  recordingStartMs: number,
  participants: string[],
  opts: Partial<VoiceActivityOptions> = {},
): VoiceActivityResult {
  const { minSeconds, minShare, padMs } = { ...DEFAULT_VOICE_ACTIVITY, ...opts };
  const byNorm = new Map(participants.map((p) => [norm(p), p]));
  const canonical = (n: string) => byNorm.get(norm(n)) ?? n;

  const votes: Record<string, Record<string, number>> = {};
  for (const u of utts) {
    const us = recordingStartMs + u.start * 1000;
    const ue = recordingStartMs + u.end * 1000;
    if (!(ue > us)) continue;
    for (const ev of events) {
      const overlap = Math.min(ue, ev.end + padMs) - Math.max(us, ev.start - padMs);
      if (overlap <= 0) continue;
      const name = canonical(ev.name);
      const perLabel = (votes[u.speaker] ??= {});
      perLabel[name] = (perLabel[name] ?? 0) + overlap / 1000;
    }
  }

  const map: SpeakerMap = {};
  for (const [label, perName] of Object.entries(votes)) {
    const ranked = Object.entries(perName).sort((a, b) => b[1] - a[1]);
    if (!ranked.length) continue;
    const [winner, winnerSec] = ranked[0];
    const total = ranked.reduce((acc, [, s]) => acc + s, 0);
    if (winnerSec >= minSeconds && winnerSec / total >= minShare) {
      map[label] = winner;
    }
  }
  return { map, votes };
}

/**
 * Funde o mapa determinístico (vence sempre) com o mapa do LLM/eliminação.
 * Se o LLM deu a um rótulo um nome que a atividade de voz já provou ser de
 * OUTRO rótulo, essa entrada do LLM cai para o rótulo genérico — palpite não
 * contradiz medição.
 */
export function mergeSpeakerMaps(
  activityMap: SpeakerMap,
  llmMap: SpeakerMap,
  genericName: (label: string) => string,
): SpeakerMap {
  const activityNames = new Set(Object.values(activityMap).map((n) => norm(n)));
  const merged: SpeakerMap = {};
  for (const [label, name] of Object.entries(llmMap)) {
    if (label in activityMap) continue;
    merged[label] = activityNames.has(norm(name)) ? genericName(label) : name;
  }
  return { ...merged, ...activityMap };
}
