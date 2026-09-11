import { fetchWithTimeout } from './http';
import { RetryableError, withBackoff } from './retry';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface OpenRouterJsonOptions {
  apiKey: string;
  model: string;
  prompt: string;
  /** JSON schema estrito da resposta (response_format json_schema). */
  schema: unknown;
  schemaName?: string;
  timeoutMs: number;
  maxTokens?: number;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

/**
 * Chamada de texto → JSON ao OpenRouter (Gemini por padrão), usada nas etapas
 * de pós-processamento (mapeamento de falantes; futuramente resumo/ata).
 * Devolve o `content` cru para o chamador parsear/validar.
 */
export async function openRouterJson(opts: OpenRouterJsonOptions): Promise<string> {
  return withBackoff(
    async () => {
      const resp = await fetchWithTimeout(
        OPENROUTER_URL,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://meet.legacyexecutoria.com.br',
            'X-Title': 'Legacy Meet - Transcription Worker',
          },
          body: JSON.stringify({
            model: opts.model,
            messages: [{ role: 'user', content: opts.prompt }],
            response_format: {
              type: 'json_schema',
              json_schema: { name: opts.schemaName ?? 'result', strict: true, schema: opts.schema },
            },
            temperature: 0,
            max_tokens: opts.maxTokens ?? 2048,
            reasoning: { exclude: true },
          }),
          ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
        },
        opts.timeoutMs,
      );
      if (!resp.ok) {
        const msg = `openrouter ${resp.status}: ${(await resp.text()).slice(0, 300)}`;
        if (resp.status === 429 || resp.status >= 500) throw new RetryableError(msg);
        throw new Error(msg);
      }
      const data: any = await resp.json();
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('openrouter sem content');
      return content;
    },
    { attempts: 3, baseMs: 2000, maxMs: 15000 },
  );
}
