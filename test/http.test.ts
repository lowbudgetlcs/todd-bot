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
