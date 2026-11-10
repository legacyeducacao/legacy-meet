import { describe, expect, it } from 'vitest';
import { conteudo, rotuloPorOrdem, sequenciaAPartirDe } from './ciclo';
import { addDays } from './tempo';

const SEQ = ['F1', 'F2', 'C1', 'C2'];
const TERCA_1 = '2026-01-06'; // terça da semana 1
const terca = (semana: number) => addDays(TERCA_1, 7 * (semana - 1));
const quinta = (semana: number) => addDays(terca(semana), 2);
const cfgTerca = { sequencia: SEQ, defasagem: 0, ancora: TERCA_1 };
const cfgQuinta = { sequencia: SEQ, defasagem: 1, ancora: TERCA_1 };

describe('conteudo: tabela de referência do Impulsão', () => {
  const tabela: Array<[number, string, string]> = [
    [1, 'F1', 'C2'],
    [2, 'F2', 'F1'],
    [3, 'C1', 'F2'],
    [4, 'C2', 'C1'],
    [5, 'F1', 'C2'],
  ];
  it.each(tabela)('semana %i: terça %s, quinta %s', (semana, t, q) => {
    expect(conteudo(cfgTerca, terca(semana))).toBe(t);
    expect(conteudo(cfgQuinta, quinta(semana))).toBe(q);
  });

  it('continua certo muito além da 5ª semana (semana 53, virada de ano)', () => {
    // 52 semanas = 13 ciclos completos: semana 53 repete a semana 1.
    expect(conteudo(cfgTerca, terca(53))).toBe('F1');
    expect(conteudo(cfgQuinta, quinta(53))).toBe('C2');
    expect(conteudo(cfgTerca, terca(54))).toBe('F2');
  });

  it('funciona para datas antes da âncora', () => {
    expect(conteudo(cfgTerca, terca(0))).toBe('C2');
    expect(conteudo(cfgTerca, terca(-1))).toBe('C1');
    expect(conteudo(cfgQuinta, quinta(0))).toBe('C1');
    expect(conteudo(cfgTerca, terca(-3))).toBe('F1');
  });

  it('qualquer dia da semana dá o conteúdo da semana', () => {
    expect(conteudo(cfgTerca, addDays(terca(3), -1))).toBe('C1'); // segunda
    expect(conteudo(cfgTerca, addDays(terca(3), 5))).toBe('C1'); // domingo
  });
});

describe('conteudo: semana pausada (política ciclo pausa)', () => {
  const pausada = { ...cfgTerca, semanasPausadas: [terca(2)] };
  it('a semana pausada não tem conteúdo e o ciclo anda junto', () => {
    expect(conteudo(pausada, terca(1))).toBe('F1');
    expect(conteudo(pausada, terca(2))).toBeNull();
    expect(conteudo(pausada, terca(3))).toBe('F2');
    expect(conteudo(pausada, terca(4))).toBe('C1');
    expect(conteudo(pausada, terca(6))).toBe('F1');
  });
  it('pausa depois da data não muda o passado', () => {
    expect(conteudo({ ...cfgTerca, semanasPausadas: [terca(10)] }, terca(3))).toBe('C1');
  });
  it('pausa antes da âncora: contando para trás a semana pausada também não consome', () => {
    const p = { ...cfgTerca, semanasPausadas: [terca(-1)] };
    expect(conteudo(p, terca(0))).toBe('C2');
    expect(conteudo(p, terca(-1))).toBeNull();
    expect(conteudo(p, terca(-2))).toBe('C1');
  });
});

describe('nada fixo no código', () => {
  it('sequência de 6 conteúdos, defasagem 2', () => {
    const cfg = { sequencia: ['A', 'B', 'C', 'D', 'E', 'F'], defasagem: 2, ancora: '2026-03-02' };
    expect(conteudo(cfg, '2026-03-02')).toBe('E');
    expect(conteudo(cfg, '2026-03-16')).toBe('A');
  });
  it('sequenciaAPartirDe gira a partir da entrada', () => {
    expect(sequenciaAPartirDe(SEQ, 'C1')).toEqual(['C1', 'C2', 'F1', 'F2']);
    expect(() => sequenciaAPartirDe(SEQ, 'X1')).toThrow();
  });
  it('rotuloPorOrdem para séries personalizadas', () => {
    expect([0, 1, 2, 3, 4].map((i) => rotuloPorOrdem(SEQ, i))).toEqual(['F1', 'F2', 'C1', 'C2', 'F1']);
    expect(rotuloPorOrdem(SEQ, 0, 1)).toBe('C2');
    expect(rotuloPorOrdem([], 0)).toBeNull();
  });
});
