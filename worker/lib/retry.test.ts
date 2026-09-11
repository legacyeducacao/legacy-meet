import { describe, expect, it, vi } from 'vitest';
import { backoffDelayMs, RetryableError, withBackoff } from './retry';

describe('backoffDelayMs', () => {
  it('cresce exponencialmente e respeita o teto', () => {
    expect(backoffDelayMs(1, { baseMs: 1000, maxMs: 10000, jitter: 0 })).toBe(1000);
    expect(backoffDelayMs(2, { baseMs: 1000, maxMs: 10000, jitter: 0 })).toBe(2000);
    expect(backoffDelayMs(3, { baseMs: 1000, maxMs: 10000, jitter: 0 })).toBe(4000);
    expect(backoffDelayMs(6, { baseMs: 1000, maxMs: 10000, jitter: 0 })).toBe(10000);
  });
});

describe('withBackoff', () => {
  it('devolve o resultado quando a primeira tentativa dá certo', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withBackoff(fn, { attempts: 3, baseMs: 0, sleep: async () => {} })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retenta erro retryável e para no sucesso', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RetryableError('503'))
      .mockResolvedValue('ok');
    const sleeps: number[] = [];
    const r = await withBackoff(fn, {
      attempts: 3,
      baseMs: 100,
      jitter: 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(r).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([100]);
  });

  it('não retenta erro não retryável', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('400 bad request'));
    await expect(
      withBackoff(fn, { attempts: 3, baseMs: 0, sleep: async () => {} }),
    ).rejects.toThrow('400');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('lança o último erro após esgotar as tentativas', async () => {
    const fn = vi.fn().mockRejectedValue(new RetryableError('timeout'));
    await expect(
      withBackoff(fn, { attempts: 3, baseMs: 0, sleep: async () => {} }),
    ).rejects.toThrow('timeout');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
