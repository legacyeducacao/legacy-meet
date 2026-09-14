import { describe, expect, it, vi } from 'vitest';
import { AssemblyAIClient, AssemblyAIError, buildTranscriptParams, estimateCostUsd } from './assemblyai';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function makeClient(fetchImpl: (url: string, init: RequestInit) => Promise<Response>) {
  return new AssemblyAIClient({
    apiKey: 'k',
    timeoutMs: 1000,
    fetchImpl,
    sleep: async () => {},
    retryAttempts: 3,
    retryBaseMs: 0,
  });
}

describe('buildTranscriptParams', () => {
  it('NÃO manda teto de falantes com um único participante conhecido', () => {
    // Regressão real: meta só com o host → max_speakers_expected=1 → a
    // AssemblyAI fundiu a reunião inteira num único falante.
    const body = buildTranscriptParams({
      audioUrl: 'https://minio/x.mp4',
      speechModel: 'universal-3-5-pro',
      languageCode: 'pt',
      keyterms: [],
      maxSpeakers: 1,
    });
    expect(body.speaker_options).toBeUndefined();
    expect(body.speaker_labels).toBe(true);
  });

  it('monta o corpo com modelo, pt fixo, diarização e keyterms', () => {
    const body = buildTranscriptParams({
      audioUrl: 'https://minio/x.mp4?sig=1',
      speechModel: 'universal-3-5-pro',
      languageCode: 'pt',
      keyterms: ['Legacy Plan'],
      maxSpeakers: 3,
      webhook: { url: 'https://app/api/transcription/webhook?recordingId=r1', headerName: 'X-S', headerValue: 'v' },
    });
    expect(body).toEqual({
      audio_url: 'https://minio/x.mp4?sig=1',
      speech_models: ['universal-3-5-pro'],
      language_code: 'pt',
      language_detection: false,
      speaker_labels: true,
      speaker_options: { max_speakers_expected: 3 },
      punctuate: true,
      format_text: true,
      keyterms_prompt: ['Legacy Plan'],
      sentiment_analysis: false,
      entity_detection: false,
      webhook_url: 'https://app/api/transcription/webhook?recordingId=r1',
      webhook_auth_header_name: 'X-S',
      webhook_auth_header_value: 'v',
    });
  });

  it('sem participantes, sem keyterms e sem webhook omite os campos', () => {
    const body = buildTranscriptParams({
      audioUrl: 'u',
      speechModel: 'universal-3-5-pro',
      languageCode: 'pt',
      keyterms: [],
    });
    expect(body).not.toHaveProperty('speaker_options');
    expect(body).not.toHaveProperty('speakers_expected');
    expect(body).not.toHaveProperty('keyterms_prompt');
    expect(body).not.toHaveProperty('webhook_url');
  });

  it('add-ons pagos podem ser ligados por configuração', () => {
    const body = buildTranscriptParams({
      audioUrl: 'u',
      speechModel: 'universal-3-5-pro',
      languageCode: 'pt',
      keyterms: [],
      addons: { sentiment: true, entities: true },
    });
    expect(body.sentiment_analysis).toBe(true);
    expect(body.entity_detection).toBe(true);
  });
});

describe('AssemblyAIClient', () => {
  it('submit envia POST /v2/transcript com a chave e devolve o id', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = makeClient(async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, { id: 't-1', status: 'queued' });
    });
    const r = await client.submit({ audio_url: 'u', speech_models: ['universal-3-5-pro'] });
    expect(r).toEqual({ id: 't-1', status: 'queued' });
    expect(calls[0].url).toBe('https://api.assemblyai.com/v2/transcript');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('k');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      audio_url: 'u',
      speech_models: ['universal-3-5-pro'],
    });
  });

  it('get busca GET /v2/transcript/{id}', async () => {
    let seen = '';
    const client = makeClient(async (url) => {
      seen = url;
      return jsonResponse(200, { id: 't-1', status: 'completed', utterances: [] });
    });
    const r = await client.get('t-1');
    expect(seen).toBe('https://api.assemblyai.com/v2/transcript/t-1');
    expect(r.status).toBe('completed');
  });

  it('4xx não retenta e lança AssemblyAIError com o status', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, { error: 'audio_url inacessível' }));
    const client = makeClient(fetchImpl);
    await expect(client.submit({ audio_url: 'u' })).rejects.toMatchObject({
      name: 'AssemblyAIError',
      status: 400,
      message: expect.stringContaining('audio_url inacessível'),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('5xx e 429 retentam com backoff até dar certo', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: 'busy' }))
      .mockResolvedValueOnce(jsonResponse(429, { error: 'slow down' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 't-2', status: 'queued' }));
    const client = makeClient(fetchImpl);
    const r = await client.submit({ audio_url: 'u' });
    expect(r.id).toBe('t-2');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('esgota as tentativas em 5xx persistente', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, { error: 'down' }));
    const client = makeClient(fetchImpl);
    await expect(client.get('x')).rejects.toBeInstanceOf(AssemblyAIError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('upload envia o binário para /v2/upload e devolve upload_url', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const client = makeClient(async (url, init) => {
      seen = { url, init };
      return jsonResponse(200, { upload_url: 'https://cdn.assemblyai.com/upload/abc' });
    });
    const r = await client.upload(Buffer.from('abc'));
    expect(r).toBe('https://cdn.assemblyai.com/upload/abc');
    expect(seen!.url).toBe('https://api.assemblyai.com/v2/upload');
    expect((seen!.init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/octet-stream',
    );
  });
});

describe('estimateCostUsd', () => {
  it('1h com diarização e keyterms ≈ US$ 0,28; sem keyterms ≈ 0,23', () => {
    expect(estimateCostUsd(3600, { keyterms: true })).toBeCloseTo(0.28, 4);
    expect(estimateCostUsd(3600, { keyterms: false })).toBeCloseTo(0.23, 4);
  });

  it('tarifa fixa por env substitui a tabela', () => {
    expect(estimateCostUsd(1800, { keyterms: true, ratePerHourUsd: 1 })).toBe(0.5);
  });
});
