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

type FakeMessage = {
  id: string;
  content: string;
  components: unknown[];
  delete: ReturnType<typeof vi.fn>;
  edit: ReturnType<typeof vi.fn>;
};

const aCodeMessage = (id: string, game: number, shortcode: string): FakeMessage => ({
  id,
  content: `# Game ${game} \n 🟦 A v.s. B 🟥\nCode: \`\`\`${shortcode}\`\`\``,
  components: [],
  delete: vi.fn(async () => {}),
  edit: vi.fn(async () => {}),
});

function makeInteraction(existing: FakeMessage[] = [], tag = 'generate_another_confirm') {
  const interaction = {
    customId: createButtonData(tag, ORIGINAL_USER, seriesData).serialize(),
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
      messages: { fetch: vi.fn(async () => new Map(existing.map(m => [m.id, m]))) },
    },
    deferUpdate: vi.fn(async () => {
      interaction.deferred = true;
    }),
    editReply: vi.fn(async (payload: { content?: string; components?: unknown[] }) => {
      editReplyPayloads.push(payload);
    }),
    deleteReply: vi.fn(async () => {}),
    followUp: vi.fn(async (payload: { content?: string }) => {
      threadSends.push(payload);
      return { id: 'fresh-code' };
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

describe('a regenerate that succeeds', () => {
  const issued = {
    error: null,
    riotUnavailable: false,
    retryable: false,
    discordResponse: '# Game 2 \n 🟦 A v.s. B 🟥\nCode: ```STUB-6-3```',
    gameNumber: 2,
    team1Name: 'A',
    team2Name: 'B',
    seriesId: 756,
    series: {
      id: 756,
      totalGames: 5,
      completed: false,
      tournamentCodes: [{ id: 1 }, { id: 2 }, { id: 3 }],
      games: [{ number: 1, result: { winningTeamId: 11 } }],
      lastCodeIssuedAt: null,
      lastGameAt: null,
    },
  };

  it('removes the code message it just replaced, when the code was declared dead', async () => {
    // Two live codes for one game, with nothing to say which to use.
    const superseded = aCodeMessage('old', 2, 'STUB-6-2');
    getTournamentCode.mockResolvedValue(issued);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleGenerateAnotherConfirm(makeInteraction([superseded], 'regenerate_confirm') as any);

    expect(superseded.delete).toHaveBeenCalled();
  });

  it('keeps the codes of games already played', async () => {
    const gameOne = aCodeMessage('one', 1, 'STUB-6-1');
    getTournamentCode.mockResolvedValue(issued);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleGenerateAnotherConfirm(makeInteraction([gameOne], 'regenerate_confirm') as any);

    expect(gameOne.delete).not.toHaveBeenCalled();
  });

  it('leaves the current code alone when it was Generate Next Game, not a regenerate', async () => {
    // Game numbers only advance on a result, so pressing Generate Next Game
    // before reporting issues a second code for the *same* game number. That
    // captain never said the first code was dead - they may be playing on it.
    const inUse = aCodeMessage('current', 2, 'STUB-6-2');
    getTournamentCode.mockResolvedValue(issued);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleGenerateAnotherConfirm(makeInteraction([inUse], 'generate_another_confirm') as any);

    expect(inUse.delete).not.toHaveBeenCalled();
  });
});

/**
 * Dennys 1.4.1 answers 409 once a game has taken its codes (todd-bot#126).
 * The clicking captain sees it on their ephemeral message, but the remedies go
 * in the thread: either captain can report the game or start the custom.
 */
describe('a mid-series regenerate dennys refuses on the code allowance', () => {
  const refused = {
    error:
      "Series '756' has already been issued 2 tournament code(s).\n\n" +
      'Another code will not help. Report the result of the game you already played, ' +
      'or play a custom game and report the winner.',
    riotUnavailable: false,
    retryable: false,
    codeLimitReached: true,
    discordResponse: null,
    tournamentCodeId: 9,
    gameNumber: 2,
    series: null,
    seriesId: 756,
  };

  it('posts the remedies to the thread, and no retry among them', async () => {
    getTournamentCode.mockResolvedValue(refused);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleGenerateAnotherConfirm(makeInteraction() as any);

    expect(threadSends).toHaveLength(1);
    expect(labelsOf(threadSends[0])).toEqual(['Report Game 2', 'Go play a custom game']);
    expect(tagsOf(threadSends[0])).toEqual(['report_result', 'play_custom']);
  });

  it("shows dennys's message rather than a generic failure", async () => {
    getTournamentCode.mockResolvedValue(refused);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleGenerateAnotherConfirm(makeInteraction() as any);

    expect(editReplyPayloads.at(-1)?.content).toContain('already been issued 2 tournament code(s)');
    expect(threadSends[0].content).toContain('already been issued 2 tournament code(s)');
  });

  it('leaves the report button out when no code is outstanding', async () => {
    getTournamentCode.mockResolvedValue({ ...refused, tournamentCodeId: 0 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleGenerateAnotherConfirm(makeInteraction() as any);

    expect(labelsOf(threadSends[0])).toEqual(['Go play a custom game']);
  });

  it('does not post a code message - there is no code', async () => {
    getTournamentCode.mockResolvedValue(refused);
    const interaction = makeInteraction();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleGenerateAnotherConfirm(interaction as any);

    expect(interaction.followUp).not.toHaveBeenCalled();
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
