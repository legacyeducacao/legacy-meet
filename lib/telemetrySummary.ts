import type { TelemetryRecord } from './telemetryStore';

/**
 * Resume os eventos de telemetria de um dia em três perguntas práticas:
 * por onde a mídia está passando, quanto a conexão caiu e quantos usuários
 * tiveram problema de câmera ou microfone.
 */
export interface TransportSummary {
  udp: number;
  tcp: number;
  relay: number;
  degraded: number;
  total: number;
  /** Latência mediana medida até o servidor, em milissegundos. */
  medianRttMs: number | null;
}

export interface StabilitySummary {
  reconnecting: number;
  reconnected: number;
  gaveUp: number;
  poorQuality: number;
  /** Mediana do tempo que as quedas duraram, em milissegundos. */
  medianOutageMs: number | null;
}

export interface DeviceSummary {
  mediaErrors: number;
  enableFailed: number;
  permissionDenied: number;
  iframeBlocked: number;
  connectFailed: number;
}

export type TransportVerdict = 'sem-dados' | 'udp-ok' | 'misto' | 'degradado';

export interface TelemetrySummary {
  total: number;
  rooms: number;
  transport: TransportSummary;
  stability: StabilitySummary;
  devices: DeviceSummary;
  verdict: TransportVerdict;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) ? v : undefined);

export function summarizeTelemetry(events: TelemetryRecord[]): TelemetrySummary {
  const transport: TransportSummary = { udp: 0, tcp: 0, relay: 0, degraded: 0, total: 0, medianRttMs: null };
  const stability: StabilitySummary = {
    reconnecting: 0,
    reconnected: 0,
    gaveUp: 0,
    poorQuality: 0,
    medianOutageMs: null,
  };
  const devices: DeviceSummary = {
    mediaErrors: 0,
    enableFailed: 0,
    permissionDenied: 0,
    iframeBlocked: 0,
    connectFailed: 0,
  };
  const rooms = new Set<string>();
  const rtts: number[] = [];
  const outages: number[] = [];

  for (const e of events) {
    if (e.room) rooms.add(e.room);
    const data = e.data ?? {};
    switch (e.evt) {
      case 'ice_transport': {
        transport.total += 1;
        // relay é contado à parte: é TURN, o caminho mais lento de todos.
        if (data.candidateType === 'relay') transport.relay += 1;
        else if (data.protocol === 'tcp') transport.tcp += 1;
        else if (data.protocol === 'udp') transport.udp += 1;
        if (data.degraded === true) transport.degraded += 1;
        const rtt = num(data.roundTripTimeMs);
        if (rtt !== undefined) rtts.push(rtt);
        break;
      }
      case 'reconnecting':
        stability.reconnecting += 1;
        break;
      case 'reconnected': {
        stability.reconnected += 1;
        const outage = num(data.outageMs);
        if (outage !== undefined) outages.push(outage);
        break;
      }
      case 'reconnect_gave_up':
        stability.gaveUp += 1;
        break;
      case 'connection_quality':
        stability.poorQuality += 1;
        break;
      case 'media_error':
      case 'prejoin_error':
        devices.mediaErrors += 1;
        break;
      case 'device_enable_failed':
        devices.enableFailed += 1;
        break;
      case 'iframe_permissions_blocked':
        devices.iframeBlocked += 1;
        break;
      case 'connect_failed':
      case 'connection_details_failed':
        devices.connectFailed += 1;
        break;
      default:
        break;
    }
    // Permissão negada vale destacar: é o único caso em que o próprio usuário
    // resolve, liberando no cadeado do navegador.
    const errName = (data.error as { name?: unknown } | undefined)?.name;
    if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
      devices.permissionDenied += 1;
    }
  }

  transport.medianRttMs = median(rtts);
  stability.medianOutageMs = median(outages);

  let verdict: TransportVerdict = 'sem-dados';
  if (transport.total > 0) {
    const share = transport.degraded / transport.total;
    verdict = share >= 0.8 ? 'degradado' : share >= 0.2 ? 'misto' : 'udp-ok';
  }

  return { total: events.length, rooms: rooms.size, transport, stability, devices, verdict };
}

/** Frase que explica o veredito e diz o que fazer. */
export function verdictMessage(verdict: TransportVerdict): string {
  switch (verdict) {
    case 'udp-ok':
      return 'A mídia está indo por UDP direto. As quedas não vêm de porta bloqueada; olhe CPU do servidor e distância.';
    case 'misto':
      return 'Parte dos usuários está desviando para TCP ou TURN, o padrão de rede corporativa. Ativar o TURN sobre TLS ajuda esse grupo.';
    case 'degradado':
      return 'Quase toda a mídia está desviando para TCP ou TURN. A porta UDP do servidor provavelmente está fechada: é a causa mais provável das quedas.';
    default:
      return 'Ainda sem amostras do caminho da mídia. Entre em uma reunião e fique pelo menos 20 segundos.';
  }
}
