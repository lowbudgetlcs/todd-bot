import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createButtonData } from '../src/buttons/button.ts';
import { SeriesData } from '../src/types/toddData.ts';

/**
 * tournament.ts owns the main flow, and the two things worth pinning are both
 * about ordering rather than output:
 *
 * 1. The 3-second rule. `handleBothTeamSubmission` makes several sequential
 *    dennys calls and is the most likely path to outrun Discord's ack deadline.
 * 2. The custom_id budget check. A series whose stage name is too long to fit in
 *    a button has to be refused *before* the game is created in dennys -
 *    afterwards there is a real game with no way to drive it.
 */

const calls: string[] = [];

/** Games played against the series, swapped per test to drive the game number. */
let seriesGames: { id: number; seriesId: number; number: number }[] = [];

vi.mock('../src/dennys.ts', async importOriginal => {
  // nextGameNumber is pure, so keep the real one - the game number a captain
  // sees is derived here and a stub would only be testing itself.
  const actual = await importOriginal<typeof import('../src/dennys.ts')>();
  return {
    ...actual,
    getEvent: vi.fn(async (id: number) => {
      calls.push('getEvent');
      return { id, name: 'Division A', eventStages: ['REGULAR_SEASON'] };
    }),
    getEventWithTeams: vi.fn(async (id: number) => {
      calls.push('getEventWithTeams');
      return {
        id,
        name: 'Division A',
        eventStages: ['REGULAR_SEASON'],
        teams: [
          { id: 11, name: 'Team 11', logo: null, eventId: id },
          { id: 22, name: 'Team 22', logo: null, eventId: id },
        ],
      };
    }),
    getTeam: vi.fn(async (id: number) => {
      calls.push('getTeam');
      return { id, name: `Team ${id}`, logo: null, eventId: 1 };
    }),
    getSeriesId: vi.fn(async () => {
      calls.push('getSeriesId');
      return 756;
    }),
    issueTournamentCode: vi.fn(async () => {
      calls.push('issueTournamentCode');
      return {
        id: 9,
        shortcode: 'ABC123',
        seriesId: 756,
        blueTeamId: 11,
        redTeamId: 22,
        createdAt: '2026-08-09T00:00:00Z',
      };
    }),
    getSeries: vi.fn(async (id: number) => {
      calls.push('getSeries');
      return {
        id,
        eventId: 7,
        teamIds: [11, 22],
        totalGames: 3,
        eventStage: 'REGULAR_SEASON',
        completed: false,
        completedAt: null,
        reopenedAt: null,
        tournamentCodes: [],
        games: seriesGames,
        lastCodeIssuedAt: null,
        lastGameAt: null,
      };
    }),
  };
});

vi.mock('../src/util.ts', async importOriginal => {
  // buildThreadName is pure and already covered by util.test.ts - keep the real
  // one so this test exercises the same name Discord would receive.
  const actual = await importOriginal<typeof import('../src/util.ts')>();
  return {
    ...actual,
    getDraftLinksMarkdown: vi.fn(async () => {
      calls.push('getDraftLinksMarkdown');
      return 'draft links';
    }),
  };
});

const { handleBothTeamSubmission, handleTeamSelect } = await import('../src/commands/tournament.ts');

const ORIGINAL_USER = '123456789012345678';

const seriesData: SeriesData = {
  enemyCaptainId: '223456789012345678',
  divisionId: 7,
  team1Id: 11,
  team2Id: 22,
  stage: 'REGULAR_SEASON',
};

function makeInteraction(tag: string, data: SeriesData = seriesData, customId?: string) {
  const interaction = {
    customId: customId ?? createButtonData(tag, ORIGINAL_USER, data).serialize(),
    user: { id: ORIGINAL_USER },
    values: [] as string[],
    replied: false,
    deferred: false,
    isRepliable: () => true,
    isMessageComponent: () => true,
    // Defaults to the dropdown path; the Switch Sides / Cancel buttons flip this.
    isStringSelectMenu: () => true,
    guild: { members: { fetch: vi.fn(async () => ({ id: ORIGINAL_USER })) } },
    deferUpdate: vi.fn(async () => {
      calls.push('deferUpdate');
      interaction.deferred = true;
    }),
    deferReply: vi.fn(async () => {
      calls.push('deferReply');
      interaction.deferred = true;
    }),
    editReply: vi.fn(async (payload: unknown) => {
      calls.push('editReply');
      editReplyPayloads.push(payload);
    }),
    reply: vi.fn(async () => {
      calls.push('reply');
      interaction.replied = true;
    }),
    followUp: vi.fn(async () => {
      calls.push('followUp');
      return {
        startThread: vi.fn(async () => ({
          send: vi.fn(async (payload: { content?: string }) => {
            threadSends.push(payload?.content ?? '');
          }),
        })),
      };
    }),
    deleteReply: vi.fn(async () => {
      calls.push('deleteReply');
    }),
  };
  return interaction;
}

/**
 * The Switch Sides and Cancel buttons reach `handleTeamSelect` too, routed
 * there by `getButtonHandler`. A real ButtonInteraction has no `values` at all -
 * modelled here by deleting it - so the handler must decide what it is holding
 * rather than destructuring a property only the dropdowns carry.
 */
function makeButtonInteraction(tag: string, data: SeriesData = seriesData) {
  const interaction = makeInteraction(tag, data);
  interaction.isStringSelectMenu = () => false;
  delete (interaction as { values?: string[] }).values;
  return interaction;
}

let editReplyPayloads: unknown[] = [];
let threadSends: string[] = [];

