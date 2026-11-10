import { describe, expect, it } from 'vitest';
import { layoutDia } from './layout';

const h = (x: number) => x * 3_600_000;
const pos = (r: ReturnType<typeof layoutDia>) =>
  Object.fromEntries(r.map((p) => [p.id, [p.coluna, p.colunas, p.span]]));

describe('layoutDia (eventos sobrepostos lado a lado)', () => {
  it('evento sozinho ocupa a largura toda', () => {
    expect(layoutDia([{ id: 'a', inicio: h(13), fim: h(14) }])).toEqual([
      { id: 'a', coluna: 0, colunas: 1, span: 1, left: 0, width: 1 },
    ]);
  });

  it('o mais longo fica à esquerda e quem cabe embaixo reaproveita a coluna', () => {
    const r = layoutDia([
      { id: 'b', inicio: h(9), fim: h(10) },
      { id: 'c', inicio: h(10), fim: h(11) },
      { id: 'a', inicio: h(9), fim: h(11) },
    ]);
    expect(pos(r)).toEqual({ a: [0, 2, 1], b: [1, 2, 1], c: [1, 2, 1] });
  });

  it('expande para a direita quando as colunas seguintes estão livres no horário', () => {
    const r = layoutDia([
      { id: 'x', inicio: h(9), fim: h(12) },
      { id: 'y', inicio: h(9), fim: h(10) },
      { id: 'z', inicio: h(9), fim: h(10.5) },
      { id: 'w', inicio: h(10.5), fim: h(11) },
    ]);
    expect(pos(r)).toEqual({ x: [0, 3, 1], z: [1, 3, 1], y: [2, 3, 1], w: [1, 3, 2] });
    expect(r.find((p) => p.id === 'w')!.width).toBeCloseTo(2 / 3);
  });

  it('grupos que não se encostam são independentes', () => {
    const r = layoutDia([
      { id: 'a', inicio: h(9), fim: h(10) },
      { id: 'b', inicio: h(9), fim: h(10) },
      { id: 'c', inicio: h(10), fim: h(11) },
    ]);
    expect(pos(r)).toEqual({ a: [0, 2, 1], b: [1, 2, 1], c: [0, 1, 1] });
  });

  it('500 eventos em poucos milissegundos', () => {
    const itens = Array.from({ length: 500 }, (_, i) => ({ id: `e${i}`, inicio: h(8 + (i % 40) / 4), fim: h(9 + (i % 40) / 4) }));
    const t0 = performance.now();
    expect(layoutDia(itens)).toHaveLength(500);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
