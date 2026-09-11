import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const writeJson = vi.fn(async () => {});
vi.mock('@/lib/recordings', () => ({ writeJson: (...args: unknown[]) => writeJson(...args) }));

const { POST } = await import('./route');

function makeReq(opts: { secret?: string; body?: unknown; rawBody?: string; recordingId?: string }) {
  const url = new URL('https://meet.example/api/transcription/webhook');
  if (opts.recordingId) url.searchParams.set('recordingId', opts.recordingId);
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.secret ? { 'x-legacy-webhook-secret': opts.secret } : {}),
    },
    body: opts.rawBody ?? JSON.stringify(opts.body ?? {}),
  });
}

describe('POST /api/transcription/webhook', () => {
  beforeEach(() => {
    process.env.ASSEMBLYAI_WEBHOOK_SECRET = 'segredo';
    writeJson.mockClear();
  });
  afterEach(() => {
    delete process.env.ASSEMBLYAI_WEBHOOK_SECRET;
  });

  it('503 quando o secret não está configurado', async () => {
    delete process.env.ASSEMBLYAI_WEBHOOK_SECRET;
    const res = await POST(makeReq({ secret: 'x', body: { transcript_id: 't', status: 'completed' } }));
    expect(res.status).toBe(503);
  });

  it('401 sem header ou com secret errado (4xx: AssemblyAI não retenta)', async () => {
    expect((await POST(makeReq({ body: { transcript_id: 't', status: 'completed' } }))).status).toBe(401);
    expect(
      (await POST(makeReq({ secret: 'errado', body: { transcript_id: 't', status: 'completed' } }))).status,
    ).toBe(401);
    expect(writeJson).not.toHaveBeenCalled();
  });

  it('400 com corpo inválido', async () => {
    expect((await POST(makeReq({ secret: 'segredo', rawBody: '{oops' }))).status).toBe(400);
    expect((await POST(makeReq({ secret: 'segredo', body: { status: 'completed' } }))).status).toBe(400);
    expect((await POST(makeReq({ secret: 'segredo', body: { transcript_id: '../x', status: 'completed' } }))).status).toBe(400);
  });

  it('200 e grava o marker asr-done/<transcript_id>.json com status e recordingId', async () => {
    const res = await POST(
      makeReq({
        secret: 'segredo',
        recordingId: 'sala__2026-09-11T10-00-00-000Z',
        body: { transcript_id: 'abc-123', status: 'completed' },
      }),
    );
    expect(res.status).toBe(200);
    expect(writeJson).toHaveBeenCalledTimes(1);
    const [key, value] = writeJson.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(key).toBe('asr-done/abc-123.json');
    expect(value).toMatchObject({ status: 'completed', recordingId: 'sala__2026-09-11T10-00-00-000Z' });
    expect(typeof value.at).toBe('string');
  });

  it('500 quando o MinIO falha (AssemblyAI retenta)', async () => {
    writeJson.mockRejectedValueOnce(new Error('minio fora'));
    const res = await POST(makeReq({ secret: 'segredo', body: { transcript_id: 't', status: 'error' } }));
    expect(res.status).toBe(500);
  });
});
