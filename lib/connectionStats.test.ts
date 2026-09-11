import { describe, expect, it } from 'vitest';
import { extractSelectedCandidate, firstStatsReport, isDegradedTransport } from './connectionStats';

/** Monta um relatório no formato que o navegador devolve (Map id → stat). */
const report = (stats: Array<Record<string, unknown>>) =>
  new Map(stats.map((s) => [s.id as string, s]));

const localUdp = {
  id: 'local-1',
  type: 'local-candidate',
  protocol: 'udp',
  candidateType: 'srflx',
  address: '189.0.0.1',
};
const localTcpRelay = {
  id: 'local-2',
  type: 'local-candidate',
  protocol: 'tcp',
  candidateType: 'relay',
  relayProtocol: 'tls',
};

describe('extractSelectedCandidate', () => {
  it('usa o par apontado pelo transporte', () => {
    const r = report([
      { id: 'T1', type: 'transport', selectedCandidatePairId: 'P1' },
      { id: 'P1', type: 'candidate-pair', state: 'succeeded', localCandidateId: 'local-1', currentRoundTripTime: 0.032, availableOutgoingBitrate: 1_500_000 },
      { id: 'P2', type: 'candidate-pair', state: 'succeeded', localCandidateId: 'local-2', bytesSent: 999_999 },
      localUdp,
      localTcpRelay,
    ]);
    expect(extractSelectedCandidate(r)).toEqual({
      protocol: 'udp',
      candidateType: 'srflx',
      relayProtocol: undefined,
      roundTripTimeMs: 32,
      availableOutgoingBitrate: 1_500_000,
    });
  });

  it('sem selectedCandidatePairId, usa o par nomeado (Firefox)', () => {
    const r = report([
      { id: 'P1', type: 'candidate-pair', state: 'failed', localCandidateId: 'local-1' },
      { id: 'P2', type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'local-2' },
      localUdp,
      localTcpRelay,
    ]);
    expect(extractSelectedCandidate(r)?.protocol).toBe('tcp');
  });

  it('sem nomeação, fica com o par que mais trafegou', () => {
    const r = report([
      { id: 'P1', type: 'candidate-pair', state: 'succeeded', localCandidateId: 'local-1', bytesSent: 10 },
      { id: 'P2', type: 'candidate-pair', state: 'succeeded', localCandidateId: 'local-2', bytesSent: 5000 },
      localUdp,
      localTcpRelay,
    ]);
    expect(extractSelectedCandidate(r)?.candidateType).toBe('relay');
  });

  it('não vaza endereço IP', () => {
    const r = report([
      { id: 'T1', type: 'transport', selectedCandidatePairId: 'P1' },
      { id: 'P1', type: 'candidate-pair', state: 'succeeded', localCandidateId: 'local-1' },
      localUdp,
    ]);
    expect(JSON.stringify(extractSelectedCandidate(r))).not.toContain('189.0.0.1');
  });

  it('relatório vazio, ausente ou sem par utilizável devolve null', () => {
    expect(extractSelectedCandidate(null)).toBeNull();
    expect(extractSelectedCandidate(report([]))).toBeNull();
    expect(
      extractSelectedCandidate(report([{ id: 'P1', type: 'candidate-pair', state: 'failed', localCandidateId: 'x' }])),
    ).toBeNull();
  });
});

describe('isDegradedTransport', () => {
  it('UDP direto é saudável', () => {
    expect(isDegradedTransport({ protocol: 'udp', candidateType: 'srflx' })).toBe(false);
    expect(isDegradedTransport({ protocol: 'udp', candidateType: 'host' })).toBe(false);
  });

  it('TCP ou relay é o cenário que trava a chamada', () => {
    expect(isDegradedTransport({ protocol: 'tcp', candidateType: 'host' })).toBe(true);
    expect(isDegradedTransport({ protocol: 'udp', candidateType: 'relay' })).toBe(true);
  });

  it('sem informação, não acusa nada', () => {
    expect(isDegradedTransport(null)).toBe(false);
  });
});

describe('firstStatsReport', () => {
  const pub = (report?: unknown, throws = false) => ({
    track: {
      getRTCStatsReport: async () => {
        if (throws) throw new Error('track trocando de estado');
        return report as never;
      },
    },
  });

  it('prefere uma faixa local', async () => {
    const local = report([{ id: 'L', type: 'transport' }]);
    const remote = report([{ id: 'R', type: 'transport' }]);
    const r = await firstStatsReport({
      localParticipant: { trackPublications: new Map([['a', pub(local)]]) },
      remoteParticipants: new Map([['p1', { trackPublications: new Map([['b', pub(remote)]]) }]]),
    });
    expect(r).toBe(local);
  });

  it('cai para uma faixa remota quando não há local (sala de espera)', async () => {
    const remote = report([{ id: 'R', type: 'transport' }]);
    const r = await firstStatsReport({
      localParticipant: { trackPublications: new Map() },
      remoteParticipants: new Map([['p1', { trackPublications: new Map([['b', pub(remote)]]) }]]),
    });
    expect(r).toBe(remote);
  });

  it('faixa que lança não interrompe a busca', async () => {
    const good = report([{ id: 'G', type: 'transport' }]);
    const r = await firstStatsReport({
      localParticipant: { trackPublications: new Map([['a', pub(undefined, true)], ['b', pub(good)]]) },
      remoteParticipants: new Map(),
    });
    expect(r).toBe(good);
  });

  it('sala sem faixas devolve undefined', async () => {
    const r = await firstStatsReport({
      localParticipant: { trackPublications: new Map() },
      remoteParticipants: new Map(),
    });
    expect(r).toBeUndefined();
  });
});
