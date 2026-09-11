import { describe, expect, it, vi, type Mock } from 'vitest';
import type { Transcript, TranscriptParams } from '../lib/assemblyai';
import { createAssemblyAIProvider, type AssemblyAIProviderConfig } from './assemblyai';
import type { PendingJob, TranscriptionInput } from './types';

type FakeClient = {
  submit: Mock<(p: TranscriptParams) => Promise<Transcript>>;
  get: Mock<(id: string) => Promise<Transcript>>;
  upload: Mock<(data: Buffer | Uint8Array) => Promise<string>>;
};

function fakeClient(over: Partial<FakeClient> = {}): FakeClient {
  return {
    submit: vi.fn(async (_p: TranscriptParams): Promise<Transcript> => ({ id: 't-1', status: 'queued' })),
    get: vi.fn(async (_id: string): Promise<Transcript> => ({ id: 't-1', status: 'processing' })),
    upload: vi.fn(async () => 'https://cdn.assemblyai.com/upload/x'),
    ...over,
  };
}

function makeInput(over: Partial<TranscriptionInput> = {}): TranscriptionInput {
  return {
    id: 'sala__2026-09-11T10-00-00-000Z',
    roomName: 'sala',
    participants: ['Ana Souza', 'Bruno Lima'],
    tmpDir: '/tmp/x',
    attempt: 0,
    sources: [
      {
        label: 'mix',
        signedUrl: async () => 'https://minio/legacy-meet/com-transcricao/x.mp4?sig=1',
        downloadTo: async () => {},
      },
    ],
    ...over,
  };
}

function makeProvider(client = fakeClient(), over: Partial<AssemblyAIProviderConfig> = {}) {
  let now = 0;
  const provider = createAssemblyAIProvider({
    client,
    speechModel: 'universal-3-5-pro',
    languageCode: 'pt',
    keyterms: ['Legacy Plan'],
    useParticipantCount: true,
    addons: { sentiment: false, entities: false },
    webhook: { baseUrl: 'https://app', headerName: 'X-S', headerValue: 'sec' },
    ratePerHourUsd: 0.28,
    pollMinIntervalMs: 60_000,
    pollMaxIntervalMs: 300_000,
    now: () => now,
    extractAudio: async () => {},
    readFile: async () => Buffer.from('mp3'),
    ...over,
  });
  return { provider, client, setNow: (t: number) => (now = t) };
}

const job = (over: Partial<PendingJob> = {}): PendingJob => ({
  recordingId: 'sala__2026-09-11T10-00-00-000Z',
  jobId: 't-1',
  submittedAt: new Date(0).toISOString(),
  lastCheckedAt: null,
  checks: 0,
  ...over,
});

describe('assemblyai provider — submit', () => {
  it('submete por URL assinada com pt, diarização, teto de falantes, keyterms e webhook', async () => {
    const { provider, client } = makeProvider();
    const out = await provider.submit(makeInput());
    expect(out).toEqual({ kind: 'pending', jobId: 't-1' });
    const params = client.submit.mock.calls[0][0];
    expect(params.audio_url).toContain('com-transcricao/x.mp4');
    expect(params.speech_models).toEqual(['universal-3-5-pro']);
    expect(params.language_code).toBe('pt');
    expect(params.language_detection).toBe(false);
    expect(params.speaker_labels).toBe(true);
    expect(params.speaker_options).toEqual({ max_speakers_expected: 2 });
    expect(params.keyterms_prompt).toEqual(['Legacy Plan', 'Ana Souza', 'Bruno Lima']);
    expect(params.webhook_url).toBe(
      'https://app/api/transcription/webhook?recordingId=sala__2026-09-11T10-00-00-000Z',
    );
    expect(params.webhook_auth_header_name).toBe('X-S');
    expect(params.webhook_auth_header_value).toBe('sec');
    expect(client.upload).not.toHaveBeenCalled();
  });

  it('sem participantes não manda teto de falantes; com flag desligada também não', async () => {
    const a = makeProvider();
    await a.provider.submit(makeInput({ participants: [] }));
    expect(a.client.submit.mock.calls[0][0].speaker_options).toBeUndefined();
    const b = makeProvider(fakeClient(), { useParticipantCount: false });
    await b.provider.submit(makeInput());
    expect(b.client.submit.mock.calls[0][0].speaker_options).toBeUndefined();
  });

  it('na segunda tentativa usa upload (áudio extraído) em vez da URL', async () => {
    const { provider, client } = makeProvider();
    const input = makeInput({ attempt: 1 });
    const dl = vi.fn(async () => {});
    input.sources[0].downloadTo = dl;
    await provider.submit(input);
    expect(dl).toHaveBeenCalled();
    expect(client.upload).toHaveBeenCalled();
    expect(client.submit.mock.calls[0][0].audio_url).toBe('https://cdn.assemblyai.com/upload/x');
  });

  it('erro 4xx na submissão é falha definitiva; 5xx/rede é retryável', async () => {
    const { AssemblyAIError } = await import('../lib/assemblyai');
    const bad = makeProvider(
      fakeClient({
        submit: vi.fn(async () => {
          throw new AssemblyAIError('assemblyai 401: chave inválida', 401);
        }),
      }),
    );
    expect(await bad.provider.submit(makeInput())).toMatchObject({ kind: 'error', retryable: false });
    const down = makeProvider(
      fakeClient({
        submit: vi.fn(async () => {
          throw new AssemblyAIError('assemblyai 503', 503);
        }),
      }),
    );
    expect(await down.provider.submit(makeInput())).toMatchObject({ kind: 'error', retryable: true });
  });
});

