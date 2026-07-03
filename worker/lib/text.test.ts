import { describe, expect, it } from 'vitest';
import { parsePlainTextToUtterances, utterancesToPlainText } from './text';

describe('utterancesToPlainText', () => {
  it('formata start com 1 casa, speaker e texto', () => {
    const out = utterancesToPlainText([{ speaker: 'Ana', text: 'Oi', start: 0, end: 1 }]);
    expect(out).toBe('[0.0s] Ana: Oi');
  });
});

describe('parsePlainTextToUtterances', () => {
  it('parseia uma linha simples (end = start na última)', () => {
    expect(parsePlainTextToUtterances('[0.0s] Ana: Olá')).toEqual([
      { start: 0, end: 0, speaker: 'Ana', text: 'Olá' },
    ]);
  });

  it('deriva end da próxima fala', () => {
    const r = parsePlainTextToUtterances('[0.0s] Ana: Oi\n[2.5s] Bruno: E aí');
    expect(r[0]).toEqual({ start: 0, end: 2.5, speaker: 'Ana', text: 'Oi' });
    expect(r[1]).toEqual({ start: 2.5, end: 2.5, speaker: 'Bruno', text: 'E aí' });
  });

  it('aceita speaker com espaços e texto com dois-pontos', () => {
    const r = parsePlainTextToUtterances('[3.0s] Márcio Pereira: link: http://x');
    expect(r[0].speaker).toBe('Márcio Pereira');
    expect(r[0].text).toBe('link: http://x');
  });

  it('ignora linhas malformadas e vazias', () => {
    expect(parsePlainTextToUtterances('lixo\n\n[1.0s] Zé: ok')).toEqual([
      { start: 1, end: 1, speaker: 'Zé', text: 'ok' },
    ]);
  });

  it('string vazia → []', () => {
    expect(parsePlainTextToUtterances('')).toEqual([]);
  });

  it('round-trip preserva start/speaker/text', () => {
    const utts = [
      { speaker: 'Ana', text: 'Oi', start: 0, end: 2.5 },
      { speaker: 'Bruno', text: 'E aí', start: 2.5, end: 4 },
    ];
    const parsed = parsePlainTextToUtterances(utterancesToPlainText(utts));
    expect(parsed.map((u) => [u.start, u.speaker, u.text])).toEqual([
      [0, 'Ana', 'Oi'],
      [2.5, 'Bruno', 'E aí'],
    ]);
  });
});
