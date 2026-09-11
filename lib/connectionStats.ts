/**
 * Extrai do relatório de estatísticas do WebRTC qual caminho a mídia está
 * usando de verdade. É a resposta para "a mídia está em UDP ou caiu para TCP?",
 * que hoje só dá para responder abrindo `chrome://webrtc-internals` na máquina
 * de quem está reclamando.
 *
 * Em TCP, um pacote perdido trava todos os seguintes, e a chamada congela e
 * reconecta. Saber isso de todos os usuários, e não de um, é o que separa
 * "internet do usuário" de "porta UDP fechada no servidor".
 *
 * Só campos técnicos são extraídos. Endereços IP ficam de fora de propósito.
 */
export interface SelectedCandidate {
  /** 'udp' ou 'tcp': o protocolo de transporte da mídia. */
  protocol?: string;
  /** 'host' (rede local), 'srflx' (NAT), 'prflx' ou 'relay' (via TURN). */
  candidateType?: string;
  /** Protocolo até o servidor TURN, quando candidateType é 'relay'. */
  relayProtocol?: string;
  /** Tempo de ida e volta até o servidor, em milissegundos. */
  roundTripTimeMs?: number;
  /** Banda de subida estimada, em bits por segundo. */
  availableOutgoingBitrate?: number;
}

/** Mínimo que um RTCStatsReport (ou um Map, nos testes) precisa oferecer. */
export interface StatsReportLike {
  forEach(callback: (value: Record<string, unknown>, key: string) => void): void;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

export function extractSelectedCandidate(report: StatsReportLike | null | undefined): SelectedCandidate | null {
  if (!report) return null;
  const byId = new Map<string, Record<string, unknown>>();
  const pairs: Array<Record<string, unknown>> = [];
  let selectedPairId: string | undefined;

  report.forEach((stat, key) => {
    const id = str(stat.id) ?? key;
    byId.set(id, stat);
    if (stat.type === 'candidate-pair') pairs.push(stat);
    // O transporte aponta diretamente para o par em uso (caminho preferido).
    if (stat.type === 'transport' && str(stat.selectedCandidatePairId)) {
      selectedPairId = str(stat.selectedCandidatePairId);
    }
  });

  const succeeded = pairs.filter((p) => p.state === 'succeeded');
  const pair =
    (selectedPairId ? byId.get(selectedPairId) : undefined) ??
    // Firefox não expõe selectedCandidatePairId: usa o par marcado como em uso.
    succeeded.find((p) => p.selected === true || p.nominated === true) ??
    // Último recurso: o par bem-sucedido que mais trafegou.
    succeeded.sort((a, b) => (num(b.bytesSent) ?? 0) - (num(a.bytesSent) ?? 0))[0];
  if (!pair) return null;

  const local = str(pair.localCandidateId) ? byId.get(str(pair.localCandidateId)!) : undefined;
  const rttSeconds = num(pair.currentRoundTripTime);

  const out: SelectedCandidate = {
    protocol: str(local?.protocol),
    candidateType: str(local?.candidateType),
    relayProtocol: str(local?.relayProtocol),
    roundTripTimeMs: rttSeconds !== undefined ? Math.round(rttSeconds * 1000) : undefined,
    availableOutgoingBitrate: num(pair.availableOutgoingBitrate),
  };
  // Só devolve algo quando há informação útil.
  return out.protocol || out.candidateType ? out : null;
}

/** true quando a mídia NÃO está em UDP direto: é o cenário que trava a chamada. */
export function isDegradedTransport(c: SelectedCandidate | null): boolean {
  if (!c) return false;
  return c.protocol === 'tcp' || c.candidateType === 'relay';
}

// --- Coleta do relatório a partir da sala -----------------------------------
// Tipado pela forma (e não importando o livekit-client) para manter este módulo
// puro e testável sem navegador.
interface TrackLike {
  getRTCStatsReport?: () => Promise<StatsReportLike | undefined>;
}
interface PublicationLike {
  track?: TrackLike;
}
interface ParticipantLike {
  trackPublications: Map<string, PublicationLike>;
}
export interface RoomLike {
  localParticipant: ParticipantLike;
  remoteParticipants: Map<string, ParticipantLike>;
}

/**
 * Primeiro relatório de estatísticas disponível na sala. Prefere uma faixa
 * local (quem publica sempre tem uma); cai para uma remota quando o
 * participante ainda não publica nada, como na sala de espera.
 */
export async function firstStatsReport(room: RoomLike): Promise<StatsReportLike | undefined> {
  const publications: PublicationLike[] = [
    ...room.localParticipant.trackPublications.values(),
    ...[...room.remoteParticipants.values()].flatMap((p) => [...p.trackPublications.values()]),
  ];
  for (const pub of publications) {
    try {
      const report = await pub.track?.getRTCStatsReport?.();
      if (report) return report;
    } catch {
      // faixa trocando de estado — tenta a próxima
    }
  }
  return undefined;
}
