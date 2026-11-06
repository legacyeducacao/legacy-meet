/**
 * Chamada texto -> JSON no LLM Gateway da AssemblyAI (mesma chave e mesmo
 * fornecedor que o worker usa para separar os falantes). Só no servidor.
 */
export const ASSEMBLYAI_LLM_URL = 'https://llm-gateway.assemblyai.com/v1/chat/completions';

export type LlmJsonRequest = {
  prompt: string;
  /** JSON schema estrito da resposta. */
  schema: unknown;
  schemaName: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  temperature?: number;
  fetchImpl?: typeof fetch;
};

export function llmEnabled(): boolean {
  return !!process.env.ASSEMBLYAI_API_KEY;
}

export function buildLlmBody(req: LlmJsonRequest): Record<string, unknown> {
  return {
    model: req.model ?? 'gemini-2.5-flash',
    messages: [{ role: 'user', content: req.prompt }],
    response_format: {
      type: 'json_schema',
      json_schema: { name: req.schemaName, strict: true, schema: req.schema },
    },
    temperature: req.temperature ?? 0.2,
    max_tokens: req.maxTokens ?? 8000,
    // Conserto automático de JSON malformado antes de devolver (doc do gateway).
    post_processing_steps: [{ type: 'json-repair' }],
  };
}

/** Devolve o JSON já parseado. Tenta de novo em 429/5xx (até 3 vezes). */
export async function llmJson<T>(req: LlmJsonRequest): Promise<T> {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) throw new Error('ASSEMBLYAI_API_KEY não configurada');
  const doFetch = req.fetchImpl ?? fetch;
  let last: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await doFetch(ASSEMBLYAI_LLM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: key },
        body: JSON.stringify(buildLlmBody(req)),
        signal: AbortSignal.timeout(req.timeoutMs ?? 180_000),
      });
      if (!res.ok) {
        const msg = `IA respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`;
        if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(msg), { retry: true });
        throw new Error(msg);
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('IA sem conteúdo na resposta');
      return JSON.parse(content) as T;
    } catch (e) {
      last = e;
      const retry = (e as { retry?: boolean }).retry || (e instanceof Error && e.name === 'TimeoutError');
      if (!retry || attempt === 3) break;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
