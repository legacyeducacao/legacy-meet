import { describe, expect, it } from 'vitest';
import { matchSpeaker, normalizeUtterances } from './speakers';

describe('matchSpeaker', () => {
  const parts = ['João Gaspar', 'Maria Silva'];

  it('match exato ignorando caixa/acentos', () => {
    expect(matchSpeaker('joao gaspar', parts)).toBe('João Gaspar');
  });

  it('match por primeiro nome', () => {
    expect(matchSpeaker('Maria', parts)).toBe('Maria Silva');
  });

  it('rótulo desconhecido fica como está', () => {
    expect(matchSpeaker('Pessoa 1', parts)).toBe('Pessoa 1');
    expect(matchSpeaker('Desconhecido', parts)).toBe('Desconhecido');
  });

  it('rótulo curto demais não força match', () => {
    expect(matchSpeaker('Jo', parts)).toBe('Jo');
  });
});

describe('normalizeUtterances', () => {
  it('funde falas consecutivas do mesmo speaker com gap <= 1.5s', () => {
    const out = normalizeUtterances(
      [
        { speaker: 'joao gaspar', text: 'oi', start: 0, end: 1 },
        { speaker: 'João Gaspar', text: 'tudo bem?', start: 1.5, end: 2.5 },
        { speaker: 'Maria', text: 'tudo!', start: 3, end: 4 },
      ],
      ['João Gaspar', 'Maria Silva'],
    );
    expect(out).toEqual([
      { speaker: 'João Gaspar', text: 'oi tudo bem?', start: 0, end: 2.5 },
      { speaker: 'Maria Silva', text: 'tudo!', start: 3, end: 4 },
    ]);
  });

  it('não funde quando o gap é grande', () => {
    const out = normalizeUtterances(
      [
        { speaker: 'A', text: 'primeira', start: 0, end: 1 },
        { speaker: 'A', text: 'depois de pausa longa', start: 10, end: 11 },
      ],
      [],
    );
    expect(out).toHaveLength(2);
  });

  it('ordena por start e corrige end < start', () => {
    const out = normalizeUtterances(
      [
        { speaker: 'A', text: 'b', start: 10, end: 5 },
        { speaker: 'B', text: 'a', start: 0, end: 1 },
      ],
      [],
    );
    expect(out[0].speaker).toBe('B');
    expect(out[1].end).toBe(10);
  });
});
