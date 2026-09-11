/**
 * Cliente REST mínimo da AssemblyAI (sem SDK): criar transcrição, consultar
 * e upload. Parâmetros conforme a documentação (2026-09):
 * https://www.assemblyai.com/docs/pre-recorded-audio/api-reference/transcripts/submit
 */
import { fetchWithTimeout } from './http';
import { RetryableError, withBackoff } from './retry';
import type { AssemblyUtterance } from './utterances';

export const ASSEMBLYAI_BASE_URL = 'https://api.assemblyai.com';
export const DEFAULT_SPEECH_MODEL = 'universal-3-5-pro';

export type TranscriptStatus = 'queued' | 'processing' | 'completed' | 'error';

export interface TranscriptParams {
  audio_url: string;
  speech_models?: string[];
  language_code?: string;
  language_detection?: boolean;
  speaker_labels?: boolean;
  speakers_expected?: number;
  speaker_options?: { min_speakers_expected?: number; max_speakers_expected?: number };
  punctuate?: boolean;
  format_text?: boolean;
  keyterms_prompt?: string[];
  sentiment_analysis?: boolean;
  entity_detection?: boolean;
  webhook_url?: string;
  webhook_auth_header_name?: string;
  webhook_auth_header_value?: string;
}

export interface Transcript {
  id: string;
  status: TranscriptStatus;
  error?: string | null;
  text?: string | null;
  utterances?: AssemblyUtterance[] | null;
  /** Duração do áudio em segundos. */
  audio_duration?: number | null;
  speech_model_used?: string | null;
  speech_models?: string[] | null;
  language_code?: string | null;
  webhook_status_code?: number | null;
}

export class AssemblyAIError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'AssemblyAIError';
  }
}

export interface BuildParamsInput {
  audioUrl: string;
  speechModel: string;
  languageCode: string;
  keyterms: string[];
  /** Teto de falantes (participantes conhecidos). Omitido → o modelo decide. */
  maxSpeakers?: number;
  addons?: { sentiment?: boolean; entities?: boolean };
  webhook?: { url: string; headerName: string; headerValue: string };
}

// Idioma FIXO (pt) — sem detecção automática: todas as reuniões são em
// português do Brasil e a detecção só adiciona risco. Diarização com teto de
// falantes em vez de número exato: um participante que não falou faria o
// modelo dividir uma voz em duas. Add-ons pagos desligados por padrão (o
// resumo fica com o LLM); summarization/auto_chapters nem entram — estão
// deprecados e dão erro no Universal-3.5 Pro.
export function buildTranscriptParams(input: BuildParamsInput): TranscriptParams {
  const params: TranscriptParams = {
    audio_url: input.audioUrl,
    speech_models: [input.speechModel],
    language_code: input.languageCode,
    language_detection: false,
    speaker_labels: true,
    punctuate: true,
    format_text: true,
    sentiment_analysis: input.addons?.sentiment ?? false,
    entity_detection: input.addons?.entities ?? false,
  };
  if (input.maxSpeakers && input.maxSpeakers >= 1) {
    params.speaker_options = { max_speakers_expected: input.maxSpeakers };
  }
  if (input.keyterms.length) params.keyterms_prompt = input.keyterms;
  if (input.webhook) {
    params.webhook_url = input.webhook.url;
    params.webhook_auth_header_name = input.webhook.headerName;
    params.webhook_auth_header_value = input.webhook.headerValue;
  }
  return params;
}

// Tabela pública (2026-09), por hora de áudio: Universal-3.5 Pro US$ 0,21;
// diarização +0,02; keyterms +0,05; sentimento +0,02; entidades +0,08.
export const PRICE_USD_PER_HOUR = {
  base: 0.21,
  diarization: 0.02,
  keyterms: 0.05,
  sentiment: 0.02,
  entities: 0.08,
} as const;

export interface CostOptions {
  keyterms: boolean;
  sentiment?: boolean;
  entities?: boolean;
  /** Tarifa total por hora fixada por env — substitui a tabela. */
  ratePerHourUsd?: number;
}

// Custo estimado da transcrição para acompanhamento (não é a fatura).
export function estimateCostUsd(audioSeconds: number, opts: CostOptions): number {
  const hours = Math.max(0, audioSeconds) / 3600;
  const rate =
    opts.ratePerHourUsd ??
    PRICE_USD_PER_HOUR.base +
      PRICE_USD_PER_HOUR.diarization +
      (opts.keyterms ? PRICE_USD_PER_HOUR.keyterms : 0) +
      (opts.sentiment ? PRICE_USD_PER_HOUR.sentiment : 0) +
      (opts.entities ? PRICE_USD_PER_HOUR.entities : 0);
  return Math.round(hours * rate * 10000) / 10000;
}

export interface AssemblyAIClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  retryAttempts?: number;
  retryBaseMs?: number;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, e: unknown, delayMs: number) => void;
}

export class AssemblyAIClient {
  private readonly opts: Required<Pick<AssemblyAIClientOptions, 'apiKey' | 'baseUrl' | 'timeoutMs' | 'retryAttempts' | 'retryBaseMs'>> &
    AssemblyAIClientOptions;

  constructor(opts: AssemblyAIClientOptions) {
    this.opts = {
      baseUrl: ASSEMBLYAI_BASE_URL,
      timeoutMs: 60_000,
      retryAttempts: 4,
      retryBaseMs: 2_000,
      ...opts,
    };
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const { apiKey, baseUrl, timeoutMs, fetchImpl, sleep, retryAttempts, retryBaseMs, onRetry } = this.opts;
    return withBackoff(
      async () => {
        const resp = await fetchWithTimeout(
          `${baseUrl}${path}`,
          {
            ...init,
            headers: { Authorization: apiKey, ...(init.headers as Record<string, string>) },
            ...(fetchImpl ? { fetchImpl } : {}),
          },
          timeoutMs,
        );
        if (!resp.ok) {
          const text = (await resp.text().catch(() => '')).slice(0, 500);
          let detail = text;
          try {
            detail = JSON.parse(text)?.error ?? text;
          } catch {
            // corpo não-JSON
          }
          const msg = `assemblyai ${resp.status} em ${path}: ${detail}`;
          // 429 e 5xx são transitórios; 4xx (chave, parâmetros, URL) não.
          if (resp.status === 429 || resp.status >= 500) throw new RetryableError(msg);
          throw new AssemblyAIError(msg, resp.status);
        }
        return (await resp.json()) as T;
      },
      {
        attempts: retryAttempts,
        baseMs: retryBaseMs,
        maxMs: 30_000,
        sleep,
        onRetry,
      },
    ).catch((e) => {
      // Depois de esgotar os retries, o erro transitório vira AssemblyAIError
      // (status 0 = rede/timeout, 5xx = servidor) para o chamador tratar igual.
      if (e instanceof RetryableError) {
        const m = e.message.match(/assemblyai (\d{3})/);
        throw new AssemblyAIError(e.message, m ? Number(m[1]) : 0);
      }
      throw e;
    });
  }

  submit(params: TranscriptParams): Promise<Transcript> {
    return this.request<Transcript>('/v2/transcript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  get(id: string): Promise<Transcript> {
    return this.request<Transcript>(`/v2/transcript/${encodeURIComponent(id)}`, { method: 'GET' });
  }

  async upload(data: Buffer | Uint8Array): Promise<string> {
    const r = await this.request<{ upload_url: string }>('/v2/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data as unknown as RequestInit['body'],
    });
    if (!r.upload_url) throw new AssemblyAIError('upload sem upload_url', 0);
    return r.upload_url;
  }
}
