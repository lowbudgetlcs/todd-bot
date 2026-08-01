import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message } from 'discord.js';
import { createButtonData } from '../src/buttons/button.ts';
import { SeriesData } from '../src/types/toddData.ts';

/**
 * The two `createMessageComponentCollector` filters in tournament.ts are the
 * only thing that acknowledges a select menu. If a filter never matches, the
 * collector never fires, nothing calls deferUpdate(), and the user gets
 * "Todd didn't respond in time" after Discord's 3 second deadline - with no
 * error in the logs, because no handler ever ran.
 *
 * That is exactly what happened: the division filter matched on
 * `customId.startsWith('division_select')`, but custom_ids carry the compressed
 * wire code from TAG_CODES ('d'), not the readable tag. The filter was
 * permanently false and /start-series died at the first dropdown.
 *
 * So these tests feed each filter a custom_id built the same way production
 * builds it - `createButtonData(...).serialize()` - rather than a hand-written
 * string. A hand-written id would have passed the broken filter too.
 */

vi.mock('../src/dennys.ts', () => ({
  getEvents: vi.fn(async () => [
    { id: 7, name: 'Division A' },
    { id: 8, name: 'Division B' },
  ]),
  getEvent: vi.fn(async (id: number) => ({
    id,
    name: 'Division A',
    eventStages: ['REGULAR_SEASON'],
  })),
  getEventWithTeams: vi.fn(async (id: number) => ({
    id,
    name: 'Division A',
    eventStages: ['REGULAR_SEASON'],
    teams: [
      { id: 11, name: 'Team 11', logo: null, eventId: id },
      { id: 22, name: 'Team 22', logo: null, eventId: id },
    ],
  })),
  getTeam: vi.fn(),
  getSeriesId: vi.fn(),
  getTotalGames: vi.fn(),
  createGame: vi.fn(),
}));

const tournament = await import('../src/commands/tournament.ts');
const { handleDivisionSelect } = tournament;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const execute = (tournament as any).execute as (i: unknown, id: number | null) => Promise<void>;

const USER = '123456789012345678';
const STRANGER = '999999999999999999';
const EVENT_GROUP_ID = 42;

const seriesData: SeriesData = {
  enemyCaptainId: '223456789012345678',
  divisionId: 7,
  team1Id: 11,
  team2Id: 22,
  stage: 'REGULAR_SEASON',
};

/** A custom_id exactly as production would mint it, compressed tag and all. */
type ComponentInteraction = { user: { id: string }; customId: string };
function idFor(tag: string): ComponentInteraction {
  return { user: { id: USER }, customId: createButtonData(tag, USER, seriesData).serialize() };
}

type CollectorFilter = (i: ComponentInteraction) => boolean;

/** Captures whatever filter the code under test hands to its collector. */
let capturedFilter: CollectorFilter | null = null;

const fakeMessage = {
  createMessageComponentCollector: vi.fn((opts: { filter: CollectorFilter }) => {
    capturedFilter = opts.filter;
    return { on: vi.fn() };
  }),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeInteraction(overrides: Record<string, unknown> = {}): any {
  const interaction = {
    user: { id: USER },
    values: [] as string[],
    customId: '',
    replied: false,
    deferred: false,
    isRepliable: () => true,
    isMessageComponent: () => true,
    options: { getUser: () => ({ id: seriesData.enemyCaptainId }) },
    deferReply: vi.fn(async () => {
      interaction.deferred = true;
    }),
    deferUpdate: vi.fn(async () => {
      interaction.deferred = true;
    }),
    editReply: vi.fn(async () => fakeMessage),
    ...overrides,
  };
  return interaction;
}

beforeEach(() => {
  capturedFilter = null;
  fakeMessage.createMessageComponentCollector.mockClear();
});

/** Runs /start-series far enough to mint the division dropdown and its collector. */
async function divisionFilter(): Promise<CollectorFilter> {
  await execute(makeInteraction(), EVENT_GROUP_ID);
  expect(fakeMessage.createMessageComponentCollector).toHaveBeenCalled();
  return capturedFilter!;
}

/** Runs the division handler far enough to mint the team/stage collector. */
async function teamStageFilter(): Promise<CollectorFilter> {
  const interaction = makeInteraction({
    customId: createButtonData('division_select', USER, seriesData).serialize(),
    values: ['7'],
  });
  // A stand-in for the Message editReply returns: the handler only ever calls
  // createMessageComponentCollector on it.
  await handleDivisionSelect(interaction, fakeMessage as unknown as Message);
  expect(fakeMessage.createMessageComponentCollector).toHaveBeenCalled();
  return capturedFilter!;
}

describe('the division_select collector filter', () => {
  it('matches a custom_id that createButtonData actually produced', async () => {
    // The regression. This id begins with 'd:v1:', so any check against the
    // readable tag name fails here and the select is never acknowledged.
    const filter = await divisionFilter();
    expect(filter(idFor('division_select'))).toBe(true);
  });

  it('is not fooled by the readable tag name appearing nowhere in the id', async () => {
    // Pins the reason the old filter broke, so it cannot be reintroduced by
    // someone reaching for startsWith again.
    const { customId } = idFor('division_select');
    expect(customId.startsWith('division_select')).toBe(false);
    expect(customId.startsWith('d:')).toBe(true);
  });

  it('ignores another user clicking the same dropdown', async () => {
    const filter = await divisionFilter();
    expect(filter({ ...idFor('division_select'), user: { id: STRANGER } })).toBe(false);
  });

  it('ignores selects belonging to a later step of the flow', async () => {
    const filter = await divisionFilter();
    for (const tag of ['team1_select', 'team2_select', 'stage_select']) {
      expect(filter(idFor(tag)), tag).toBe(false);
    }
  });
});

describe('the team/stage collector filter', () => {
  it('matches every select the confirm step depends on', async () => {
    const filter = await teamStageFilter();
    for (const tag of ['team1_select', 'team2_select', 'stage_select']) {
      expect(filter(idFor(tag)), tag).toBe(true);
    }
  });

  it('ignores another user clicking the same dropdowns', async () => {
    const filter = await teamStageFilter();
    for (const tag of ['team1_select', 'team2_select', 'stage_select']) {
      expect(filter({ ...idFor(tag), user: { id: STRANGER } }), tag).toBe(false);
    }
  });

  it('ignores tags outside its step', async () => {
    const filter = await teamStageFilter();
    for (const tag of ['division_select', 'confirm', 'generate_another']) {
      expect(filter(idFor(tag)), tag).toBe(false);
    }
  });
});
