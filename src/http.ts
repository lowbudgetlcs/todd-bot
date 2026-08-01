import log from 'loglevel';
import { config } from './config.ts';

const logger = log.getLogger('http');
logger.setLevel('info');

/**
 * Per-attempt timeout. Dennys is occasionally slow, and previously a slow call
 * meant the Discord interaction token expired (3s) before we replied, which
 * surfaced as a crash. Now that every slow path defers first we have a ~15
 * minute budget, so we can afford to wait properly.
 *
 * Both values come from config.ts rather than process.env directly. That is
 * where env parsing and validation live, and it is also what calls
 * dotenv.config() - reading process.env here meant a local .env only applied if
 * config.ts happened to be evaluated first.
 */
export const DEFAULT_TIMEOUT_MS = config.API_TIMEOUT_MS;
const DEFAULT_RETRIES = config.API_RETRIES;
const RETRY_BASE_DELAY_MS = 500;
// Cap any single wait so a hostile or absurd Retry-After can't park a handler
// for minutes and blow past the interaction budget.
const MAX_RETRY_DELAY_MS = 30_000;

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
 * A Retry-After header is either delta-seconds or an HTTP date. Returns the wait
 * in ms, or undefined if absent/unparseable (caller then uses its own backoff).
 */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const when = Date.parse(header);
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return undefined;
}

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
  // A server-supplied Retry-After from the previous attempt, honored over our
  // own backoff on the next iteration.
  let retryAfterMs: number | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const backoff = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      const delay = Math.min(retryAfterMs ?? backoff, MAX_RETRY_DELAY_MS);
      retryAfterMs = undefined;
      logger.warn(`${label}: retry ${attempt}/${retries} in ${delay}ms`);
      await sleep(delay);
    }
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok && isRetryableStatus(response.status) && attempt < retries) {
        retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
        logger.warn(`${label}: got ${response.status}, will retry`);
        // undici keeps the connection alive until the body is read; we're
        // discarding this response, so release it explicitly.
        await response.body?.cancel().catch(() => {});
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
  // Keep the original error as `cause` so its stack isn't lost.
  throw new Error(`${label} failed after ${retries + 1} attempt(s): ${detail}`, {
    cause: lastError,
  });
}
