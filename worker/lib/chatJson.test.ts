import { describe, expect, it, vi } from 'vitest';
import { assemblyAiLlmJson, buildChatJsonBody, chatJson, openRouterJson } from './chatJson';

const ok = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };

describe('buildChatJsonBody', () => {
  it('monta response_format json_schema estrito com temperatura 0', () => {
    const body = buildChatJsonBody({
      url: 'u',
      headers: {},
      model: 'm',
      prompt: 'p',
      schema,
      schemaName: 'speaker_map',
      timeoutMs: 1,
    });
    expect(body).toMatchObject({
      model: 'm',
      messages: [{ role: 'user', content: 'p' }],
      response_format: { type: 'json_schema', json_schema: { name: 'speaker_map', strict: true, schema } },
      temperature: 0,
    });
  });
});

describe('assemblyAiLlmJson', () => {
  it('chama o LLM Gateway da AssemblyAI com a chave crua no header e json-repair', async () => {
    const fetchImpl = vi.fn(async () => ok('{"a":"x"}'));
    const content = await assemblyAiLlmJson({
      apiKey: 'k',
      model: 'gemini-2.5-flash-lite',
      prompt: 'p',
      schema,
      timeoutMs: 1000,
      fetchImpl,
    });
    expect(content).toBe('{"a":"x"}');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://llm-gateway.assemblyai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('k');
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'gemini-2.5-flash-lite',
      post_processing_steps: [{ type: 'json-repair' }],
    });
  });
});

describe('openRouterJson', () => {
  it('usa Bearer e a URL do OpenRouter', async () => {
    const fetchImpl = vi.fn(async () => ok('{}'));
    await openRouterJson({ apiKey: 'k', model: 'google/gemini-2.5-flash', prompt: 'p', schema, timeoutMs: 1000, fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
  });
});

describe('chatJson', () => {
  it('4xx lança sem retry; 5xx retenta', async () => {
    const bad = vi.fn(async () => new Response('nope', { status: 400 }));
    await expect(
      chatJson({ url: 'https://x/v1', headers: {}, model: 'm', prompt: 'p', schema, timeoutMs: 1000, fetchImpl: bad }),
    ).rejects.toThrow('400');
    expect(bad).toHaveBeenCalledTimes(1);

    const flaky = vi
      .fn()
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
      .mockResolvedValueOnce(ok('{"a":"y"}'));
    vi.useFakeTimers();
    const p = chatJson({ url: 'https://x/v1', headers: {}, model: 'm', prompt: 'p', schema, timeoutMs: 1000, fetchImpl: flaky });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe('{"a":"y"}');
    vi.useRealTimers();
    expect(flaky).toHaveBeenCalledTimes(2);
  });
});
