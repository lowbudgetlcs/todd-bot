import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * dennys.ts is the whole backend surface, and every call goes through one of two
 * shapes: `apiGet` for reads, a hand-rolled POST for `createGame`. These tests
 * mock the HTTP layer rather than the network, so what they pin down is the part
 * dennys.ts owns - URL construction, auth, response shape handling, the series
 * matching rules, and the retry policy on the one non-idempotent call.
 */

const { fetchWithRetry } = await vi.hoisted(async () => ({ fetchWithRetry: vi.fn() }));

vi.mock('../src/http.ts', async importOriginal => {
  // HttpError is thrown by dennys.ts itself, so keep the real class - otherwise
  // `instanceof` assertions here would be testing a stub.
  const actual = await importOriginal<typeof import('../src/http.ts')>();
  return { ...actual, fetchWithRetry };
});

const {
  getEventGroups,
  getEvents,
  getEvent,
  getEventWithTeams,
  getTeam,
  getTotalGames,
  getSeriesId,
  createGame,
} = await import('../src/dennys.ts');
const { HttpError } = await import('../src/http.ts');

const API_URL = 'https://dennys.test'; // seeded by test/setup.ts

/** A successful JSON response, encoded as real UTF-8 bytes like the API sends. */
function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

/**
 * UTF-8 bytes decoded as Latin-1 - the corruption apiGet is supposed to undo.
 * Same helper as encoding.test.ts: true Latin-1, one code point per byte, not
 * the Windows-1252 rendering a human sees.
 */
function mojibake(s: string): string {
  let out = '';
  for (const b of new TextEncoder().encode(s)) out += String.fromCharCode(b);
  return out;
}

function fail(status: number, body = 'nope'): Response {
  return new Response(body, { status, statusText: 'Error' });
}

/** The URL of the nth fetchWithRetry call. */
const urlOf = (n = 0) => fetchWithRetry.mock.calls[n][0] as string;
/** The RequestInit of the nth call. */
const initOf = (n = 0) => fetchWithRetry.mock.calls[n][1] as RequestInit;
/** The fetchWithRetry options of the nth call. */
const optsOf = (n = 0) => fetchWithRetry.mock.calls[n][2] as { retries?: number };

beforeEach(() => {
  fetchWithRetry.mockReset();
});

describe('request construction', () => {
  it('concatenates the path straight onto API_URL', async () => {
    // Why API_URL has to carry the /api/v1 prefix itself - see DEVELOPMENT.md.
    fetchWithRetry.mockResolvedValue(ok([]));
    await getEventGroups();
    expect(urlOf()).toBe(`${API_URL}/eventGroup`);
  });

  it('sends the bearer token on reads', async () => {
    fetchWithRetry.mockResolvedValue(ok({ id: 1, name: 'Div', eventStages: [] }));
    await getEvent(1);
    expect(urlOf()).toBe(`${API_URL}/event/1`);
    expect(initOf().headers).toMatchObject({ Authorization: 'Bearer test-dennys-token' });
  });

  it('sends the bearer token on the game POST', async () => {
    fetchWithRetry.mockResolvedValue(ok({ id: 9, shortcode: 'ABC', number: 1 }));
    await createGame(5, { id: 11, name: 'A', logo: null, eventId: 1 }, { id: 22, name: 'B', logo: null, eventId: 1 });
    expect(urlOf()).toBe(`${API_URL}/series/5/game`);
    expect(initOf().method).toBe('POST');
    expect(initOf().headers).toMatchObject({ Authorization: 'Bearer test-dennys-token' });
    expect(JSON.parse(initOf().body as string)).toEqual({ blueTeamId: 11, redTeamId: 22 });
  });
});

describe('createGame is never retried', () => {
  it('passes retries: 0', async () => {
    // The anti-double-book invariant: creating a game is not idempotent, so a
    // replayed request books a second game against the same series. http.ts
    // already defaults non-GET to no retries; this pins that the call site does
    // not quietly opt back in.
    fetchWithRetry.mockResolvedValue(ok({ id: 9, shortcode: 'ABC', number: 1 }));
    await createGame(5, { id: 11, name: 'A', logo: null, eventId: 1 }, { id: 22, name: 'B', logo: null, eventId: 1 });
    expect(optsOf().retries).toBe(0);
  });

  it('throws an HttpError carrying the status and body when it fails', async () => {
    fetchWithRetry.mockResolvedValue(fail(409, 'series already has 3 games'));
    await expect(
      createGame(5, { id: 11, name: 'A', logo: null, eventId: 1 }, { id: 22, name: 'B', logo: null, eventId: 1 }),
    ).rejects.toMatchObject({
      name: 'HttpError',
      status: 409,
      body: 'series already has 3 games',
    });
  });
});

describe('reads surface failures as HttpError', () => {
  it('includes the status so callers can tell 404 from 500', async () => {
    // One Response per call on purpose: the body is a stream, and reading it
    // twice is exactly how the error text turns into '(unreadable)'.
    fetchWithRetry.mockResolvedValueOnce(fail(404, 'no such event'));
    const error = await getEvent(1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 404, body: 'no such event' });
  });
});

