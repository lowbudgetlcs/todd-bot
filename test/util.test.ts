import { describe, it, expect, vi, beforeEach } from 'vitest';

// getDraftLinksMarkdown reaches the network through fetchWithRetry; stub it so we
// test util's behavior, not HTTP. buildThreadName is pure and untouched by this.
vi.mock('../src/http.ts', () => ({ fetchWithRetry: vi.fn() }));

import { buildThreadName, getDraftLinksMarkdown } from '../src/util.ts';
import { fetchWithRetry } from '../src/http.ts';
import { config } from '../src/config.ts';

const mockedFetch = vi.mocked(fetchWithRetry);

// A lone (unpaired) surrogate — the exact thing that made startThread() throw
// Invalid Form Body (ARCHITECTURE.md#text-encoding).
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('buildThreadName', () => {
  const date = '2026-07-27';

  it('returns the full name unchanged when it already fits', () => {
    expect(buildThreadName('Blue', 'Red', date)).toBe(`Blue vs Red - ${date}`);
  });

  it("never exceeds Discord's 100-character thread-name cap", () => {
    const long = 'X'.repeat(80);
    const name = buildThreadName(long, long, date);
    expect(Array.from(name).length).toBeLessThanOrEqual(100);
  });

  it('trims the team names but never the date', () => {
    const name = buildThreadName('L'.repeat(80), 'R'.repeat(80), date);
    expect(name.endsWith(` - ${date}`)).toBe(true);
  });

  it('truncates by code point, never leaving a split surrogate pair', () => {
    // Each 😀 is a surrogate pair; a naive slice would cut one in half.
    const emojiTeam = '😀'.repeat(60);
    const name = buildThreadName(emojiTeam, emojiTeam, date);
    expect(Array.from(name).length).toBeLessThanOrEqual(100);
    expect(LONE_SURROGATE.test(name)).toBe(false);
  });
});

describe('getDraftLinksMarkdown', () => {
  // Braces matter: an arrow that *returns* the mock would be treated by vitest
  // as an afterEach teardown callback and get invoked, re-throwing our stub.
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it('builds markdown links from the backend response on success', async () => {
    mockedFetch.mockResolvedValue(
      new Response(JSON.stringify({ fearlessCode: 'FC', team1Code: 'T1', team2Code: 'T2' }), {
        status: 200,
      }),
    );
    const md = await getDraftLinksMarkdown('Blue', 'Red', 'TOURNEY', 3);
    expect(md).toContain(`${config.LOWBUDGETLCS_DRAFT_URL}/fearless/FC/T1`);
    expect(md).toContain(`${config.LOWBUDGETLCS_DRAFT_URL}/fearless/FC/T2`);
    expect(md).toContain('[Blue Link]');
    expect(md).toContain('[Red Link]');
    expect(md).toContain('/fearless/FC/spectator');
  });

  it('degrades to the manual-draft message on a non-ok response (best effort)', async () => {
    mockedFetch.mockResolvedValue(new Response('boom', { status: 500 }));
    const md = await getDraftLinksMarkdown('Blue', 'Red', 'TOURNEY', 3);
    expect(md).toBe('Error generating draft links! Please do so manually :)');
  });

  it('degrades to the manual-draft message when the request throws', async () => {
    mockedFetch.mockRejectedValue(new Error('network down'));
    const md = await getDraftLinksMarkdown('Blue', 'Red', 'TOURNEY', 3);
    expect(md).toBe('Error generating draft links! Please do so manually :)');
  });
});