describe('assemblyai provider — poll', () => {
  it('respeita o backoff quando não há marker (não chama a API cedo demais)', async () => {
    const { provider, client, setNow } = makeProvider();
    setNow(30_000);
    const out = await provider.poll(job(), { doneMarker: false });
    expect(out).toEqual({ kind: 'pending', jobId: 't-1', checked: false });
    expect(client.get).not.toHaveBeenCalled();
    setNow(61_000);
    const out2 = await provider.poll(job(), { doneMarker: false });
    expect(out2).toEqual({ kind: 'pending', jobId: 't-1', checked: true });
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it('intervalo cresce com o número de checks e tem teto', async () => {
    const { provider, client, setNow } = makeProvider();
    const j = job({ checks: 2, lastCheckedAt: new Date(0).toISOString() });
    setNow(200_000); // 60s * 2^2 = 240s ainda não passou
    await provider.poll(j, { doneMarker: false });
    expect(client.get).not.toHaveBeenCalled();
    setNow(241_000);
    await provider.poll(j, { doneMarker: false });
    expect(client.get).toHaveBeenCalledTimes(1);
    const j2 = job({ checks: 10, lastCheckedAt: new Date(0).toISOString() });
    setNow(301_000); // teto de 300s (sem o teto seria 60s * 2^10)
    await provider.poll(j2, { doneMarker: false });
    expect(client.get).toHaveBeenCalledTimes(2);
  });

  it('com marker do webhook consulta na hora e devolve o resultado convertido', async () => {
    const client = fakeClient({
      get: vi.fn(async () => ({
        id: 't-1',
        status: 'completed' as const,
        audio_duration: 5400,
        speech_model_used: 'universal-3-5-pro',
        utterances: [
          { speaker: 'A', text: 'Bom dia.', start: 1000, end: 2000, confidence: 0.9 },
          { speaker: 'B', text: 'Bom dia!', start: 2500, end: 3200, confidence: 0.9 },
        ],
      })),
    });
    const { provider } = makeProvider(client);
    const out = await provider.poll(job(), { doneMarker: true });
    expect(out.kind).toBe('completed');
    if (out.kind !== 'completed') return;
    expect(out.result.utterances).toEqual([
      { speaker: 'A', text: 'Bom dia.', start: 1, end: 2 },
      { speaker: 'B', text: 'Bom dia!', start: 2.5, end: 3.2 },
    ]);
    expect(out.result.durationSeconds).toBe(5400);
    expect(out.result.audioDurationSeconds).toBe(5400);
    expect(out.result.model).toBe('universal-3-5-pro');
    expect(out.result.providerTranscriptId).toBe('t-1');
    expect(out.result.estimatedCostUsd).toBeCloseTo(0.42, 2);
    expect(out.result.skippedChunks).toEqual([]);
  });

  it('status error vira falha definitiva com o motivo', async () => {
    const client = fakeClient({
      get: vi.fn(async () => ({ id: 't-1', status: 'error' as const, error: 'Download error' })),
    });
    const { provider } = makeProvider(client);
    const out = await provider.poll(job(), { doneMarker: true });
    expect(out).toEqual({ kind: 'error', reason: 'Download error', retryable: false });
  });
});
