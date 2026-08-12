import { z } from 'zod';
import { config } from './config.ts';
import { normalizeApiStrings, parseJsonResponseUtf8 } from './encoding.ts';
import { fetchWithRetry, HttpError } from './http.ts';
import {
  eventGroupListSchema,
  eventGroupWithEventsSchema,
  eventSchema,
  eventWithSeriesSchema,
  eventWithTeamsSchema,
  gameSchema,
  seriesSchema,
  seriesWithGamesSchema,
  teamSchema,
  tournamentCodeSchema,
  type CompleteSeriesRequest,
  type CreateGameRequest,
  type Event,
  type EventGroup,
  type EventWithTeams,
  type Game,
  type ReportResultRequest,
  type Series,
  type SeriesWithGames,
  type Team,
  type TournamentCode,
} from './dennysSchemas.ts';
import log from 'loglevel';

const logger = log.getLogger('dennys');
logger.setLevel('info');

/** Shapes live in dennysSchemas.ts; re-exported so callers import from one module. */
export type {
  CompleteSeriesRequest,
  CreateGameRequest,
  Event,
  EventGroup,
  EventGroupWithEvents,
  EventStage,
  EventStatus,
  EventWithSeries,
  EventWithTeams,
  Game,
  GameResult,
  ReportResultRequest,
  Series,
  SeriesWithGames,
  Team,
  TournamentCode,
} from './dennysSchemas.ts';

const API_URL = config.API_URL;

const getAuthHeaders = () => ({
  'Authorization': `Bearer ${config.DENNYS_TOKEN}`,
});

/**
 * Dennys returned a payload that does not match the contract Todd was built
 * against - a renamed field, a changed type, a removed one.
 *
 * Distinct from HttpError: that is Dennys working and saying no, this is a shape
 * disagreement that needs a code change here. Carries the payload for the log.
 */
const summarizeIssues = (issues: z.ZodError['issues']) =>
  issues.map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');

export class DennysSchemaError extends Error {
  constructor(
    readonly label: string,
    readonly issues: z.ZodError['issues'],
    readonly payload: unknown,
  ) {
    super(`${label}: unexpected response shape from dennys (${summarizeIssues(issues)})`);
    this.name = 'DennysSchemaError';
  }
}

/** Enough of the payload to diagnose from, without dumping a full team list. */
const preview = (payload: unknown) => {
  const text = JSON.stringify(payload) ?? String(payload);
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
};

/**
 * The one path every Dennys call takes: retry transient failures, turn a non-2xx
 * into an HttpError, decode as UTF-8, repair mojibake, then validate.
 *
 * Normalizing before validating means zod checks the repaired strings.
 */
const request = async <S extends z.ZodType>(
  path: string,
  label: string,
  schema: S,
  init: RequestInit,
  retries?: number,
): Promise<z.infer<S>> => {
  const url = `${API_URL}${path}`;
  const opts = { label, ...(retries === undefined ? {} : { retries }) };
  const response = await fetchWithRetry(url, init, opts);
  if (!response.ok) {
    const body = await response.text().catch(() => '(unreadable)');
    logger.error(`${label} [${response.status}]: ${body}`);
    throw new HttpError(
      `${label} failed [${response.status} ${response.statusText}]`,
      response.status,
      body,
    );
  }
  const payload = normalizeApiStrings(await parseJsonResponseUtf8<unknown>(response));
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    logger.error(`${label}: ${summarizeIssues(parsed.error.issues)} - got ${preview(payload)}`);
    throw new DennysSchemaError(label, parsed.error.issues, payload);
  }
  return parsed.data;
};

const apiGet = <S extends z.ZodType>(path: string, label: string, schema: S): Promise<z.infer<S>> =>
  request(path, label, schema, { headers: getAuthHeaders() });

/**
 * Writes. `retries: 0` because none of these are idempotent - a replay books a
 * second code or a second result. http.ts already defaults non-GET to 0; passing
 * it explicitly keeps that visible at the seam where it matters.
 */
