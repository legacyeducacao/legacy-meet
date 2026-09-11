import { describe, expect, it } from 'vitest';
import { genericSpeakerName, parseAssemblyUtterances } from './utterances';

describe('parseAssemblyUtterances', () => {
  it('converte ms para segundos e mantém o rótulo cru', () => {
    const out = parseAssemblyUtterances([
      { speaker: 'A', text: 'Olá.', start: 1500, end: 2750, confidence: 0.9 },
      { speaker: 'B', text: 'Oi!', start: 3000, end: 3500, confidence: 0.8 },
    ]);
    expect(out).toEqual([
      { speaker: 'A', text: 'Olá.', start: 1.5, end: 2.75 },
      { speaker: 'B', text: 'Oi!', start: 3, end: 3.5 },
    ]);
  });

  it('ordena por start e ignora falas vazias', () => {
    const out = parseAssemblyUtterances([
      { speaker: 'B', text: 'depois', start: 5000, end: 6000 },
      { speaker: 'A', text: '   ', start: 1000, end: 2000 },
      { speaker: 'A', text: 'antes', start: 1000, end: 2000 },
    ]);
    expect(out.map((u) => u.text)).toEqual(['antes', 'depois']);
  });

  it('corrige end menor que start', () => {
    const out = parseAssemblyUtterances([{ speaker: 'A', text: 'x', start: 2000, end: 1000 }]);
    expect(out[0].end).toBe(2);
  });

  it('lista vazia ou ausente → []', () => {
    expect(parseAssemblyUtterances([])).toEqual([]);
    expect(parseAssemblyUtterances(undefined)).toEqual([]);
  });
});

describe('genericSpeakerName', () => {
  it('rótulo da AssemblyAI vira "Falante X"', () => {
    expect(genericSpeakerName('A')).toBe('Falante A');
    expect(genericSpeakerName('Falante B')).toBe('Falante B');
  });
});
