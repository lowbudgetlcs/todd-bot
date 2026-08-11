import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * dennys.ts is the whole backend surface, and every call goes through one of two
 * shapes: `apiGet` for reads, `apiSend` for the four writes. These tests mock the
 * HTTP layer rather than the network, so what they pin down is the part dennys.ts
 * owns - URL construction, auth, response validation, the series matching rules,
 * and the retry policy on the non-idempotent calls.
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
  getSeries,
  getNextGameNumber,
  issueTournamentCode,
  reportSeriesResult,
  completeSeries,
  reopenSeries,
  isRiotGatewayError,
  isRetryableRiotGatewayError,
  DennysSchemaError,
} = await import('../src/dennys.ts');
const { HttpError } = await import('../src/http.ts');

const API_URL = 'https://dennys.test'; // seeded by test/setup.ts
const WHEN = '2026-08-09T00:00:00Z';

/** A successful JSON response, encoded as real UTF-8 bytes like the API sends. */
function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
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

/**
 * Fixtures carry every field Dennys sends, because the schemas are strict about
 * the ones Todd reads. Overriding is how a test says which field it is about.
 */
const anEvent = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Div A',
  description: 'A division',
  createdAt: WHEN,
  startDate: WHEN,
  endDate: WHEN,
  status: 'ACTIVE',
  eventGroupId: 3,
  eventStages: ['REGULAR_SEASON'],
  ...over,
});

const aTeam = (over: Record<string, unknown> = {}) => ({
  id: 11,
  name: 'Team 11',
  logo: null,
  eventId: 1,
  ...over,
});

const aSeries = (over: Record<string, unknown> = {}) => ({
  id: 756,
  eventId: 1,
  teamIds: [2, 8],
  totalGames: 3,
  eventStage: 'REGULAR_SEASON',
  completed: false,
  completedAt: null,
  reopenedAt: null,
  ...over,
});

const aCode = (over: Record<string, unknown> = {}) => ({
  id: 9,
  shortcode: 'ABC123',
  seriesId: 756,
  blueTeamId: 11,
  redTeamId: 22,
  createdAt: WHEN,
  ...over,
});

const aGame = (over: Record<string, unknown> = {}) => ({
  id: 4,
  seriesId: 756,
  number: 1,
  result: null,
  tournamentCodeId: 9,
  riotMatchId: null,
  createdAt: WHEN,
  ...over,
});

const aSeriesWithGames = (over: Record<string, unknown> = {}) => ({
  ...aSeries(),
  tournamentCodes: [],
  games: [],
  lastCodeIssuedAt: null,
  lastGameAt: null,
  ...over,
});

const anEventWithSeries = (series: unknown[]) => ({ ...anEvent(), series });

const BLUE = aTeam({ id: 11, name: 'A' });
const RED = aTeam({ id: 22, name: 'B' });

/** The URL of the nth fetchWithRetry call. */
const urlOf = (n = 0) => fetchWithRetry.mock.calls[n][0] as string;
/** The RequestInit of the nth call. */
const initOf = (n = 0) => fetchWithRetry.mock.calls[n][1] as RequestInit;
/** The fetchWithRetry options of the nth call. */
const optsOf = (n = 0) => fetchWithRetry.mock.calls[n][2] as { retries?: number };
/** The parsed request body of the nth call. */
const bodyOf = (n = 0) => JSON.parse(initOf(n).body as string);

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
    fetchWithRetry.mockResolvedValue(ok(anEvent()));
    await getEvent(1);
    expect(urlOf()).toBe(`${API_URL}/event/1`);
    expect(initOf().headers).toMatchObject({ Authorization: 'Bearer test-dennys-token' });
  });

  it('sends the bearer token and the team ids on the code POST', async () => {
    fetchWithRetry.mockResolvedValue(ok(aCode(), 201));
    await issueTournamentCode(5, BLUE, RED);
    expect(urlOf()).toBe(`${API_URL}/series/5/game`);
    expect(initOf().method).toBe('POST');
    expect(initOf().headers).toMatchObject({ Authorization: 'Bearer test-dennys-token' });
    expect(bodyOf()).toEqual({ blueTeamId: 11, redTeamId: 22 });
  });
});

