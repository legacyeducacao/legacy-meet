import { describe, expect, it } from 'vitest';
import { decideEgress, HOST_ATTRIBUTE, isHostParticipant } from './recordingWatchdog';

const MIN = 60_000;
const CFG = { hostAbsentMs: 10 * MIN, maxMs: 5 * 60 * MIN };
const T0 = 1_800_000_000_000;

describe('isHostParticipant', () => {
  const base = { identity: 'Ana__abc', name: 'Ana', attributes: {} as Record<string, string> };

  it('reconhece o anfitrião pelo atributo assinado no token', () => {
    expect(isHostParticipant({ ...base, attributes: { [HOST_ATTRIBUTE]: '1' } }, {})).toBe(true);
  });

  it('reconhece co-anfitrião pela lista nos metadados da sala', () => {
    const roomMetadata = JSON.stringify({ cohosts: ['Ana__abc'] });
    expect(isHostParticipant(base, { roomMetadata })).toBe(true);
  });

  it('compatibilidade: nome igual ao anfitrião registrado na gravação (tokens antigos)', () => {
    expect(isHostParticipant({ ...base, name: 'MATHEUS parolini' }, { metaHost: 'Matheus Parolini' })).toBe(true);
  });

  it('convidado comum não é anfitrião', () => {
    expect(isHostParticipant({ ...base, name: 'marvin' }, { metaHost: 'Matheus Parolini' })).toBe(false);
  });
});

describe('decideEgress', () => {
  it('mantém a gravação com o anfitrião presente', () => {
    expect(decideEgress({ startedAtMs: T0, nowMs: T0 + 30 * MIN, hostPresent: true }, CFG)).toEqual({
      action: 'keep',
    });
  });

  it('anfitrião acabou de sair: começa a contar a ausência, sem parar', () => {
    expect(decideEgress({ startedAtMs: T0, nowMs: T0 + 67 * MIN, hostPresent: false }, CFG)).toEqual({
      action: 'keep',
      hostAbsentSinceMs: T0 + 67 * MIN,
    });
  });

  it('anfitrião fora há menos que a tolerância: mantém (pode ter caído e estar voltando)', () => {
    const since = T0 + 67 * MIN;
    expect(
      decideEgress({ startedAtMs: T0, nowMs: since + 9 * MIN, hostPresent: false, hostAbsentSinceMs: since }, CFG),
    ).toEqual({ action: 'keep', hostAbsentSinceMs: since });
  });

  it('caso Marvin: anfitrião fora há 10 min e convidado esquecido na sala → para a gravação', () => {
    const since = T0 + 67 * MIN;
    expect(
      decideEgress({ startedAtMs: T0, nowMs: since + 10 * MIN, hostPresent: false, hostAbsentSinceMs: since }, CFG),
    ).toEqual({ action: 'stop', reason: 'host_absent' });
  });

  it('teto de duração para mesmo com anfitrião presente', () => {
    expect(decideEgress({ startedAtMs: T0, nowMs: T0 + 5 * 60 * MIN, hostPresent: true }, CFG)).toEqual({
      action: 'stop',
      reason: 'max_duration',
    });
  });

  it('anfitrião voltou: zera a contagem de ausência', () => {
    expect(
      decideEgress(
        { startedAtMs: T0, nowMs: T0 + 80 * MIN, hostPresent: true, hostAbsentSinceMs: T0 + 75 * MIN },
        CFG,
      ),
    ).toEqual({ action: 'keep' });
  });

  it('sem horário de início (egress ainda subindo): não aplica o teto', () => {
    expect(decideEgress({ startedAtMs: 0, nowMs: T0, hostPresent: true }, CFG)).toEqual({ action: 'keep' });
  });
});
