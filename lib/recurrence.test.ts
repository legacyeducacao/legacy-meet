import { describe, expect, it } from 'vitest';
import { computeOccurrences, MAX_OCCURRENCES } from './recurrence';

const start = new Date('2026-08-05T17:00:00.000Z'); // quarta, 14h em São Paulo

describe('computeOccurrences', () => {
  it('semanal com count', () => {
    const out = computeOccurrences(start, { frequency: 'weekly', count: 3 });
    expect(out.map((d) => d.toISOString())).toEqual([
      '2026-08-05T17:00:00.000Z',
      '2026-08-12T17:00:00.000Z',
      '2026-08-19T17:00:00.000Z',
    ]);
  });

  it('quinzenal com count', () => {
    const out = computeOccurrences(start, { frequency: 'biweekly', count: 2 });
    expect(out[1].toISOString()).toBe('2026-08-19T17:00:00.000Z');
  });

  it('diária com until inclusivo', () => {
    const until = new Date('2026-08-07T23:59:59.999-03:00');
    const out = computeOccurrences(start, { frequency: 'daily', until });
    expect(out).toHaveLength(3); // dias 5, 6 e 7
  });

  it('mensal dia 31 ajusta para fim de mês curto e volta ao 31', () => {
    const s = new Date('2026-08-31T17:00:00.000Z'); // 31/08, 14h SP
    const out = computeOccurrences(s, { frequency: 'monthly', count: 3 });
    expect(out.map((d) => d.toISOString())).toEqual([
      '2026-08-31T17:00:00.000Z',
      '2026-09-30T17:00:00.000Z', // setembro só tem 30
      '2026-10-31T17:00:00.000Z', // outubro volta ao dia 31
    ]);
  });

  it('count acima do teto lança', () => {
    expect(() =>
      computeOccurrences(start, { frequency: 'weekly', count: MAX_OCCURRENCES + 1 }),
    ).toThrow();
  });

  it('until que gera mais que o teto lança', () => {
    const until = new Date('2036-01-01T00:00:00.000Z');
    expect(() => computeOccurrences(start, { frequency: 'daily', until })).toThrow();
  });

  it('until e count juntos (ou nenhum) lançam', () => {
    expect(() => computeOccurrences(start, { frequency: 'weekly' } as never)).toThrow();
    expect(() =>
      computeOccurrences(start, { frequency: 'weekly', count: 2, until: new Date() }),
    ).toThrow();
  });
});
