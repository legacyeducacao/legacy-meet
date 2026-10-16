/**
 * Watchdog das gravações: encerra o egress quando a reunião acabou mas a sala
 * continua viva. Caso real (Marvin, 15/10): o computador do cliente ficou com
 * a aba aberta e reconectando a noite toda; com alguém na sala o LiveKit não
 * fecha a sala e o gravador gravou 22h39min — a AssemblyAI recusou o áudio e a
 * reunião ficou sem transcrição. Regra: anfitrião (ou co-anfitrião) fora da
 * sala por mais que a tolerância, ou gravação acima do teto → para o egress.
 * Roda no processo do app (instrumentation.ts), a cada minuto.
 */
import { EgressClient, EgressStatus } from 'livekit-server-sdk';
import { HOST_ATTRIBUTE, parseCohosts } from './cohosts';
import { roomService } from './livekitAuth';
import { metaKey, readJson, type MeetingMeta } from './recordings';
import { norm } from '@/worker/lib/participants';

export { HOST_ATTRIBUTE };

export interface WatchdogConfig {
  /** Tempo sem anfitrião na sala até encerrar a gravação. */
  hostAbsentMs: number;
  /** Duração máxima de uma gravação, com ou sem anfitrião. */
  maxMs: number;
}

export interface ParticipantLike {
  identity: string;
  name: string;
  attributes?: Record<string, string>;
}

export function isHostParticipant(
  p: ParticipantLike,
  ctx: { roomMetadata?: string; metaHost?: string },
): boolean {
  if (p.attributes?.[HOST_ATTRIBUTE] === '1') return true;
  if (parseCohosts(ctx.roomMetadata).includes(p.identity)) return true;
  // Tokens emitidos antes do atributo existir: o anfitrião registrado no início
  // da gravação (meta.host) é o nome que ele digitou ao entrar.
  return !!ctx.metaHost?.trim() && !!p.name?.trim() && norm(p.name) === norm(ctx.metaHost);
}

export type EgressDecision =
  | { action: 'keep'; hostAbsentSinceMs?: number }
  | { action: 'stop'; reason: 'host_absent' | 'max_duration' };

export function decideEgress(
  s: { startedAtMs: number; nowMs: number; hostPresent: boolean; hostAbsentSinceMs?: number },
  cfg: WatchdogConfig,
): EgressDecision {
  if (s.startedAtMs > 0 && s.nowMs - s.startedAtMs >= cfg.maxMs) {
    return { action: 'stop', reason: 'max_duration' };
  }
  if (s.hostPresent) return { action: 'keep' };
  const since = s.hostAbsentSinceMs ?? s.nowMs;
  if (s.nowMs - since >= cfg.hostAbsentMs) return { action: 'stop', reason: 'host_absent' };
  return { action: 'keep', hostAbsentSinceMs: since };
}

const MIN = 60_000;

function configFromEnv(): WatchdogConfig {
  return {
    hostAbsentMs: Number(process.env.RECORDING_HOST_ABSENT_MINUTES ?? '10') * MIN,
    maxMs: Number(process.env.RECORDING_MAX_HOURS ?? '5') * 60 * MIN,
  };
}

function egressClient() {
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = process.env;
  const host = new URL(LIVEKIT_URL!);
  host.protocol = 'https:';
  return new EgressClient(host.origin, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
}

// Estado em memória: reiniciar o app só adia a parada em até uma tolerância.
const absentSince = new Map<string, number>();

export async function sweepRecordings(cfg: WatchdogConfig = configFromEnv()): Promise<void> {
  const egress = egressClient();
  const rooms = roomService();
  const active = (await egress.listEgress({ active: true })).filter(
    (e) => e.status === EgressStatus.EGRESS_STARTING || e.status === EgressStatus.EGRESS_ACTIVE,
  );
  const seen = new Set<string>();
  const nowMs = Date.now();

  for (const e of active) {
    seen.add(e.egressId);
    try {
      const [participants, roomList, meta] = await Promise.all([
        rooms.listParticipants(e.roomName),
        rooms.listRooms([e.roomName]),
        readJson<MeetingMeta>(metaKey(e.roomName)),
      ]);
      const ctx = { roomMetadata: roomList[0]?.metadata, metaHost: meta?.host };
      const hostPresent = participants
        .filter((p) => !p.identity.startsWith('EG_'))
        .some((p) => isHostParticipant(p, ctx));
      const decision = decideEgress(
        {
          startedAtMs: Number((e.startedAt ?? 0n) / 1_000_000n),
          nowMs,
          hostPresent,
          hostAbsentSinceMs: absentSince.get(e.egressId),
        },
        cfg,
      );
      if (decision.action === 'keep') {
        if (decision.hostAbsentSinceMs) absentSince.set(e.egressId, decision.hostAbsentSinceMs);
        else absentSince.delete(e.egressId);
        continue;
      }
      await egress.stopEgress(e.egressId);
      absentSince.delete(e.egressId);
      console.log(
        JSON.stringify({
          recordingWatchdog: 'stopped',
          egressId: e.egressId,
          room: e.roomName,
          reason: decision.reason,
          remaining: participants.map((p) => p.name || p.identity),
        }),
      );
    } catch (err) {
      console.error('recordingWatchdog:', e.roomName, err instanceof Error ? err.message : err);
    }
  }
  for (const id of absentSince.keys()) if (!seen.has(id)) absentSince.delete(id);
}

let started = false;

export function startRecordingWatchdog(intervalMs = MIN): void {
  if (started || !process.env.LIVEKIT_URL) return;
  started = true;
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    sweepRecordings()
      .catch((err) => console.error('recordingWatchdog: varredura falhou', err))
      .finally(() => {
        running = false;
      });
  }, intervalMs).unref?.();
}
