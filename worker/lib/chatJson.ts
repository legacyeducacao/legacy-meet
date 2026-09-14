/**
 * Chamada texto → JSON a um endpoint de chat compatível com OpenAI
 * (/v1/chat/completions com response_format json_schema). Dois destinos:
 * - LLM Gateway da AssemblyAI (mesma chave da transcrição) — padrão no
 *   provider assemblyai, para o pipeline ficar em um fornecedor só;
 * - OpenRouter — usado pelo provider gemini (rollback).
 */
import { fetchWithTimeout } from './http';
import { RetryableError, withBackoff } from './retry';

export const ASSEMBLYAI_LLM_URL = 'https://llm-gateway.assemblyai.com/v1/chat/completions';
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Flash "cheio", não o lite: o mapeamento de falantes exige raciocínio sobre
// vocativos (caso real: o lite atribuiu à Sofia a voz que diz "a Sofia tá aí
// também"). O prompt é pequeno — a diferença de custo é de centavos.
export const DEFAULT_ASSEMBLYAI_LLM_MODEL = 'gemini-2.5-flash';

export interface ChatJsonRequest {
  url: string;
  headers: Record<string, string>;
  model: string;
  prompt: string;
  /** JSON schema estrito da resposta. */
  schema: unknown;
  schemaName?: string;
  timeoutMs: number;
  maxTokens?: number;
  /** Campos extras do corpo (ex.: post_processing_steps do gateway). */
  extraBody?: Record<string, unknown>;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

export function buildChatJsonBody(req: ChatJsonRequest): Record<string, unknown> {
  return {
    model: req.model,
    messages: [{ role: 'user', content: req.prompt }],
    response_format: {
      type: 'json_schema',
      json_schema: { name: req.schemaName ?? 'result', strict: true, schema: req.schema },
    },
    temperature: 0,
    max_tokens: req.maxTokens ?? 2048,
    ...(req.extraBody ?? {}),
  };
}

/** Devolve o `content` cru (string JSON) para o chamador parsear/validar. */
export async function chatJson(req: ChatJsonRequest): Promise<string> {
  return withBackoff(
    async () => {
      const resp = await fetchWithTimeout(
        req.url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...req.headers },
          body: JSON.stringify(buildChatJsonBody(req)),
          ...(req.fetchImpl ? { fetchImpl: req.fetchImpl } : {}),
        },
        req.timeoutMs,
      );
      if (!resp.ok) {
        const msg = `llm ${resp.status} (${new URL(req.url).host}): ${(await resp.text()).slice(0, 300)}`;
        if (resp.status === 429 || resp.status >= 500) throw new RetryableError(msg);
        throw new Error(msg);
      }
      const data: any = await resp.json();
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('llm sem content na resposta');
      return content;
    },
    { attempts: 3, baseMs: 2000, maxMs: 15000 },
  );
}

export interface LlmJsonOptions {
  apiKey: string;
  model: string;
  prompt: string;
  schema: unknown;
  schemaName?: string;
  timeoutMs: number;
  maxTokens?: number;
  fetchImpl?: ChatJsonRequest['fetchImpl'];
}

/** LLM Gateway da AssemblyAI: header `authorization: <api key>` (sem Bearer). */
export function assemblyAiLlmJson(opts: LlmJsonOptions): Promise<string> {
  return chatJson({
    url: ASSEMBLYAI_LLM_URL,
    headers: { authorization: opts.apiKey },
    // Conserto automático de JSON malformado antes de devolver (doc do gateway).
    extraBody: { post_processing_steps: [{ type: 'json-repair' }] },
    ...opts,
  });
}

export function openRouterJson(opts: LlmJsonOptions): Promise<string> {
  return chatJson({
    url: OPENROUTER_URL,
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'HTTP-Referer': 'https://meet.legacyexecutoria.com.br',
      'X-Title': 'Legacy Meet - Transcription Worker',
    },
    extraBody: { reasoning: { exclude: true } },
    ...opts,
  });
}
