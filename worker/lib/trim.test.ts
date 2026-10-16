import { describe, expect, it } from 'vitest';
import { planTrim, type TrimOptions } from './trim';

const OPTS: TrimOptions = {
  thresholdSeconds: 3 * 3600,
  maxSeconds: 5 * 3600,
  tailPadSeconds: 60,
  minSpeechSeconds: 1,
};

describe('planTrim', () => {
  it('não mexe em gravação de duração normal', () => {
    expect(planTrim(70 * 60, [], OPTS)).toBeNull();
  });

  it('gravação zumbi (sala esquecida aberta): corta logo após a última fala', () => {
    // Caso real Marvin 15/10: ~67 min de reunião e 22h39min de gravação.
    const duration = 81_525;
    const silences = [
      { start: 10, end: 14 },
      { start: 4_020, end: duration }, // silêncio do fim da reunião até o fim
    ];
    expect(planTrim(duration, silences, OPTS)).toBe(4_020 + 60);
  });

  it('ruídos curtos no meio do silêncio do fim não seguram o corte', () => {
    const duration = 50_000;
    const silences = [
      { start: 4_000, end: 20_000 },
      { start: 20_000.4, end: duration }, // estalo de 0,4s: abaixo do mínimo de fala
    ];
    expect(planTrim(duration, silences, OPTS)).toBe(4_000 + 60);
  });

  it('fala até o fim de uma gravação longa demais: corta no teto', () => {
    expect(planTrim(30_000, [], OPTS)).toBe(5 * 3600);
  });

  it('gravação longa sem fala nenhuma: mantém só um trecho mínimo', () => {
    expect(planTrim(40_000, [{ start: 0, end: 40_000 }], OPTS)).toBe(60);
  });

  it('não corta quando o ponto de corte é praticamente o fim', () => {
    const duration = 4 * 3600;
    const silences = [{ start: duration - 30, end: duration }];
    expect(planTrim(duration, silences, OPTS)).toBeNull();
  });
});
