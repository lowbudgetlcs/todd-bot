import { describe, it, expect, vi, afterEach } from 'vitest';

// config.ts calls dotenv.config() at import. Stub it out so a developer's real
// .env can't leak into these assertions - they are all about what a given
// process.env produces.
vi.mock('dotenv', () => ({ default: { config: () => ({ parsed: {} }) } }));

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
  vi.restoreAllMocks();
});

/** Re-imports config.ts under a given env. The values are read at import time. */
async function loadConfigWith(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  return (await import('../src/config.ts')).config;
}

describe('API_RETRIES', () => {
  it('honors an explicit 0', async () => {
    // The bug: `Number('0') || 2` is 2, so the one setting you reach for
    // mid-incident to stop retry amplification did nothing.
    const config = await loadConfigWith({ API_RETRIES: '0' });
    expect(config.API_RETRIES).toBe(0);
  });

  it('defaults to 2 when unset', async () => {
    const config = await loadConfigWith({ API_RETRIES: undefined });
    expect(config.API_RETRIES).toBe(2);
  });

  it('treats a blank value as unset rather than as zero', async () => {
    // `API_RETRIES=` in a .env file. Number('') is 0, so this has to be
    // separated from a deliberate "0" by hand.
    const config = await loadConfigWith({ API_RETRIES: '   ' });
    expect(config.API_RETRIES).toBe(2);
  });

  it('takes a real value', async () => {
    const config = await loadConfigWith({ API_RETRIES: '5' });
    expect(config.API_RETRIES).toBe(5);
  });

  it('falls back on a negative value instead of disabling every attempt', async () => {
    // retries = -1 makes fetchWithRetry's `attempt <= retries` loop never run,
    // so the call would fail without a single request being made.
    const config = await loadConfigWith({ API_RETRIES: '-1' });
    expect(config.API_RETRIES).toBe(2);
  });
});

describe('API_TIMEOUT_MS', () => {
  it('defaults to 20s when unset', async () => {
    const config = await loadConfigWith({ API_TIMEOUT_MS: undefined });
    expect(config.API_TIMEOUT_MS).toBe(20_000);
  });

  it('takes a real value', async () => {
    const config = await loadConfigWith({ API_TIMEOUT_MS: '45000' });
    expect(config.API_TIMEOUT_MS).toBe(45_000);
  });

  it('falls back on 0 rather than aborting every request instantly', async () => {
    // Unlike API_RETRIES, zero is not a meaningful setting here -
    // AbortSignal.timeout(0) has no "no timeout" reading.
    const config = await loadConfigWith({ API_TIMEOUT_MS: '0' });
    expect(config.API_TIMEOUT_MS).toBe(20_000);
  });
});

describe('unparseable tunables', () => {
  it('falls back to the default without throwing', async () => {
    // A typo in an optional knob must not stop the bot from booting, unlike
    // the required variables config.ts gates on.
    const config = await loadConfigWith({ API_RETRIES: 'two', API_TIMEOUT_MS: 'soon' });
    expect(config.API_RETRIES).toBe(2);
    expect(config.API_TIMEOUT_MS).toBe(20_000);
  });

  it('truncates a fractional value instead of passing it through', async () => {
    const config = await loadConfigWith({ API_RETRIES: '2.9' });
    expect(config.API_RETRIES).toBe(2);
  });
});