describe('writes are never retried', () => {
  // The anti-double-book invariant: none of these are idempotent, so a replayed
  // request books a second code or a second result. http.ts already defaults
  // non-GET to no retries; this pins that no call site quietly opts back in.
  it.each([
    ['issueTournamentCode', () => issueTournamentCode(5, BLUE, RED), aCode()],
    ['reportSeriesResult', () => reportSeriesResult(5, { winnerTeamId: 2 }), aGame()],
    ['completeSeries', () => completeSeries(5), aSeries({ completed: true })],
    ['reopenSeries', () => reopenSeries(5), aSeries()],
  ])('%s passes retries: 0', async (_name, call, response) => {
    fetchWithRetry.mockResolvedValue(ok(response));
    await call();
    expect(optsOf().retries).toBe(0);
  });

  it('throws an HttpError carrying the status and body when a write fails', async () => {
    fetchWithRetry.mockResolvedValue(fail(409, 'series already has 3 games'));
    await expect(issueTournamentCode(5, BLUE, RED)).rejects.toMatchObject({
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

describe('a changed shape fails at the seam', () => {
  // The regression this exists for: `logoName` and later `Game.number` drifted
  // away under an unchecked cast and surfaced as `undefined` in a Discord
  // message rather than as an error anyone could act on.
  it('throws DennysSchemaError when a field Todd reads is missing', async () => {
    fetchWithRetry.mockResolvedValue(ok(aCode({ shortcode: undefined })));
    const error = await issueTournamentCode(5, BLUE, RED).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DennysSchemaError);
    expect(error).toMatchObject({ name: 'DennysSchemaError' });
    expect((error as InstanceType<typeof DennysSchemaError>).issues[0].path).toEqual(['shortcode']);
  });

  it('throws when a field Todd reads changes type', async () => {
    fetchWithRetry.mockResolvedValue(ok(aSeriesWithGames({ totalGames: '3' })));
    await expect(getSeries(756)).rejects.toBeInstanceOf(DennysSchemaError);
  });

  it('tolerates a field Todd does not read going missing', async () => {
    // unread() fields degrade to null. Dennys renaming a description must not
    // take down a flow that never looks at it.
    fetchWithRetry.mockResolvedValue(ok(anEvent({ description: undefined, status: undefined })));
    const event = await getEvent(1);
    expect(event.name).toBe('Div A');
  });

  it('ignores fields Dennys adds', async () => {
    fetchWithRetry.mockResolvedValue(ok(aTeam({ id: 3, name: 'T', somethingNew: 'x' })));
    expect(await getTeam(3)).toEqual({ id: 3, name: 'T', logo: null, eventId: 1 });
  });

  it('accepts an event stage it has never heard of', async () => {
    // eventStages goes straight into a dropdown and back out as a query param.
    // A stage added server-side must not break the flow.
    fetchWithRetry.mockResolvedValue(ok(anEvent({ eventStages: ['PROMOTION_RELEGATION'] })));
    expect((await getEvent(1)).eventStages).toEqual(['PROMOTION_RELEGATION']);
  });
});

describe('response shapes', () => {
  it('unwraps the events array from the event group', async () => {
    fetchWithRetry.mockResolvedValue(ok({ id: 1, name: 'Split', events: [anEvent({ id: 7 })] }));
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
    fetchWithRetry.mockResolvedValue(ok(aTeam({ id: 3, name: mojibake('Todd’s Café ★') })));
    const team = await getTeam(3);
    expect(team.name).toBe('Todd’s Café ★');
  });

  it('repairs mojibake in nested team lists too', async () => {
    fetchWithRetry.mockResolvedValue(
      ok({ ...anEvent(), teams: [aTeam({ id: 3, name: mojibake('Café') })] }),
    );
    const event = await getEventWithTeams(1);
    expect(event.teams[0].name).toBe('Café');
  });
});

describe('series lookup', () => {
  it('sends both team ids, the stage, and completed=false', async () => {
    fetchWithRetry.mockResolvedValue(ok(anEventWithSeries([aSeries()])));
    await getSeriesId(1, 2, 8, 'REGULAR_SEASON');
    const url = new URL(urlOf());
    expect(url.pathname).toBe('/event/1/series');
    expect(url.searchParams.getAll('teamIds')).toEqual(['2', '8']);
    expect(url.searchParams.get('stage')).toBe('REGULAR_SEASON');
    // Dennys closes a series on result write. Without this filter the next code
    // for the same pair lands in the series they already played.
    expect(url.searchParams.get('completed')).toBe('false');
  });

  it('reads the series off the event wrapper', async () => {
    fetchWithRetry.mockResolvedValue(ok(anEventWithSeries([aSeries()])));
    expect(await getSeriesId(1, 2, 8, 'REGULAR_SEASON')).toBe(756);
  });

  it('reads totalGames off the same lookup', async () => {
    fetchWithRetry.mockResolvedValue(ok(anEventWithSeries([aSeries()])));
    expect(await getTotalGames(1, 2, 8, 'REGULAR_SEASON')).toBe(3);
  });

  it('returns 0 rather than throwing when nothing matches', async () => {
    // getTournamentCode turns the 0 into "Failed to find a matching series".
    fetchWithRetry.mockResolvedValue(ok(anEventWithSeries([])));
    expect(await getSeriesId(1, 2, 8, 'REGULAR_SEASON')).toBe(0);
    fetchWithRetry.mockResolvedValue(ok(anEventWithSeries([])));
    expect(await getTotalGames(1, 2, 8, 'REGULAR_SEASON')).toBe(0);
  });
});

describe('series matching is re-checked client-side', () => {
  // Dennys filters server-side, so these cases should not occur - the loop in
  // getSeriesForTeams is defence in depth. A silently widened filter upstream
  // would otherwise hand issueTournamentCode the id of the wrong series, and a
  // code booked against the wrong series is not something we can undo.
  it('rejects a series that is missing one of the two teams', async () => {
    fetchWithRetry.mockResolvedValue(ok(anEventWithSeries([aSeries({ teamIds: [2, 99] })])));
    expect(await getSeriesId(1, 2, 8, 'REGULAR_SEASON')).toBe(0);
  });

  it('rejects a series from a different stage', async () => {
    fetchWithRetry.mockResolvedValue(ok(anEventWithSeries([aSeries({ eventStage: 'PLAYOFFS' })])));
    expect(await getSeriesId(1, 2, 8, 'REGULAR_SEASON')).toBe(0);
  });

  it('picks the matching series when the response carries extras', async () => {
    fetchWithRetry.mockResolvedValue(
      ok(
        anEventWithSeries([
          aSeries({ id: 1, eventStage: 'PLAYOFFS' }),
          aSeries({ id: 2, eventStage: 'REGULAR_SEASON' }),
        ]),
      ),
    );
    expect(await getSeriesId(1, 2, 8, 'REGULAR_SEASON')).toBe(2);
  });
});

describe('game numbering', () => {
  // Since the 1.4.0 split a game exists only once a result is written. Issuing a
  // code creates no game, so a code that is never played consumes no number -
  // reissuing for game 1 still reads as game 1.
  it('is 1 for a series with no games, however many codes were issued', async () => {
    fetchWithRetry.mockResolvedValue(
      ok(aSeriesWithGames({ tournamentCodes: [aCode(), aCode({ id: 10 })] })),
    );
    expect(await getNextGameNumber(756)).toBe(1);
    expect(urlOf()).toBe(`${API_URL}/series/756`);
  });

  it('advances once a result has been written', async () => {
    fetchWithRetry.mockResolvedValue(ok(aSeriesWithGames({ games: [aGame({ number: 1 })] })));
    expect(await getNextGameNumber(756)).toBe(2);
  });

  it('follows the highest game number, not the count', async () => {
    // Dennys derives it the same way, so a deleted middle game leaves a gap
    // rather than colliding with a number that already exists.
    fetchWithRetry.mockResolvedValue(
      ok(aSeriesWithGames({ games: [aGame({ number: 1 }), aGame({ id: 6, number: 3 })] })),
    );
    expect(await getNextGameNumber(756)).toBe(4);
  });
});

describe('series lifecycle', () => {
  it('reports a result and returns the game', async () => {
    fetchWithRetry.mockResolvedValue(
      ok(aGame({ result: { winningTeamId: 2, losingTeamId: 8 } }), 201),
    );
    const game = await reportSeriesResult(756, { winnerTeamId: 2, tournamentCodeId: 9 });
    expect(urlOf()).toBe(`${API_URL}/series/756/results`);
    expect(bodyOf()).toEqual({ winnerTeamId: 2, tournamentCodeId: 9 });
    expect(game.result).toEqual({ winningTeamId: 2, losingTeamId: 8 });
  });

  it('treats the idempotent 200 the same as the 201', async () => {
    fetchWithRetry.mockResolvedValue(ok(aGame({ number: 2 }), 200));
    expect((await reportSeriesResult(756, { shortcode: 'ABC123' })).number).toBe(2);
  });

  it('completes a series, defaulting to an empty body', async () => {
    fetchWithRetry.mockResolvedValue(ok(aSeries({ completed: true, completedAt: WHEN })));
    const series = await completeSeries(756);
    expect(urlOf()).toBe(`${API_URL}/series/756/complete`);
    expect(initOf().method).toBe('POST');
    expect(bodyOf()).toEqual({});
    expect(series.completed).toBe(true);
  });

  it('reopens a series with no request body', async () => {
    fetchWithRetry.mockResolvedValue(ok(aSeries({ reopenedAt: WHEN })));
    const series = await reopenSeries(756);
    expect(urlOf()).toBe(`${API_URL}/series/756/complete`);
    expect(initOf().method).toBe('DELETE');
    expect(initOf().body).toBeUndefined();
    expect(series.reopenedAt).toBe(WHEN);
  });
});

describe('riot gateway failures are distinguishable', () => {
  // 502 is a hard failure from Riot, 503 is Riot unreachable. Neither means the
  // series lookup was wrong, so neither should be reported to a captain as one.
  it.each([502, 503])('classifies %i as a gateway failure', status => {
    expect(isRiotGatewayError(new HttpError('boom', status, ''))).toBe(true);
  });

  it('does not classify a 404 as one', () => {
    expect(isRiotGatewayError(new HttpError('boom', 404, ''))).toBe(false);
    expect(isRiotGatewayError(new Error('network'))).toBe(false);
  });

  it('marks only 503 as worth another press', () => {
    expect(isRetryableRiotGatewayError(new HttpError('boom', 503, ''))).toBe(true);
    expect(isRetryableRiotGatewayError(new HttpError('boom', 502, ''))).toBe(false);
  });
});
