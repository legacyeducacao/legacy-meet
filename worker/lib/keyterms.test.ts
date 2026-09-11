import { describe, expect, it } from 'vitest';
import { buildKeyterms, normalizeKeyterms, parseKeytermsFile } from './keyterms';

describe('parseKeytermsFile', () => {
  it('aceita { keyterms: [...] } e lista simples', () => {
    expect(parseKeytermsFile('{"keyterms":["Legacy Educação","BSC"]}')).toEqual([
      'Legacy Educação',
      'BSC',
    ]);
    expect(parseKeytermsFile('["DRE"]')).toEqual(['DRE']);
  });

  it('JSON inválido → lista vazia', () => {
    expect(parseKeytermsFile('{oops')).toEqual([]);
  });
});

describe('normalizeKeyterms', () => {
  it('remove vazios, duplicados (ignorando caixa) e termos com mais de 6 palavras', () => {
    expect(
      normalizeKeyterms([
        ' iPreço ',
        'ipreço',
        '',
        'um dois três quatro cinco seis sete',
        'Club Legacy',
      ]),
    ).toEqual(['iPreço', 'Club Legacy']);
  });

  it('respeita o limite máximo de termos', () => {
    const many = Array.from({ length: 1200 }, (_, i) => `termo${i}`);
    expect(normalizeKeyterms(many)).toHaveLength(1000);
  });
});

describe('buildKeyterms', () => {
  it('une vocabulário fixo com nomes dos participantes sem duplicar', () => {
    expect(buildKeyterms(['Legacy Plan', 'Ana Souza'], ['Ana Souza', 'Bruno Lima'])).toEqual([
      'Legacy Plan',
      'Ana Souza',
      'Bruno Lima',
    ]);
  });
});
