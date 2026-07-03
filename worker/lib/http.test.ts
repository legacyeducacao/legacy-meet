import { describe, expect, it } from 'vitest';
import { fetchWithTimeout, TimeoutError } from './http';

describe('fetchWithTimeout', () => {
  it('resolve quando o fetch responde antes do prazo', async () => {
    const fakeResp = new Response('ok');
    const fetchImpl = () => Promise.resolve(fakeResp);
    const r = await fetchWithTimeout('http://x', { fetchImpl } as never, 1000);
    expect(r).toBe(fakeResp);
  });

  it('lança TimeoutError quando estoura o prazo', async () => {
    // fetch que só rejeita quando o signal aborta
    const fetchImpl = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    await expect(
      fetchWithTimeout('http://x', { fetchImpl } as never, 20),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});
