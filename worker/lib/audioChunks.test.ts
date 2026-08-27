import { describe, expect, it } from 'vitest';
import { computeChunkBoundaries, parseSilences } from './audioChunks';

describe('parseSilences', () => {
  it('extrai pares start/end do stderr do silencedetect', () => {
    const log = [
      '[silencedetect @ 0x1] silence_start: 12.5',
      '[silencedetect @ 0x1] silence_end: 13.75 | silence_duration: 1.25',
      '[silencedetect @ 0x1] silence_start: 290.1',
      '[silencedetect @ 0x1] silence_end: 291.0 | silence_duration: 0.9',
    ].join('\n');
    expect(parseSilences(log)).toEqual([
      { start: 12.5, end: 13.75 },
      { start: 290.1, end: 291.0 },
    ]);
  });

  it('ignora silence_start sem end', () => {
    expect(parseSilences('silence_start: 5.0')).toEqual([]);
  });

  it('log sem silêncio devolve lista vazia', () => {
    expect(parseSilences('frame= 100 fps=0.0')).toEqual([]);
  });
});

describe('computeChunkBoundaries', () => {
  it('sem silêncio: corta exatamente no alvo', () => {
    expect(computeChunkBoundaries(650, [], 300, 60)).toEqual([300, 600]);
  });

  it('áudio curto: sem cortes', () => {
    expect(computeChunkBoundaries(200, [], 300, 60)).toEqual([]);
  });

  it('corta no meio do silêncio mais próximo do alvo dentro da janela', () => {
    const silences = [{ start: 290.0, end: 292.0 }];
    expect(computeChunkBoundaries(650, silences, 300, 60)).toEqual([291, 591]);
  });

  it('silêncio fora da janela é ignorado', () => {
    const silences = [{ start: 100, end: 101 }];
    expect(computeChunkBoundaries(650, silences, 300, 60)).toEqual([300, 600]);
  });
});

describe('speechSegments / speechOverlap', () => {
  const silences = [
    { start: 0, end: 10 },
    { start: 20, end: 25 },
    { start: 55, end: 60 },
  ];

  it('speechSegments é o complemento dos silêncios dentro da duração', async () => {
    const { speechSegments } = await import('./audioChunks');
    expect(speechSegments(60, silences)).toEqual([
      { start: 10, end: 20 },
      { start: 25, end: 55 },
    ]);
  });

  it('sem silêncios, tudo é fala', async () => {
    const { speechSegments } = await import('./audioChunks');
    expect(speechSegments(30, [])).toEqual([{ start: 0, end: 30 }]);
  });

  it('speechOverlap conta só os segundos dentro de fala', async () => {
    const { speechSegments, speechOverlap } = await import('./audioChunks');
    const segs = speechSegments(60, silences);
    expect(speechOverlap(5, 15, segs)).toBe(5); // 10..15
    expect(speechOverlap(0, 10, segs)).toBe(0); // todo em silêncio
    expect(speechOverlap(18, 27, segs)).toBe(4); // 18..20 + 25..27
  });
});
