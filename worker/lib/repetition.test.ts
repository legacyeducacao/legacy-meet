import { describe, expect, it } from 'vitest';
import { collapseRepetitions } from './repetition';

const u = (speaker: string, text: string, start: number) => ({
  speaker,
  text,
  start,
  end: start + 1,
});

describe('collapseRepetitions', () => {
  it('colapsa frase repetida dentro da mesma fala para uma ocorrência', () => {
    const rep = Array(46).fill('Aí o cara só recebia o diploma, não fazia nada.').join(' ');
    const { utterances, removed } = collapseRepetitions([u('Mariza', `Aí tinha, antigamente. ${rep}`, 0)]);
    expect(utterances).toHaveLength(1);
    expect(utterances[0].text).toBe('Aí tinha, antigamente. Aí o cara só recebia o diploma, não fazia nada.');
    expect(removed).toBe(45);
  });

  it('remove falas consecutivas idênticas do mesmo speaker', () => {
    const { utterances, removed } = collapseRepetitions([
      u('A', 'Aí o cara só recebia o diploma.', 0),
      u('A', 'aí o cara só recebia o diploma.', 1),
      u('A', 'Aí o cara só recebia o diploma.', 2),
      u('B', 'Entendi.', 3),
    ]);
    expect(utterances.map((x) => x.text)).toEqual(['Aí o cara só recebia o diploma.', 'Entendi.']);
    expect(removed).toBe(2);
  });

  it('não mexe em texto normal', () => {
    const input = [u('A', 'Bom dia. Como vai?', 0), u('B', 'Tudo bem. E você?', 2)];
    const { utterances, removed } = collapseRepetitions(input);
    expect(utterances).toEqual(input);
    expect(removed).toBe(0);
  });

  it('frase dita duas vezes de verdade é preservada (só colapsa a partir de 3)', () => {
    const { utterances, removed } = collapseRepetitions([u('A', 'Não. Não.', 0)]);
    expect(utterances[0].text).toBe('Não. Não.');
    expect(removed).toBe(0);
  });
});
