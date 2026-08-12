/**
 * Response shapes for the Dennys API.
 *
 * Transcribed from the Kotlin DTOs on Dennys 1.4.0 rather than from its OpenAPI
 * file, which has drifted in several places (see docs/ARCHITECTURE.md).
 *
 * Fields Todd reads are strictly required, so a rename or a type change fails at
 * the seam instead of surfacing as `undefined` downstream. Everything else is
 * wrapped in `unread()` and degrades to null. Objects are non-strict, so unknown
 * keys are stripped rather than rejected and an additive release is a no-op.
 *
 * Dennys serializes with explicit nulls, so nullable fields are always present
 * as `null` rather than absent; `.nullish()` is slack in case that changes.
 */
import { z } from 'zod';

/**
 * A field Todd does not read. Degrades to null instead of failing the request.
 * Move a field out of `unread()` when something starts consuming it.
 */
const unread = <T extends z.ZodType>(schema: T) => schema.nullish().catch(null);

/** Read, but null is a usable answer ("unknown"), so a rename must not fail the request. */
const advisory = <T extends z.ZodType>(schema: T) => schema.nullish().catch(null);

/**
 * A string whose known values are documented but not enforced.
 *
 * Dennys serializes Kotlin enum identifiers verbatim, and `eventStages` flows
 * from the API into Todd's dropdowns and back out as a query param. A strict
 * `z.enum` would break the flow whenever a value is added server-side, and the
 * two sources already disagree - the OpenAPI file lists PROMOTION_RELEGATION,
 * EventStage.kt does not.
 */
const looseEnum = <const T extends readonly string[]>(known: T) =>
  z.string().describe(`known values: ${known.join(', ')}`) as unknown as z.ZodType<
    T[number] | (string & {})
  >;

export type EventStage = 'REGULAR_SEASON' | 'PLAYOFFS' | (string & {});
export const eventStageSchema = looseEnum(['REGULAR_SEASON', 'PLAYOFFS'] as const);

/** CANCELED is spelled with one L on the wire. */
export type EventStatus =
  | 'NOT_STARTED'
  | 'ACTIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELED'
  | (string & {});
export const eventStatusSchema = looseEnum([
  'NOT_STARTED',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'CANCELED',
] as const);

export const eventGroupSchema = z.object({
  id: z.number(),
  name: z.string(),
});

export const teamSchema = z.object({
  id: z.number(),
  name: z.string(),
  // `logo` is String? in TeamDto.kt; the OpenAPI file wrongly declares it
  // non-nullable. Nothing consumes it.
  logo: unread(z.string()),
  eventId: unread(z.number()),
});

/**
 * Shared by EventDto, EventWithTeamsDto and EventWithSeriesDto.
 *
 * `eventGroupId` is never populated by the two wrapper mappers, so it is always
 * null on /event/{id}/teams and /event/{id}/series. Only /event/{id} carries it.
 */
const eventFields = {
  id: z.number(),
  name: z.string(),
  eventStages: z.array(eventStageSchema),
  description: unread(z.string()),
  createdAt: unread(z.string()),
  startDate: unread(z.string()),
  endDate: unread(z.string()),
  status: unread(eventStatusSchema),
  eventGroupId: unread(z.number()),
};

export const eventSchema = z.object(eventFields);

export const eventGroupWithEventsSchema = z.object({
  id: z.number(),
  name: z.string(),
  // An event group with no events reads as an empty list, as it always has.
  events: z.array(eventSchema).default([]),
});

export const eventWithTeamsSchema = z.object({
  ...eventFields,
  teams: z.array(teamSchema),
});

export const seriesSchema = z.object({
  id: z.number(),
  // Always two entries, from a Pair<TeamId, TeamId>. Order does not imply blue/red.
  teamIds: z.array(z.number()),
  totalGames: z.number(),
  eventStage: eventStageSchema,
  // New in 1.4.0. Dennys closes a series on result write, and this is what keeps
  // a finished series out of the candidate set for the next code.
  completed: z.boolean(),
  eventId: unread(z.number()),
  completedAt: unread(z.string()),
  reopenedAt: unread(z.string()),
});