describe('response shapes', () => {
  it('unwraps the events array from the event group', async () => {
    fetchWithRetry.mockResolvedValue(ok({ id: 1, name: 'Split', events: [{ id: 7, name: 'Div A' }] }));
    const events = await getEvents(1);
    expect(events.map(e => e.id)).toEqual([7]);
  });

  it('returns an empty list when the event group has no events key', async () => {
    fetchWithRetry.mockResolvedValue(ok({ id: 1, name: 'Split' }));
    expect(await getEvents(1)).toEqual([]);
  });

  it('repairs mojibake in team names on the way through', async () => {
    // encoding.ts runs inside apiGet so every caller gets clean strings; this
    // pins that the wiring is actually in place, not just the helper.
    fetchWithRetry.mockResolvedValue(
      ok({ id: 3, name: mojibake('Todd’s Café ★'), logo: null, eventId: 1 }),
    );
    const team = await getTeam(3);
    expect(team.name).toBe('Todd’s Café ★');
  });

  it('repairs mojibake in nested team lists too', async () => {
    fetchWithRetry.mockResolvedValue(
      ok({ id: 1, name: 'Div', eventStages: [], teams: [{ id: 3, name: mojibake('Café') }] }),
    );
    const event = await getEventWithTeams(1);
    expect(event.teams[0].name).toBe('Café');
  });
});

describe('series lookup', () => {
  const series = {
    id: 756,
    eventId: 1,
    teamIds: [2, 8],
    eventStage: 'REGULAR_SEASON',
    totalGames: 3,
  };

  it('sends both team ids and the stage as query params', async () => {
    fetchWithRetry.mockResolvedValue(ok({ series: [series] }));
    await getSeriesId(1, 2, 8, 'REGULAR_SEASON');
    const url = new URL(urlOf());
    expect(url.pathname).toBe('/event/1/series');
    expect(url.searchParams.getAll('teamIds')).toEqual(['2', '8']);
    expect(url.searchParams.get('stage')).toBe('REGULAR_SEASON');
  });

  it('reads the nested {series:[...]} shape', async () => {
    fetchWithRetry.mockResolvedValue(ok({ series: [series] }));
    expect(await getSeriesId(1, 2, 8, 'REGULAR_SEASON')).toBe(756);
  });

  it('also tolerates a bare array', async () => {
    // The swagger and the live API have disagreed here before.
    fetchWithRetry.mockResolvedValue(ok([series]));
    expect(await getSeriesId(1, 2, 8, 'REGULAR_SEASON')).toBe(756);
  });

  it('reads totalGames off the same lookup', async () => {
    fetchWithRetry.mockResolvedValue(ok({ series: [series] }));
    expect(await getTotalGames(1, 2, 8, 'REGULAR_SEASON')).toBe(3);
  });

  it('returns 0 rather than throwing when nothing matches', async () => {
    // getTournamentCode turns the 0 into "Failed to find a matching series".
    fetchWithRetry.mockResolvedValue(ok({ series: [] }));
    expect(await getSeriesId(1, 2, 8, 'REGULAR_SEASON')).toBe(0);
    fetchWithRetry.mockResolvedValue(ok({ series: [] }));
    expect(await getTotalGames(1, 2, 8, 'REGULAR_SEASON')).toBe(0);
  });
});

describe('series matching is re-checked client-side', () => {
  // Dennys filters server-side, so these cases should not occur - the loop in
  // getSeriesForTeams is defence in depth. A silently widened filter upstream
  // would otherwise hand createGame the id of the wrong series, and a game
  // booked against the wrong series is not something we can undo.
  const base = { id: 756, eventId: 1, totalGames: 3 };

  it('rejects a series that is missing one of the two teams', async () => {
    fetchWithRetry.mockResolvedValue(
      ok({ series: [{ ...base, teamIds: [2, 99], eventStage: 'REGULAR_SEASON' }] }),
    );
    expect(await getSeriesId(1, 2, 8, 'REGULAR_SEASON')).toBe(0);
  });

  it('rejects a series from a different stage', async () => {
    fetchWithRetry.mockResolvedValue(
      ok({ series: [{ ...base, teamIds: [2, 8], eventStage: 'PLAYOFFS' }] }),
    );
    expect(await getSeriesId(1, 2, 8, 'REGULAR_SEASON')).toBe(0);
  });

  it('picks the matching series when the response carries extras', async () => {
    fetchWithRetry.mockResolvedValue(
      ok({
        series: [
          { ...base, id: 1, teamIds: [2, 8], eventStage: 'PLAYOFFS' },
          { ...base, id: 2, teamIds: [2, 8], eventStage: 'REGULAR_SEASON' },
        ],
      }),
    );
    expect(await getSeriesId(1, 2, 8, 'REGULAR_SEASON')).toBe(2);
  });
});
