import { config } from './config.ts';
import { normalizeApiStrings, parseJsonResponseUtf8 } from './encoding.ts';
import log from 'loglevel';

const logger =log.getLogger('dennys');
logger.setLevel('info');
[]
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
  logoName: string | null;
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
  totalGames: number;
};

const API_URL = config.API_URL;
// Data

const getAuthHeaders = () => ({
  'Authorization': `Bearer ${config.DENNYS_TOKEN}`,
});

export const getEventGroups = async (): Promise<eventGroup[]> => {
  const response = await fetch(`${API_URL}/eventGroup`, {
    headers: getAuthHeaders(),
  });
  if (response.ok) {
    const data = await parseJsonResponseUtf8<eventGroup[]>(response);
    return normalizeApiStrings(data);
  }
  throw new Error(`Failed to fetch event groups: ${response.statusText}`);
}

export const getEvents = async (eventGroup: number): Promise<Event[]> => {
  const response = await fetch(`${API_URL}/eventGroup/${eventGroup}/events`, {
    headers: getAuthHeaders(),
  });
  if (response.ok) {
    const data = await parseJsonResponseUtf8<eventGroupWithEvents>(response);
    return normalizeApiStrings(data.events);
  }
  throw new Error(`Failed to fetch events: ${response.statusText}`);
};

export const getEvent = async (eventId: number): Promise<Event> => {
  const response = await fetch(`${API_URL}/event/${eventId}`, {
    headers: getAuthHeaders(),
  });
  logger.info(`Fetching event ${eventId} from ${API_URL}/event/${eventId}`);
  if (response.ok) {
    const data = await parseJsonResponseUtf8<Event>(response);
    return normalizeApiStrings(data);
  }
  throw new Error(`Failed to fetch event: ${response.statusText}`);
}


export const getEventWithTeams = async (eventId: number): Promise<EventWithTeams> => {
  const response = await fetch(`${API_URL}/event/${eventId}/teams`, {
    headers: getAuthHeaders(),
  });
  if (response.ok) {
    const data = await parseJsonResponseUtf8<EventWithTeams>(response);
    return normalizeApiStrings(data);
  }
  throw new Error(`Failed to fetch event with teams: ${response.statusText}`);
};


export const getTeam = async (teamId: number): Promise<Team> => {
  const response = await fetch(`${API_URL}/team/${teamId}`, {
    headers: getAuthHeaders(),
  });
  if (response.ok) {
    const data = await parseJsonResponseUtf8<Team>(response);
    return normalizeApiStrings(data);
  }
  throw new Error(`Failed to fetch team: ${response.statusText}`);
};

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
  const response = await fetch(`${API_URL}/event/${eventId}/series?${query.toString()}`, {
    headers: getAuthHeaders(),
  });
  if (response.ok) {
    const body = await parseJsonResponseUtf8<Series[] | { series?: Series[] }>(response);
    const normalized = normalizeApiStrings(body);
    const seriesList: Series[] = Array.isArray(normalized) ? normalized : (normalized.series ?? []);
    console.log(seriesList);
    for (const s of seriesList) {
      if (Array.isArray(s.teamIds) && s.teamIds.includes(team1) && s.teamIds.includes(team2)) {
        console.log(`Found matching series: ${JSON.stringify(s)} for teams ${team1} and ${team2} with totalGames: ${s.totalGames}`);
        return s;
      }
    }
    return null;
  }
  throw new Error(`Failed to fetch team: ${response.statusText}`);
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
  const response = await fetch(`${API_URL}/series/${seriesId}/game`, {
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
  });
  if(response.ok) {
    const data = await parseJsonResponseUtf8<Game>(response);
    return normalizeApiStrings(data);
  }
  throw new Error(`Failed to fetch team: ${response.statusText}`);
};


// export const regenerateGameCode = async (gameId: number): Promise<Game> => {
//   return { id: 1, blueTeamId: teams[0].id, redTeamId: teams[1].id, shortcode: 'SHORTCODE_PLACEHOLDER', number: 1, seriesId: 1 };
// };
