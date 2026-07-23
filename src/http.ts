import log from 'loglevel';

const logger = log.getLogger('http');
logger.setLevel('info');

/**
 * Per-attempt timeout. Dennys is occasionally slow, and previously a slow call
 * meant the Discord interaction token expired (3s) before we replied, which
 * surfaced as a crash. Now that every slow path defers first we have a ~15
 * minute budget, so we can afford to wait properly.
 */
export const DEFAULT_TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS) || 20_000;
const DEFAULT_RETRIES = Number(process.env.API_RETRIES) || 2;
const RETRY_BASE_DELAY_MS = 500;

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 408/429 and 5xx are worth another attempt; 4xx generally is not.
const isRetryableStatus = (status: number) =>
  status === 408 || status === 429 || status >= 500;

/**
 * fetch with a real timeout and bounded retries on transient failures.
 *
 * Never retries non-idempotent calls unless explicitly told to, so a flaky
 * network can't create duplicate games.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: { timeoutMs?: number; retries?: number; label?: string } = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const method = (init.method ?? 'GET').toUpperCase();
  // Only replay requests that are safe to replay.
  const retries = opts.retries ?? (method === 'GET' ? DEFAULT_RETRIES : 0);
  const label = opts.label ?? `${method} ${url}`;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      logger.warn(`${label}: retry ${attempt}/${retries} in ${delay}ms`);
      await sleep(delay);
    }
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok && isRetryableStatus(response.status) && attempt < retries) {
        logger.warn(`${label}: got ${response.status}, will retry`);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      const reason = error instanceof Error ? error.name : String(error);
      logger.warn(`${label}: attempt ${attempt + 1} failed (${reason})`);
      if (attempt === retries) break;
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${label} failed after ${retries + 1} attempt(s): ${detail}`);
}
