import { config } from './config.ts';
import { normalizeApiStrings, parseJsonResponseUtf8 } from './encoding.ts';
import { fetchWithRetry, HttpError } from './http.ts';
import log from 'loglevel';

const logger =log.getLogger('dennys');
logger.setLevel('info');

export type eventGroup = {
  id: number;
  name: string;
}

export type Event = {
  id: number;
  name: string;
  description: string;
  createdAt: string;
  startDate: string;
  endDate: string;
  status: string;
  eventGroupId: number;
  eventStages: string[];
};



export type eventGroupWithEvents = {
  id: number;
  name: string;
  events: Event[];
}


export type EventWithTeams = {
  id: number;
  name: string;
  description: string;
  createdAt: string;
  startDate: string;
  endDate: string;
  status: string;
  eventGroupId: number;
  teams: Team[];
  eventStages: string[];
};

export type Team = {
  id: number;
  name: string;
  // Dennys sends this as `logo` (confirmed against the live API); an earlier
  // `logoName` here silently read as undefined. Nothing consumes it today.
  logo: string | null;
  eventId: number | null;
};

export type Game = {
  id: number;
  blueTeamId: number;
  redTeamId: number;
  shortcode: string;
  seriesId: number
  number: number;
};

export type Series = {
  id: number;
  eventId: number;
  teamIds: number[];
  eventStage: string;
  totalGames: number;
};

const API_URL = config.API_URL;
// Data

const getAuthHeaders = () => ({
  'Authorization': `Bearer ${config.DENNYS_TOKEN}`,
});

/**
 * Shared GET against dennys: retries transient failures, decodes as UTF-8 and
 * repairs mojibake in one place so every caller gets clean strings.
 */
const apiGet = async <T>(path: string, label: string): Promise<T> => {
  const url = `${API_URL}${path}`;
  const response = await fetchWithRetry(url, { headers: getAuthHeaders() }, { label });
  if (!response.ok) {
    const body = await response.text().catch(() => '(unreadable)');
    logger.error(`${label} [${response.status}]: ${body}`);
    throw new HttpError(
      `${label} failed [${response.status} ${response.statusText}]`,
      response.status,
      body,
    );
  }
  const data = await parseJsonResponseUtf8<T>(response);
  return normalizeApiStrings(data);
};

export const getEventGroups = async (): Promise<eventGroup[]> =>
  apiGet<eventGroup[]>('/eventGroup', 'getEventGroups');

export const getEvents = async (eventGroup: number): Promise<Event[]> => {
  const data = await apiGet<eventGroupWithEvents>(
    `/eventGroup/${eventGroup}/events`,
    'getEvents',
  );
  return data.events ?? [];
};

export const getEvent = async (eventId: number): Promise<Event> => {
  logger.info(`Fetching event ${eventId} from ${API_URL}/event/${eventId}`);
  return apiGet<Event>(`/event/${eventId}`, `getEvent(${eventId})`);
};

export const getEventWithTeams = async (eventId: number): Promise<EventWithTeams> =>
  apiGet<EventWithTeams>(`/event/${eventId}/teams`, `getEventWithTeams(${eventId})`);

export const getTeam = async (teamId: number): Promise<Team> =>
  apiGet<Team>(`/team/${teamId}`, `getTeam(${teamId})`);

export const getTotalGames = async (
  eventId: number,
  team1:number,
  team2: number,
  stage: string,
): Promise<number> => {
  const matchingSeries = await getSeriesForTeams(eventId, team1, team2, stage);
  return matchingSeries?.totalGames ?? 0;
}

const getSeriesForTeams = async (
  eventId: number,
  team1:number,
  team2: number,
  stage: string,
): Promise<Series | null> => {
  const query = new URLSearchParams();
  query.append('teamIds', String(team1));
  query.append('teamIds', String(team2));
  query.append('stage', stage);
  const body = await apiGet<Series[] | { series?: Series[] }>(
    `/event/${eventId}/series?${query.toString()}`,
    'getSeriesForTeams',
  );
  const seriesList: Series[] = Array.isArray(body) ? body : (body.series ?? []);
  for (const s of seriesList) {
    // Dennys does filter on both query params server-side, so this loop is
    // normally re-checking an already-correct single result. It stays as
    // defence in depth: the match must be exact on both teams and the stage
    // before we hand the series id to createGame, and a silently widened
    // filter upstream would otherwise book a game against the wrong series.
    if (
      Array.isArray(s.teamIds) &&
      s.teamIds.includes(team1) &&
      s.teamIds.includes(team2) &&
      s.eventStage === stage
    ) {
      logger.info(
        `Found matching series ${s.id} for teams ${team1}/${team2}, stage ${stage}, with totalGames: ${s.totalGames}`,
      );
      return s;
    }
  }
  logger.warn(`No matching series for teams ${team1}/${team2} in event ${eventId}, stage ${stage}`);
  return null;
}

export const getSeriesId = async (
  eventId: number,
  team1:number,
  team2: number,
  stage: string,
): Promise<number> => {
  const matchingSeries = await getSeriesForTeams(eventId, team1, team2, stage);
  return matchingSeries?.id ?? 0;
}

export const createGame = async (seriesId: number, blueside: Team, redside: Team): Promise<Game> => {
  logger.info(`Creating game for series ${seriesId} with blue team ${blueside.id} and red team ${redside.id}`);
  // retries: 0 - creating a game is not idempotent, a replay could double-book.
  const response = await fetchWithRetry(
    `${API_URL}/series/${seriesId}/game`,
    {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({
        blueTeamId: blueside.id,
        redTeamId: redside.id
      })
    },
    { label: `createGame(series ${seriesId})`, retries: 0 },
  );
  if (response.ok) {
    const data = await parseJsonResponseUtf8<Game>(response);
    return normalizeApiStrings(data);
  }
  const errorBody = await response.text().catch(() => '(unreadable)');
  logger.error(`createGame [${response.status}]: ${errorBody}`);
  throw new HttpError(
    `Failed to create game [${response.status}]: ${errorBody}`,
    response.status,
    errorBody,
  );
};


// export const regenerateGameCode = async (gameId: number): Promise<Game> => {
//   return { id: 1, blueTeamId: teams[0].id, redTeamId: teams[1].id, shortcode: 'SHORTCODE_PLACEHOLDER', number: 1, seriesId: 1 };
// };