const apiSend = <S extends z.ZodType>(
  method: 'POST' | 'DELETE',
  path: string,
  label: string,
  schema: S,
  body?: unknown,
): Promise<z.infer<S>> =>
  request(
    path,
    label,
    schema,
    {
      method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    0,
  );

// Event groups and events

export const getEventGroups = async (): Promise<EventGroup[]> =>
  apiGet('/eventGroup', 'getEventGroups', eventGroupListSchema);

export const getEvents = async (eventGroup: number): Promise<Event[]> => {
  // Single wrapper object. The OpenAPI file declares an array, which is a spec bug.
  const data = await apiGet(
    `/eventGroup/${eventGroup}/events`,
    'getEvents',
    eventGroupWithEventsSchema,
  );
  return data.events;
};

export const getEvent = async (eventId: number): Promise<Event> => {
  logger.info(`Fetching event ${eventId} from ${API_URL}/event/${eventId}`);
  return apiGet(`/event/${eventId}`, `getEvent(${eventId})`, eventSchema);
};

export const getEventWithTeams = async (eventId: number): Promise<EventWithTeams> =>
  apiGet(`/event/${eventId}/teams`, `getEventWithTeams(${eventId})`, eventWithTeamsSchema);

export const getTeam = async (teamId: number): Promise<Team> =>
  apiGet(`/team/${teamId}`, `getTeam(${teamId})`, teamSchema);

// Series lookup

export const getTotalGames = async (
  eventId: number,
  team1: number,
  team2: number,
  stage: string,
): Promise<number> => {
  const matchingSeries = await getSeriesForTeams(eventId, team1, team2, stage);
  return matchingSeries?.totalGames ?? 0;
};

/**
 * Every open series for this exact team pair and stage, lowest id first.
 *
 * More than one is legitimate: a double round-robin, or a lower-bracket match
 * and a grand-final rematch, both of which land under the same `EventStage`.
 * Sorted here so "pick the lowest id" is well defined without depending on the
 * order dennys happens to return.
 */
export const findSeriesForTeams = async (
  eventId: number,
  team1: number,
  team2: number,
  stage: string,
): Promise<Series[]> => {
  const query = new URLSearchParams();
  query.append('teamIds', String(team1));
  query.append('teamIds', String(team2));
  query.append('stage', stage);
  // Dennys closes a series on result write. Without this filter a finished series
  // stays a candidate and the next code lands in the one already played.
  query.append('completed', 'false');
  const event = await apiGet(
    `/event/${eventId}/series?${query.toString()}`,
    'findSeriesForTeams',
    eventWithSeriesSchema,
  );
  // Dennys filters on both query params server-side, so this is normally
  // re-checking an already-correct result. Defence in depth: a widened filter
  // upstream would otherwise book a code against the wrong series.
  const matches = event.series
    .filter(s => s.teamIds.includes(team1) && s.teamIds.includes(team2) && s.eventStage === stage)
    .sort((a, b) => a.id - b.id);
  if (matches.length === 0) {
    logger.warn(`No matching series for teams ${team1}/${team2} in event ${eventId}, stage ${stage}`);
  } else {
    logger.info(
      `Found ${matches.length} series for teams ${team1}/${team2}, stage ${stage}: ${matches.map(s => `${s.id} (Bo${s.totalGames})`).join(', ')}`,
    );
  }
  return matches;
};

const getSeriesForTeams = async (
  eventId: number,
  team1: number,
  team2: number,
  stage: string,
): Promise<Series | null> =>
  (await findSeriesForTeams(eventId, team1, team2, stage))[0] ?? null;

export const getSeriesId = async (
  eventId: number,
  team1: number,
  team2: number,
  stage: string,
): Promise<number> => {
  const matchingSeries = await getSeriesForTeams(eventId, team1, team2, stage);
  return matchingSeries?.id ?? 0;
};

/** The series plus every code issued and every game played against it. */
export const getSeries = async (seriesId: number): Promise<SeriesWithGames> =>
  apiGet(`/series/${seriesId}`, `getSeries(${seriesId})`, seriesWithGamesSchema);

/**
 * Which game the next code is for.
 *
 * Highest so far plus one, matching how Dennys assigns it, so a deleted game
 * leaves a gap rather than colliding. Games exist only once a result has been
 * written, so an unplayed code does not advance this.
 */
export const nextGameNumber = (series: SeriesWithGames): number =>
  Math.max(0, ...series.games.map(game => game.number)) + 1;

export const getNextGameNumber = async (seriesId: number): Promise<number> =>
  nextGameNumber(await getSeries(seriesId));

// Writes

/**
 * Ask Riot for a tournament code, via Dennys. Called createGame before 1.4.0;
 * this creates a code, not a game - the game arrives when a result is written.
 */
export const issueTournamentCode = async (
  seriesId: number,
  blueside: Team,
  redside: Team,
): Promise<TournamentCode> => {
  logger.info(
    `Issuing tournament code for series ${seriesId} with blue team ${blueside.id} and red team ${redside.id}`,
  );
  const body: CreateGameRequest = { blueTeamId: blueside.id, redTeamId: redside.id };
  return apiSend(
    'POST',
    `/series/${seriesId}/game`,
    `issueTournamentCode(series ${seriesId})`,
    tournamentCodeSchema,
    body,
  );
};

/**
 * Record who won a game. 201 when newly recorded, 200 when Dennys already had
 * it; both return the game, so the distinction does not reach callers.
 *
 * Identify the game by `tournamentCodeId` or `shortcode`; sending both is
 * accepted, with `tournamentCodeId` winning. A result write is what closes a
 * series once enough games have been played.
 */
export const reportSeriesResult = async (
  seriesId: number,
  result: ReportResultRequest,
): Promise<Game> =>
  apiSend('POST', `/series/${seriesId}/results`, `reportSeriesResult(${seriesId})`, gameSchema, result);

/** Close a series by hand. 409 if it is already closed. An empty body is valid. */
export const completeSeries = async (
  seriesId: number,
  outcome: CompleteSeriesRequest = {},
): Promise<Series> =>
  apiSend('POST', `/series/${seriesId}/complete`, `completeSeries(${seriesId})`, seriesSchema, outcome);

/**
 * Reopen a closed series. 409 if it is not closed. Dennys stamps `reopenedAt`
 * once and never clears it, permanently disabling auto-completion for that
 * series - reopening is not free.
 */
export const reopenSeries = async (seriesId: number): Promise<Series> =>
  apiSend('DELETE', `/series/${seriesId}/complete`, `reopenSeries(${seriesId})`, seriesSchema);

/** Codes allowed for one game before dennys refuses, counted since the last result. */
export const TOURNAMENT_CODE_LIMIT = 2;

/** The code allowance for this game is spent. 409 on POST /series/{id}/game means this. */
export const isCodeLimitError = (error: unknown): error is HttpError =>
  error instanceof HttpError && error.status === 409;

/** Dennys names series by id; captains know them by team. See docs/ARCHITECTURE.md. */
const withoutSeriesId = (message: string): string =>
  message
    .replace(/^series\s+['"]?\d+['"]?\s+/i, 'This game ')
    .replace(/\s*\bfor\s+series\s+['"]?\d+['"]?/gi, '');

/** What dennys said, from its `{ code, message }` error body. Null if it did not say. */
export const dennysErrorMessage = (error: unknown): string | null => {
  if (!(error instanceof HttpError) || !error.body) return null;
  try {
    const parsed = normalizeApiStrings(JSON.parse(error.body) as { message?: unknown });
    const raw = typeof parsed?.message === 'string' ? parsed.message.trim() : '';
    const message = withoutSeriesId(raw).trim();
    if (!message) return null;
    return message.length > 500 ? `${message.slice(0, 500)}…` : message;
  } catch {
    return null;
  }
};

/**
 * Codes the game in progress may still take, or null when the series does not
 * carry enough to tell. Unknown is reported as such: the number gates a button.
 */
export const remainingCodeAllowance = (series: SeriesWithGames): number | null => {
  const since = series.lastGameAt ? Date.parse(series.lastGameAt) : 0;
  if (Number.isNaN(since)) return null;
  let issued = 0;
  for (const code of series.tournamentCodes) {
    if (!code.createdAt) return null;
    const at = Date.parse(code.createdAt);
    if (Number.isNaN(at)) return null;
    if (at > since) issued++;
  }
  return Math.max(0, TOURNAMENT_CODE_LIMIT - issued);
};

/** The newest code no game has been recorded against - what a result would be for. */
export const outstandingCodeId = (series: SeriesWithGames): number | null => {
  const answered = new Set(
    series.games.map(game => game.tournamentCodeId).filter((id): id is number => id != null),
  );
  return series.tournamentCodes
    .filter(code => !answered.has(code.id))
    .reduce<number | null>((newest, code) => (newest === null || code.id > newest ? code.id : newest), null);
};

/**
 * Code issue failed because of Riot rather than because of us: 502 is a hard
 * failure from Riot, 503 is Riot unreachable. Neither should read to a captain
 * as "no such series".
 */
export const isRiotGatewayError = (error: unknown): error is HttpError =>
  error instanceof HttpError && (error.status === 502 || error.status === 503);

/** Of the two, only 503 is worth pressing the button again for. */
export const isRetryableRiotGatewayError = (error: unknown): boolean =>
  error instanceof HttpError && error.status === 503;
