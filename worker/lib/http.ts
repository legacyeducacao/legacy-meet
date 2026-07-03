export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

type InitWithImpl = RequestInit & {
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
};

// fetch com AbortController: se estourar timeoutMs, aborta e lança TimeoutError
// (retryável). Evita que uma requisição pendurada congele o worker.
export async function fetchWithTimeout(
  url: string,
  init: InitWithImpl | undefined,
  timeoutMs: number,
): Promise<Response> {
  const { fetchImpl, ...rest } = init ?? {};
  const doFetch = fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await doFetch(url, { ...rest, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) {
      throw new TimeoutError(`timeout após ${timeoutMs}ms: ${url}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
