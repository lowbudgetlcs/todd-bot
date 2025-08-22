// Types
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

// Data
const teams: Team[] = [
  { id: 1, name: 'team 1', logoName: null, eventId: 1 },
  { id: 2, name: 'team 2', logoName: null, eventId: 1 },
  { id: 5, name: 'team 5', logoName: null, eventId: 1 },
  { id: 3, name: 'team 3', logoName: null, eventId: 2 },
  { id: 4, name: 'team 4', logoName: null, eventId: 2 },
];
const events: Event[] = [
  {
    id: 1,
    name: 'Season 14 Commercial',
    description: "Season 14's plat-emerald league!",
    createdAt: '2025-08-21T03:54:08.602Z',
    startDate: '2025-08-21T03:54:08.602Z',
    endDate: '2025-08-21T03:54:08.602Z',
    status: 'NOT_STARTED',
    tournamentId: 1234,
  },
  {
    id: 2,
    name: 'Season 14 CEO',
    description: "Season 14's diamond-masters league!",
    createdAt: '2025-08-21T03:54:08.602Z',
    startDate: '2025-08-21T03:54:08.602Z',
    endDate: '2025-08-21T03:54:09.602Z',
    status: 'CANCELED',
    tournamentId: 1235,
  },
];

// Interface
export const getEvents = async (): Promise<Event[]> => {
  return events;
};

export const getEvent = async (eventId: number): Promise<Event | undefined> => {
  return events.find(e => (e.id === eventId));
};

export const getEventWithTeams = async (eventId: number): Promise<EventWithTeams | undefined> => {
  const event = await getEvent(eventId);
  if (event === undefined) return undefined;
  return { ...event, teams: await getTeamsFromEvent(eventId) };
};

export const getTeams = async (): Promise<Team[]> => {
  return teams;
};

export const getTeam = async (teamId: number): Promise<Team | undefined> => {
  return teams.find(t => (t.id === teamId));
};

export const getTeamsFromEvent = async (eventId: number): Promise<Team[]> => {
  return teams.filter(t => (t.eventId === eventId));
};

export const createGame = async (blueside: Team, redside: Team): Promise<Game> => {
  return { id: 1, blueSide: blueside, redSide: redside, shortcode: 'SHORTCODE_PLACEHOLDER', gameNumber: 1 };
};
