import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createButtonData, parseButtonData } from '../src/buttons/button.ts';
import { SeriesData } from '../src/types/toddData.ts';

/**
 * A mid-series regenerate ("Generate Next Game") that Riot refuses has no
 * outstanding code for "Code not working?" to gate on - hasOutstandingCode
 * only counts codes Riot actually issued, and a fully-failed attempt issues
 * none. Before this fix, the failure only edited the clicking captain's
 * ephemeral message and left nothing for either captain to act on: the
 * control row still showed just "Generate Next Game", and the only visible
 * button left in the thread was whatever stale one preceded it.
 */

const getTournamentCode = vi.fn();

vi.mock('../src/commands/tournament.ts', () => ({ getTournamentCode }));

const { handleGenerateAnotherConfirm } = await import(
  '../src/buttons/handlers/generateAnotherConfirm.ts'
);

const ORIGINAL_USER = '123456789012345678';
const ENEMY_CAPTAIN = '223456789012345678';

const seriesData: SeriesData = {
  enemyCaptainId: ENEMY_CAPTAIN,
  divisionId: 7,
  team1Id: 11,
  team2Id: 22,
  seriesId: 756,
  stage: 'REGULAR_SEASON',
};

const threadSends: { content?: string; components?: unknown[] }[] = [];
const editReplyPayloads: { content?: string; components?: unknown[] }[] = [];

function makeInteraction() {
  const interaction = {
    customId: createButtonData('generate_another_confirm', ORIGINAL_USER, seriesData).serialize(),
    user: { id: ORIGINAL_USER },
    replied: false,
    deferred: false,
    isRepliable: () => true,
    isMessageComponent: () => true,
    channel: {
      send: vi.fn(async (payload: { content?: string; components?: unknown[] }) => {
        threadSends.push(payload);
        return { id: '1' };
      }),
    },
    deferUpdate: vi.fn(async () => {
      interaction.deferred = true;
    }),
    editReply: vi.fn(async (payload: { content?: string; components?: unknown[] }) => {
      editReplyPayloads.push(payload);
    }),
  };
  return interaction;
}

/** Narrows past the SKU variant of the button union, which carries no label. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const buttonsOf = (row: any) => row.toJSON().components as { label: string; custom_id: string }[];
const labelsOf = (payload: { components?: unknown[] }) =>
  buttonsOf((payload.components ?? [])[0]).map(b => b.label);
const tagsOf = (payload: { components?: unknown[] }) =>
  buttonsOf((payload.components ?? [])[0]).map(b => parseButtonData(b.custom_id).tag);

beforeEach(() => {
  threadSends.length = 0;
  editReplyPayloads.length = 0;
  getTournamentCode.mockReset();
});

describe('a mid-series regenerate that Riot refuses', () => {
  it('posts a recovery row to the thread, not just the ephemeral error', async () => {
    getTournamentCode.mockResolvedValue({
      error: 'Riot refused to create a code for this game. Playing a custom is the way forward.',
      riotUnavailable: true,
      retryable: false,
      discordResponse: null,
      series: null,
      seriesId: 756,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleGenerateAnotherConfirm(makeInteraction() as any);

    expect(threadSends).toHaveLength(1);
    expect(labelsOf(threadSends[0])).toEqual(['Go play a custom game']);
    expect(tagsOf(threadSends[0])).toContain('play_custom');
  });

  it('offers Try again as well when the failure is worth retrying', async () => {
    getTournamentCode.mockResolvedValue({
      error: 'Riot is not answering right now. Try again in a moment, or play a custom game.',
      riotUnavailable: true,
      retryable: true,
      discordResponse: null,
      series: null,
      seriesId: 756,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleGenerateAnotherConfirm(makeInteraction() as any);

    expect(labelsOf(threadSends[0])).toEqual(['Try again', 'Go play a custom game']);
  });

  it('still shows the clicking captain the ephemeral error', async () => {
    getTournamentCode.mockResolvedValue({
      error: 'Riot refused to create a code for this game. Playing a custom is the way forward.',
      riotUnavailable: true,
      retryable: false,
      discordResponse: null,
      series: null,
      seriesId: 756,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleGenerateAnotherConfirm(makeInteraction() as any);

    expect(editReplyPayloads.at(-1)).toEqual({
      content: 'Riot refused to create a code for this game. Playing a custom is the way forward.',
      components: [],
    });
  });

  it('carries the pinned series onto the recovery buttons', async () => {
    getTournamentCode.mockResolvedValue({
      error: 'Riot refused to create a code for this game. Playing a custom is the way forward.',
      riotUnavailable: true,
      retryable: false,
      discordResponse: null,
      series: null,
      seriesId: 756,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleGenerateAnotherConfirm(makeInteraction() as any);

    const ids = buttonsOf(threadSends[0].components![0]).map(
      b => parseButtonData(b.custom_id).seriesData.seriesId,
    );
    expect(ids).toEqual([756]);
  });
});

describe('a non-Riot error on regenerate', () => {
  it('does not post a recovery row - there is nothing to recover from', async () => {
    getTournamentCode.mockResolvedValue({
      error: 'This is not One For All. No picking the same champs/teams',
      riotUnavailable: false,
      retryable: false,
      discordResponse: null,
      series: null,
      seriesId: 756,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleGenerateAnotherConfirm(makeInteraction() as any);

    expect(threadSends).toHaveLength(0);
  });
});
