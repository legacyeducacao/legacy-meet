import { describe, expect, it } from 'vitest';
import { chunkArray } from './chunk';

describe('chunkArray', () => {
  it('divide em lotes do tamanho pedido', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('lista menor que o lote vira um único lote', () => {
    expect(chunkArray([1, 2], 10)).toEqual([[1, 2]]);
  });

  it('lista vazia vira zero lotes', () => {
    expect(chunkArray([], 5)).toEqual([]);
  });
});
