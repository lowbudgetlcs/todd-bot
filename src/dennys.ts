
import { config } from './config.ts';
import log from 'loglevel';

const logger =log.getLogger('dennys');
logger.setLevel('info');

export type Event = {
  id: number;
  name: string;
  description: string;
  createdAt: string;
  startDate: string;
  endDate: string;
  status: string;
  tournamentId: number;
};

export type EventWithTeams = {
  id: number;
  name: string;
  description: string;
  createdAt: string;
  startDate: string;
  endDate: string;
  status: string;
  tournamentId: number;
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
  blueSide: Team;
  redSide: Team;
  shortcode: string;
  gameNumber: number;
};

const API_URL = config.API_URL;
// Data
const teams: Team[] = [
  { id: 1, name: 'team 1', logoName: null, eventId: 1 },
  { id: 2, name: 'team 2', logoName: null, eventId: 1 },
  { id: 5, name: 'team 5', logoName: null, eventId: 1 },
  { id: 3, name: 'team 3', logoName: null, eventId: 2 },
  { id: 4, name: 'team 4', logoName: null, eventId: 2 },
];


// Interface
export const getEvents = async (): Promise<Event[]> => {
  const response = await fetch(`${API_URL}/event`);
  if (response.ok) {
    const data: Event[] = await response.json();
    return data;
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
  return { id: 1, blueSide: blueside, redSide: redside, shortcode: 'SHORTCODE_PLACEHOLDER', gameNumber: 1 };
};

export const regenerateGameCode = async (gameId: number): Promise<Game> => {
  return { id: 1, blueSide: teams[0], redSide: teams[1], shortcode: 'SHORTCODE_PLACEHOLDER', gameNumber: 1 };
};