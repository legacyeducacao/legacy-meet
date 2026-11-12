import { describe, expect, it } from 'vitest';
import { trocarHorarios } from './troca';

const h = (hora: number, dia = 10) => Date.UTC(2026, 10, dia, hora + 3); // hora de Brasília
const f = (ini: number, fim: number, dia = 10) => ({ inicio: h(ini, dia), fim: h(fim, dia) });

describe('trocarHorarios', () => {
  it('a das 13h vai para as 09h e a das 09h para as 13h', () => {
    expect(trocarHorarios(f(13, 14), f(9, 10))).toEqual({ a: f(9, 10), b: f(13, 14) });
  });

  it('cada uma mantém a própria duração', () => {
    expect(trocarHorarios(f(9, 10), f(13, 15))).toEqual({ a: f(13, 14), b: f(9, 11) });
  });

  it('dias diferentes: troca dia e hora', () => {
    expect(trocarHorarios(f(9, 10, 10), f(13, 14, 12))).toEqual({ a: f(13, 14, 12), b: f(9, 10, 10) });
  });

  it('reuniões coladas de durações diferentes não se encavalam', () => {
    // 09h-10h e 10h-12h viram 09h-11h e 11h-12h.
    expect(trocarHorarios(f(9, 10), f(10, 12))).toEqual({ a: f(11, 12), b: f(9, 11) });
    // Mesma troca vista pelo outro lado.
    expect(trocarHorarios(f(10, 12), f(9, 10))).toEqual({ a: f(9, 11), b: f(11, 12) });
  });

  it('mantém o intervalo que havia entre elas quando precisa empilhar', () => {
    // 09h-10h e 10h30-13h: a longa vai para 09h-11h30, a curta para 12h-13h.
    const r = trocarHorarios(f(9, 10), { inicio: h(10) + 30 * 60_000, fim: h(13) });
    expect(r.b).toEqual({ inicio: h(9), fim: h(11) + 30 * 60_000 });
    expect(r.a).toEqual({ inicio: h(12), fim: h(13) });
  });
});
