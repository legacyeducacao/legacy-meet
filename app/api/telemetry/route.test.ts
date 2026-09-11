import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET } from './route';

const store = vi.hoisted(() => ({
  writeJson: vi.fn<(key: string, obj: unknown) => Promise<void>>(async () => {}),
  listJsonKeys: vi.fn<(prefix: string) => Promise<string[]>>(async () => []),
  readJson: vi.fn(async () => null),
  user: null as null | { isAdmin: boolean },
}));
vi.mock('@/lib/recordings', () => ({
  writeJson: store.writeJson,
  listJsonKeys: store.listJsonKeys,
  readJson: store.readJson,
}));
vi.mock('@/lib/auth', () => ({ getCurrentUser: async () => store.user }));

const post = (body: unknown) =>
  POST(
    new NextRequest('https://meet.example/api/telemetry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

describe('POST /api/telemetry', () => {
  beforeEach(() => {
    store.writeJson.mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('grava o evento no MinIO em telemetry/<dia>/ e loga uma linha JSON', async () => {
    const res = await post({
      evt: 'media_error',
      at: '2026-09-11T10:00:00.000Z',
      room: 'sala',
      identity: 'Ana__ab12',
      isHost: false,
      browser: { ua: 'Chrome', cores: 4 },
      data: { source: 'camera', name: 'NotReadableError' },
    });
    expect(res.status).toBe(200);
    expect(store.writeJson).toHaveBeenCalledTimes(1);
    const [key, value] = store.writeJson.mock.calls[0] as [string, Record<string, unknown>];
    expect(key).toMatch(/^telemetry\/\d{4}-\d{2}-\d{2}\/.+\.json$/);
    expect(value).toMatchObject({ evt: 'media_error', room: 'sala', data: { source: 'camera' } });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"telemetry":true'));
  });

  it('rejeita JSON inválido, evento fora do padrão e payload grande', async () => {
    expect((await post('{nope')).status).toBe(400);
    expect((await post({ evt: 'DROP TABLE' })).status).toBe(400);
    expect((await post({ evt: 'x'.repeat(9000) })).status).toBe(413);
    expect(store.writeJson).not.toHaveBeenCalled();
  });

  it('MinIO fora do ar não vira erro para o cliente', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    store.writeJson.mockRejectedValueOnce(new Error('minio'));
    expect((await post({ evt: 'reconnecting' })).status).toBe(200);
  });
});

describe('GET /api/telemetry', () => {
  it('só admin lista', async () => {
    store.user = null;
    expect((await GET(new NextRequest('https://meet.example/api/telemetry'))).status).toBe(401);
    store.user = { isAdmin: true };
    store.listJsonKeys.mockResolvedValueOnce(['telemetry/2026-09-11/a.json']);
    store.readJson.mockResolvedValueOnce({ evt: 'reconnecting', at: '2026-09-11T10:00:00.000Z' } as never);
    const res = await GET(new NextRequest('https://meet.example/api/telemetry?date=2026-09-11'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ evt: 'reconnecting', at: '2026-09-11T10:00:00.000Z' }]);
  });
});