export const eventWithSeriesSchema = z.object({
  ...eventFields,
  series: z.array(seriesSchema),
});

/**
 * A code issued to Riot, created when it is requested. Returned by
 * POST /series/{id}/game. Replaced the old GameDto and has no `number`.
 */
export const tournamentCodeSchema = z.object({
  id: z.number(),
  shortcode: z.string(),
  seriesId: z.number(),
  blueTeamId: z.number(),
  redTeamId: z.number(),
  // Counted against `lastGameAt` to work out the codes left for this game.
  createdAt: advisory(z.string()),
});

export const gameResultSchema = z.object({
  // `winning`/`losing` on responses, `winner`/`loser` on requests. Both correct.
  winningTeamId: z.number(),
  losingTeamId: z.number(),
});

/**
 * A game that was played. Created at result-write time rather than at code-issue
 * time, so an unplayed code consumes no game number (dennys#189).
 *
 * `tournamentCodeId` and `riotMatchId` are nullable so a custom played without a
 * code still counts towards the series.
 */
export const gameSchema = z.object({
  id: z.number(),
  seriesId: z.number(),
  number: z.number(),
  result: gameResultSchema.nullish().catch(null),
  // Read, and load-bearing: this is how Todd tells "the game this button is for
  // is recorded" from "some game is recorded". Nullable rather than unread - a
  // custom is genuinely codeless - but a rename must fail at the seam.
  tournamentCodeId: z.number().nullable(),
  riotMatchId: unread(z.string()),
  createdAt: unread(z.string()),
});

export const seriesWithGamesSchema = seriesSchema.extend({
  tournamentCodes: z.array(tournamentCodeSchema),
  games: z.array(gameSchema),
  // Read, and the only evidence dennys carries for "has the newest code been
  // answered": nothing names a code that was abandoned for a custom, so the
  // ordering of these two is what says it has been superseded. Null until the
  // first code and the first game respectively - but degrading a rename to null
  // would silently turn the staleness warning and "Code not working?" off, so
  // they are required rather than unread.
  lastCodeIssuedAt: z.string().nullable(),
  lastGameAt: z.string().nullable(),
});

export const eventGroupListSchema = z.array(eventGroupSchema);

export type EventGroup = z.infer<typeof eventGroupSchema>;
export type EventGroupWithEvents = z.infer<typeof eventGroupWithEventsSchema>;
export type Event = z.infer<typeof eventSchema>;
export type EventWithTeams = z.infer<typeof eventWithTeamsSchema>;
export type EventWithSeries = z.infer<typeof eventWithSeriesSchema>;
export type Team = z.infer<typeof teamSchema>;
export type Series = z.infer<typeof seriesSchema>;
export type SeriesWithGames = z.infer<typeof seriesWithGamesSchema>;
export type TournamentCode = z.infer<typeof tournamentCodeSchema>;
export type Game = z.infer<typeof gameSchema>;
export type GameResult = z.infer<typeof gameResultSchema>;

/** Body of POST /series/{id}/game. */
export type CreateGameRequest = {
  blueTeamId: number;
  redTeamId: number;
};

/**
 * Body of POST /series/{id}/results. Every field is optional.
 *
 * `tournamentCodeId` and `shortcode` identify the same game two ways. The spec
 * calls them mutually exclusive, but Dennys accepts both and prefers
 * `tournamentCodeId`.
 */
export type ReportResultRequest = {
  winnerTeamId?: number;
  loserTeamId?: number;
  tournamentCodeId?: number;
  shortcode?: string;
};

/** Body of POST /series/{id}/complete. Both fields optional; `{}` is valid. */
export type CompleteSeriesRequest = {
  winnerTeamId?: number;
  loserTeamId?: number;
};
