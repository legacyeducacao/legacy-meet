import { describe, expect, it } from 'vitest';
import { summarizeTelemetry, verdictMessage } from './telemetrySummary';
import type { TelemetryRecord } from './telemetryStore';

const evt = (evt: string, data: Record<string, unknown> = {}, room = 'sala-1'): TelemetryRecord => ({
  evt,
  at: '2026-09-11T19:00:00.000Z',
  receivedAt: '2026-09-11T19:00:00.000Z',
  room,
  data,
});

const ice = (protocol: string, candidateType: string, degraded: boolean, roundTripTimeMs?: number) =>
  evt('ice_transport', { protocol, candidateType, degraded, roundTripTimeMs });

describe('summarizeTelemetry — caminho da mídia', () => {
  it('separa udp, tcp e relay e calcula a latência mediana', () => {
    const s = summarizeTelemetry([
      ice('udp', 'srflx', false, 20),
      ice('udp', 'host', false, 30),
      ice('tcp', 'host', true, 40),
      ice('udp', 'relay', true, 120),
    ]);
    expect(s.transport).toMatchObject({ udp: 2, tcp: 1, relay: 1, degraded: 2, total: 4 });
    expect(s.transport.medianRttMs).toBe(35);
  });

  it('relay conta como relay mesmo quando o protocolo é udp', () => {
    const s = summarizeTelemetry([ice('udp', 'relay', true)]);
    expect(s.transport).toMatchObject({ udp: 0, relay: 1, degraded: 1 });
  });

  it('veredito: tudo em udp', () => {
    const s = summarizeTelemetry([ice('udp', 'srflx', false), ice('udp', 'host', false)]);
    expect(s.verdict).toBe('udp-ok');
    expect(verdictMessage(s.verdict)).toMatch(/UDP direto/);
  });

  it('veredito: quase tudo desviando é problema de porta no servidor', () => {
    const s = summarizeTelemetry([ice('tcp', 'host', true), ice('tcp', 'host', true), ice('udp', 'srflx', false), ice('tcp', 'host', true), ice('tcp', 'host', true)]);
    expect(s.verdict).toBe('degradado');
    expect(verdictMessage(s.verdict)).toMatch(/porta UDP do servidor/);
  });

  it('veredito: uma parte desviando é rede corporativa', () => {
    const s = summarizeTelemetry([ice('tcp', 'host', true), ice('udp', 'srflx', false), ice('udp', 'srflx', false)]);
    expect(s.verdict).toBe('misto');
    expect(verdictMessage(s.verdict)).toMatch(/rede corporativa/);
  });

  it('veredito: sem amostras', () => {
    const s = summarizeTelemetry([evt('reconnecting')]);
    expect(s.verdict).toBe('sem-dados');
    expect(s.transport.medianRttMs).toBeNull();
  });
});

describe('summarizeTelemetry — estabilidade e dispositivos', () => {
  it('conta quedas e calcula a mediana da duração', () => {
    const s = summarizeTelemetry([
      evt('reconnecting'),
      evt('reconnected', { outageMs: 2000 }),
      evt('reconnecting'),
      evt('reconnected', { outageMs: 8000 }),
      evt('reconnect_gave_up', { reason: 'none' }),
      evt('connection_quality', { quality: 'poor' }),
    ]);
    expect(s.stability).toMatchObject({ reconnecting: 2, reconnected: 2, gaveUp: 1, poorQuality: 1 });
    expect(s.stability.medianOutageMs).toBe(5000);
  });

  it('conta erros de dispositivo e destaca permissão negada', () => {
    const s = summarizeTelemetry([
      evt('media_error', { error: { name: 'NotReadableError' } }),
      evt('prejoin_error', { error: { name: 'NotAllowedError' } }),
      evt('device_enable_failed', { source: 'microphone', error: { name: 'NotAllowedError' } }),
      evt('iframe_permissions_blocked'),
      evt('connect_failed', { error: { name: 'ConnectionError' } }),
    ]);
    expect(s.devices).toEqual({
      mediaErrors: 2,
      enableFailed: 1,
      permissionDenied: 2,
      iframeBlocked: 1,
      connectFailed: 1,
    });
  });

  it('conta salas distintas e ignora eventos desconhecidos sem quebrar', () => {
    const s = summarizeTelemetry([evt('reconnecting', {}, 'a'), evt('algo_novo', {}, 'b'), evt('reconnecting', {}, 'a')]);
    expect(s.rooms).toBe(2);
    expect(s.total).toBe(3);
  });

  it('lista vazia devolve zeros', () => {
    const s = summarizeTelemetry([]);
    expect(s.total).toBe(0);
    expect(s.verdict).toBe('sem-dados');
  });
});
