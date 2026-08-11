import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createButtonData } from '../src/buttons/button.ts';
import { SeriesData } from '../src/types/toddData.ts';

/**
 * ARCHITECTURE.md#the-3-second-rule: "Acknowledge first, then do the slow thing."
 *
 * These handlers each call dennys before answering the user, so the rule is the
 * only thing standing between a slow backend and a dead interaction token. It
 * was documented but not enforced, and three handlers had already drifted past
 * it, so these tests record the ordering rather than the end result: every
 * dennys call must happen *after* the interaction has been acknowledged.
 */

const calls: string[] = [];

vi.mock('../src/dennys.ts', () => ({
  getTeam: vi.fn(async (id: number) => {
    calls.push('getTeam');
    return { id, name: `Team ${id}` };
  }),
}));

vi.mock('../src/commands/tournament.ts', () => ({
  getTournamentCode: vi.fn(async () => {
    calls.push('getTournamentCode');
    return {
      discordResponse: 'Game 2 code',
      draftLinks: null,
      shortcode: 'ABC123',
      gameNumber: 2,
      error: null,
      divisionId: 7,
      team1Name: 'Team 11',
      team2Name: 'Team 22',
      tournamentCodeId: 1,
      totalGames: 3,
      seriesId: 756,
    };
  }),
}));

const { handleSwitchSides } = await import('../src/buttons/handlers/switchSides.ts');
const { handleGenerateAnotherCode } = await import(
  '../src/buttons/handlers/generateAnotherCode.ts'
);
const { handleGenerateAnotherConfirm } = await import(
  '../src/buttons/handlers/generateAnotherConfirm.ts'
);

const ORIGINAL_USER = '123456789012345678';

const seriesData: SeriesData = {
  enemyCaptainId: '223456789012345678',
  divisionId: 7,
  team1Id: 11,
  team2Id: 22,
  seriesId: 756,
  stage: 'Week 1',
};

/** A ButtonInteraction stub that records the order of everything it is asked to do. */
function makeInteraction(tag: string) {
  const interaction = {
    customId: createButtonData(tag, ORIGINAL_USER, seriesData).serialize(),
    user: { id: ORIGINAL_USER },
    replied: false,
    deferred: false,
    isRepliable: () => true,
    isMessageComponent: () => true,
    deferUpdate: vi.fn(async () => {
      calls.push('deferUpdate');
      interaction.deferred = true;
    }),
    deferReply: vi.fn(async () => {
      calls.push('deferReply');
      interaction.deferred = true;
    }),
    editReply: vi.fn(async () => {
      calls.push('editReply');
    }),
    reply: vi.fn(async () => {
      calls.push('reply');
      interaction.replied = true;
    }),
    followUp: vi.fn(async () => {
      calls.push('followUp');
    }),
    deleteReply: vi.fn(async () => {
      calls.push('deleteReply');
    }),
    update: vi.fn(async () => {
      calls.push('update');
    }),
  };
  return interaction;
}

/** Index of the first acknowledgement, i.e. the point the 3s deadline stops mattering. */
function ackIndex(): number {
  return calls.findIndex(c => c === 'deferUpdate' || c === 'deferReply' || c === 'reply');
}

beforeEach(() => {
  calls.length = 0;
});

describe('handlers acknowledge before calling dennys', () => {
  it('switchSides defers before either getTeam', async () => {
    const interaction = makeInteraction('switch_sides');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleSwitchSides(interaction as any);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(calls.filter(c => c === 'getTeam')).toHaveLength(2);
    expect(ackIndex()).toBeGreaterThanOrEqual(0);
    expect(ackIndex()).toBeLessThan(calls.indexOf('getTeam'));
  });

  it('generateAnotherCode defers before either getTeam', async () => {
    const interaction = makeInteraction('generate_another');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleGenerateAnotherCode(interaction as any);

    expect(interaction.deferReply).toHaveBeenCalled();
    expect(calls.filter(c => c === 'getTeam')).toHaveLength(2);
    expect(ackIndex()).toBeLessThan(calls.indexOf('getTeam'));
  });

  it('generateAnotherConfirm defers before getTournamentCode', async () => {
    const interaction = makeInteraction('generate_another_confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleGenerateAnotherConfirm(interaction as any);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(ackIndex()).toBeLessThan(calls.indexOf('getTournamentCode'));
  });

  it('generateAnotherConfirm clears the buttons before the slow call, not after', async () => {
    // Otherwise a second Confirm click during the wait generates a duplicate code.
    const interaction = makeInteraction('generate_another_confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleGenerateAnotherConfirm(interaction as any);

    expect(calls.indexOf('editReply')).toBeLessThan(calls.indexOf('getTournamentCode'));
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ components: [] }),
    );
  });
});

describe('permission checks still short-circuit before any dennys call', () => {
  it('rejects a stranger without hitting the backend', async () => {
    const interaction = makeInteraction('switch_sides');
    interaction.user.id = '999999999999999999';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleSwitchSides(interaction as any);

    expect(calls).not.toContain('getTeam');
    expect(interaction.reply).toHaveBeenCalled();
  });
});
