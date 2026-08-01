import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithRetry } from '../src/http.ts';

const URL = 'https://dennys.test/thing';

function res(status: number): Response {
  return new Response(status === 204 ? null : 'body', { status });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Kick off the call, drain the backoff timers, then resolve. */
async function run(...args: Parameters<typeof fetchWithRetry>) {
  const promise = fetchWithRetry(...args);
  await vi.runAllTimersAsync();
  return promise;
}

describe('fetchWithRetry — happy path', () => {
  it('returns immediately on a successful GET', async () => {
    fetchMock.mockResolvedValue(res(200));
    const r = await run(URL);
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('API_RETRIES=0', () => {
  it('makes exactly one attempt, no retries', async () => {
    // The end of the chain the config test starts: proves the parsed 0 reaches
    // fetchWithRetry, rather than the old `Number('0') || 2` giving back 2.
    const original = process.env.API_RETRIES;
    process.env.API_RETRIES = '0';
    vi.resetModules();
    try {
      const { fetchWithRetry } = await import('../src/http.ts');
      fetchMock.mockResolvedValue(res(500));
      const promise = fetchWithRetry(URL);
      await vi.runAllTimersAsync();
      const r = await promise;
      expect(r.status).toBe(500);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      if (original === undefined) delete process.env.API_RETRIES;
      else process.env.API_RETRIES = original;
      vi.resetModules();
    }
  });
});

describe('GET retry behavior (default 2 retries)', () => {
  it('retries on 500 and succeeds on a later attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(res(500))
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(200));
    const r = await run(URL);
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries on 408 and 429 (transient statuses)', async () => {
    for (const transient of [408, 429]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(res(transient)).mockResolvedValueOnce(res(200));
      const r = await run(URL);
      expect(r.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });

  it('gives up after exhausting retries and returns the last error response', async () => {
    fetchMock.mockResolvedValue(res(500));
    const r = await run(URL);
    expect(r.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it('does not retry a 4xx client error — it will not get better', async () => {
    fetchMock.mockResolvedValue(res(404));
    const r = await run(URL);
    expect(r.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws a descriptive error after transport failures exhaust retries', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('ECONNRESET');
    });
    // Attach the rejection handler before draining timers so the pending promise
    // is never momentarily unhandled.
    const assertion = expect(fetchWithRetry(URL)).rejects.toThrow(/failed after 3 attempt\(s\)/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('non-GET is never retried by default (guards against double-booking games)', () => {
  it('does not retry a POST even on a retryable 500', async () => {
    fetchMock.mockResolvedValue(res(500));
    const r = await run(URL, { method: 'POST' });
    expect(r.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a POST transport failure', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('ECONNRESET');
    });
    const assertion = expect(fetchWithRetry(URL, { method: 'POST' })).rejects.toThrow(
      /failed after 1 attempt\(s\)/,
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('honors an explicit retries opt-in on a non-GET call', async () => {
    fetchMock.mockResolvedValueOnce(res(500)).mockResolvedValueOnce(res(200));
    const r = await run(URL, { method: 'POST' }, { retries: 1 });
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('resource hygiene and error context', () => {
  it('cancels the body of a discarded response so undici releases the connection', async () => {
    const retried = new Response('err', { status: 500 });
    const cancelSpy = vi.spyOn(retried.body!, 'cancel').mockResolvedValue(undefined);
    fetchMock.mockResolvedValueOnce(retried).mockResolvedValueOnce(res(200));

    const r = await run(URL);
    expect(r.status).toBe(200);
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the original error as the thrown error\'s cause', async () => {
    const original = new Error('ECONNRESET');
    fetchMock.mockRejectedValue(original);

    const settled = fetchWithRetry(URL).catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await settled;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).cause).toBe(original);
  });
});

describe('Retry-After is honored over the default backoff', () => {
  it('waits the header-specified delay (seconds) before retrying', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }),
      )
      .mockResolvedValueOnce(res(200));

    const promise = fetchWithRetry(URL);
    // Default backoff would fire at 500ms; Retry-After says 2s, so nothing yet.
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1500); // now at 2000ms
    const r = await promise;
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
