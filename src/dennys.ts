
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