/** First point the interaction is acknowledged, i.e. the 3s deadline stops mattering. */
const ackIndex = () =>
  calls.findIndex(c => c === 'deferUpdate' || c === 'deferReply' || c === 'reply');

/** A stage name too long to survive into a `generate_another_confirm` button. */
const OVERSIZED_STAGE = 'X'.repeat(70);

/**
 * A custom_id carrying an oversized stage, built by hand because `serialize()`
 * refuses to produce one. That is the case the check inside
 * `handleBothTeamSubmission` exists for: a button minted before the guard
 * existed is still sitting in a Discord message and can still be clicked.
 */
function legacyOversizedCustomId(tag: string): string {
  const base = createButtonData(tag, ORIGINAL_USER, { ...seriesData, stage: 'S' }).serialize();
  return `${base.slice(0, -1)}${OVERSIZED_STAGE}`;
}

beforeEach(() => {
  calls.length = 0;
  editReplyPayloads = [];
  threadSends = [];
  seriesGames = [];
});

describe('handleBothTeamSubmission acknowledges before touching dennys', () => {
  it('defers before the first backend call', async () => {
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(ackIndex()).toBeGreaterThanOrEqual(0);
    expect(ackIndex()).toBeLessThan(calls.indexOf('getEvent'));
  });

  it('issues the code and posts the series', async () => {
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(calls).toContain('issueTournamentCode');
    expect(interaction.followUp).toHaveBeenCalled();
  });

  it('resolves the series before minting a code', async () => {
    // A tournament code is a real Riot artifact, so everything that can fail
    // cheaply fails first - the same reason the custom_id check runs earlier.
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(calls.indexOf('getSeries')).toBeLessThan(calls.indexOf('issueTournamentCode'));
  });
});

describe('the game number tracks games played, not codes issued', () => {
  /** The "# Game N" header lands in the thread, not in the followUp. */
  const header = () => threadSends.find(c => c.includes('# Game')) ?? '';

  it('reads game 1 for a series nothing has been played in yet', async () => {
    // Reissuing a code must not advance the number: a code that is never played
    // produces no game, which is what the 1.4.0 split bought.
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(header()).toContain('# Game 1');
  });

  it('advances once a result has been written', async () => {
    seriesGames = [{ id: 4, seriesId: 756, number: 1 }];
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(header()).toContain('# Game 2');
  });

  it('resolves the series once, by id, for both the number and the Bo', async () => {
    // Previously the code and the Bo count came from two independent lookups by
    // team pair and could disagree (todd-bot#97).
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(calls.filter(c => c === 'getSeries')).toHaveLength(1);
    expect(calls).not.toContain('getTotalGames');
  });
});

describe('an oversized stage is refused before the game exists', () => {
  it('handleBothTeamSubmission stops before the code is issued', async () => {
    // The failure this prevents: the game is created, then the button carrying
    // the series context is too long for Discord and the series is stranded.
    const interaction = makeInteraction('confirm', seriesData, legacyOversizedCustomId('confirm'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(calls).not.toContain('issueTournamentCode');
    expect(calls).not.toContain('getSeriesId');
    expect(editReplyPayloads.at(-1)).toMatchObject({
      content: expect.stringContaining('too long'),
    });
  });

  it('still acknowledges the interaction rather than leaving it hanging', async () => {
    const interaction = makeInteraction('confirm', seriesData, legacyOversizedCustomId('confirm'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(ackIndex()).toBeGreaterThanOrEqual(0);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it('handleTeamSelect refuses at stage selection, the earliest point it can', async () => {
    const interaction = makeInteraction('stage_select', { ...seriesData, stage: '' });
    interaction.values = [OVERSIZED_STAGE];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleTeamSelect(interaction as any);

    expect(editReplyPayloads.at(-1)).toMatchObject({
      content: expect.stringContaining('too long'),
      components: [],
    });
  });
});

describe('handleTeamSelect on the normal path', () => {
  it('defers before hitting dennys', async () => {
    const interaction = makeInteraction('stage_select', { ...seriesData, stage: '' });
    interaction.values = ['REGULAR_SEASON'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleTeamSelect(interaction as any);

    expect(ackIndex()).toBeGreaterThanOrEqual(0);
    expect(ackIndex()).toBeLessThan(calls.indexOf('getEventWithTeams'));
  });

  it('renders the confirm step once both teams and a stage are chosen', async () => {
    const interaction = makeInteraction('stage_select', { ...seriesData, stage: '' });
    interaction.values = ['REGULAR_SEASON'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleTeamSelect(interaction as any);

    expect(editReplyPayloads.at(-1)).toMatchObject({
      content: expect.stringContaining('Please confirm'),
    });
  });
});

describe('handleTeamSelect on the button path (no values to read)', () => {
  it('swaps the sides for Switch Sides', async () => {
    const interaction = makeButtonInteraction('switch');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleTeamSelect(interaction as any);

    // Blue was 11 and red was 22 going in, so the confirm step must show them
    // the other way round - and must get there without touching `values`.
    expect(editReplyPayloads.at(-1)).toMatchObject({
      content: expect.stringContaining('Blue Side: Team 22'),
    });
    expect(editReplyPayloads.at(-1)).toMatchObject({
      content: expect.stringContaining('Red Side: Team 11'),
    });
  });

  it('clears both teams and the stage for Cancel', async () => {
    const interaction = makeButtonInteraction('cancel');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleTeamSelect(interaction as any);

    expect(editReplyPayloads.at(-1)).toMatchObject({
      content: expect.stringContaining('Not Selected!'),
    });
  });
});
