import { TimeoutError } from './http';

/** Erro que vale retentar (5xx, 429, timeout, rede). */
export class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

export interface BackoffOptions {
  baseMs: number;
  maxMs?: number;
  /** Fração de jitter aleatório (0..1) somada ao delay. Default 0.2. */
  jitter?: number;
}

// Backoff exponencial: base × 2^(tentativa-1), com teto e jitter para não
// sincronizar retries de várias gravações no mesmo instante.
export function backoffDelayMs(attempt: number, opts: BackoffOptions): number {
  const { baseMs, maxMs = 60_000, jitter = 0.2 } = opts;
  const raw = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(raw * (1 + jitter * Math.random()));
}

export interface WithBackoffOptions extends BackoffOptions {
  attempts: number;
  sleep?: (ms: number) => Promise<void>;
  /** Decide se um erro é retryável. Default: RetryableError ou TimeoutError. */
  isRetryable?: (e: unknown) => boolean;
  onRetry?: (attempt: number, e: unknown, delayMs: number) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const defaultIsRetryable = (e: unknown) =>
  e instanceof RetryableError || e instanceof TimeoutError;

export async function withBackoff<T>(fn: () => Promise<T>, opts: WithBackoffOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  const isRetryable = opts.isRetryable ?? defaultIsRetryable;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isRetryable(e) || attempt === opts.attempts) throw e;
      lastErr = e;
      const delay = backoffDelayMs(attempt, opts);
      opts.onRetry?.(attempt, e, delay);
      await sleep(delay);
    }
  }
  throw lastErr;
}
