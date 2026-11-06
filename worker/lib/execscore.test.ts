import { describe, expect, it, vi } from 'vitest';
import { createExecScoreNotifier } from './execscore';

describe('createExecScoreNotifier', () => {
  it('desligado sem secret ou sem URL base: não chama nada', async () => {
    const fetchImpl = vi.fn();
    const n = createExecScoreNotifier({ appBaseUrl: 'https://meet.x', fetchImpl: fetchImpl as never });
    expect(n.enabled).toBe(false);
    expect(await n.transcriptReady('sala__1')).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('envia o id com o secret no header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    const n = createExecScoreNotifier({ appBaseUrl: 'https://meet.x/', secret: 's3', fetchImpl: fetchImpl as never });
    expect(await n.transcriptReady('sala__1')).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://meet.x/api/execscore/transcricao-pronta');
    expect(init.headers['X-Execscore-Worker-Secret']).toBe('s3');
    expect(JSON.parse(init.body)).toEqual({ recordingId: 'sala__1' });
  });

  it('falha de rede ou 5xx não lança: só loga', async () => {
    const logs: string[] = [];
    const down = createExecScoreNotifier({
      appBaseUrl: 'https://meet.x', secret: 's', log: (m) => logs.push(m),
      fetchImpl: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as never,
    });
    expect(await down.sweep()).toBe(false);
    const err = createExecScoreNotifier({
      appBaseUrl: 'https://meet.x', secret: 's', log: (m) => logs.push(m),
      fetchImpl: vi.fn().mockResolvedValue(new Response('x', { status: 500 })) as never,
    });
    expect(await err.transcriptReady('a__b')).toBe(false);
    expect(logs.join('\n')).toMatch(/ECONNREFUSED[\s\S]*respondeu 500/);
  });
});
