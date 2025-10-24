
import { config } from './config.ts';
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
  teams: Team[];
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

export const getEventGroups = async (): Promise<eventGroup[]> => {
  const response = await fetch(`${API_URL}/eventGroup`);
  if (response.ok) {
    const data: eventGroup[] = await response.json();
    return data;
  }
  throw new Error(`Failed to fetch event groups: ${response.statusText}`);
}

export const getEvents = async (eventGroup: number): Promise<Event[]> => {
  const response = await fetch(`${API_URL}/eventGroup/${eventGroup}/events`);
  if (response.ok) {
    const data: eventGroupWithEvents = await response.json();
    return data.events;
  }
  throw new Error(`Failed to fetch events: ${response.statusText}`);
};

export const getEvent = async (eventId: number): Promise<Event> => {
  const response = await fetch(`${API_URL}/event/${eventId}`);
  logger.info(`Fetching event ${eventId} from ${API_URL}/event/${eventId}`);
  if (response.ok) {
    const data:Event = await response.json();
    return data;
  }
  throw new Error(`Failed to fetch event: ${response.statusText}`);
}


export const getEventWithTeams = async (eventId: number): Promise<EventWithTeams> => {
  const response = await fetch(`${API_URL}/event/${eventId}/teams`);
  if (response.ok) {
    const data: EventWithTeams = await response.json();
    return data;
  }
  throw new Error(`Failed to fetch event with teams: ${response.statusText}`);
};


export const getTeam = async (teamId: number): Promise<Team> => {
  const response = await fetch(`${API_URL}/team/${teamId}`);
  if (response.ok) {
    const data: Team = await response.json();
    return data;
  }
  throw new Error(`Failed to fetch team: ${response.statusText}`);
};

export const getTotalGames = async (eventId: number, team1:number, team2: number): Promise<number> => {
  const response = await fetch(`${API_URL}/event/${eventId}/series`);
  if (response.ok) {
    const body = await response.json();
    const seriesList: Series[] = body.series;
    console.log(seriesList);
    for (const s of seriesList) {
      if (Array.isArray(s.teamIds) && s.teamIds.includes(team1) && s.teamIds.includes(team2)) {
        console.log(`Found matching series: ${JSON.stringify(s)} for teams ${team1} and ${team2} with totalGames: ${s.totalGames}`);
        return s.totalGames;
      }
    }
    return 0;
  }
  throw new Error(`Failed to fetch team: ${response.statusText}`);
}


export const createGame = async (blueside: Team, redside: Team): Promise<Game> => {
  const response = await fetch(`${API_URL}/series/game`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      blueTeamId: blueside.id,
      redTeamId: redside.id
    })
  });
  if(response.ok) {
    const data: Game= await response.json();
    return data;
  }
  throw new Error(`Failed to fetch team: ${response.statusText}`);
};


// export const regenerateGameCode = async (gameId: number): Promise<Game> => {
//   return { id: 1, blueTeamId: teams[0].id, redTeamId: teams[1].id, shortcode: 'SHORTCODE_PLACEHOLDER', number: 1, seriesId: 1 };
// };
