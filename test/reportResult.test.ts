import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SeriesData } from '../src/types/toddData.ts';

/**
 * Reporting is the escape hatch for a game Riot has no record of. Two things
 * decide whether it is safe to use, and both are easy to get wrong:
 *
 * 1. It sends a winner and nothing else. Naming a code Todd cannot know was the
 *    one played records a second game for the same match.
 * 2. It is offered only once the code has gone unanswered. Filing sooner records
 *    a codeless game that Riot then duplicates when it catches up.
 */

const calls: string[] = [];
const reported: unknown[] = [];

const aSeries = (over: Record<string, unknown> = {}) => ({
  id: 756,
  eventId: 1,
  teamIds: [11, 22],
  totalGames: 3,
  eventStage: 'REGULAR_SEASON',
  completed: false,
  completedAt: null,
  reopenedAt: null,
  tournamentCodes: [],
  games: [],
  lastCodeIssuedAt: null,
  lastGameAt: null,
  ...over,
});

const aCode = (id: number) => ({
  id,
  shortcode: `CODE${id}`,
  seriesId: 756,
  blueTeamId: 11,
  redTeamId: 22,
  createdAt: null,
});

const aGame = (number: number, winningTeamId: number, tournamentCodeId: number | null = null) => ({
  id: 700 + number,
  seriesId: 756,
  number,
  result: { winningTeamId, losingTeamId: winningTeamId === 11 ? 22 : 11 },
  tournamentCodeId,
  riotMatchId: null,
  createdAt: null,
});

/** What getSeries hands back. Overridden per test; reset in beforeEach. */
let seriesState: ReturnType<typeof aSeries> = aSeries();

/** What the refresh was asked about: the series, and the code as a shortcode. */
const refreshedWith: { seriesId: number; shortcode: string }[] = [];

/** Set to make the refresh throw - 503 is Riot unreachable, the documented case. */
let refreshFailsWith: unknown = null;

/** What the series looks like *after* dennys re-asks Riot. Null leaves it alone. */
let refreshFinds: ReturnType<typeof aSeries> | null = null;

/**
 * What reportSeriesResult hands back. Overridden per test; reset in beforeEach.
 *
 * Codeless by default, which is what dennys records for a report that named no
 * code. A code id coming back on one of those means a Riot pull answered for an
 * outstanding code instead - see the swallowed-report tests.
 */
let reportedGame: ReturnType<typeof aGame> = aGame(1, 11, null);

/**
 * Game 2 was played on code 2, and Riot's callback has already recorded it.
 * Game 1 on code 1 is recorded too; only code 3 is still outstanding.
 */
const alreadyReported = () =>
  aSeries({
    tournamentCodes: [aCode(1), aCode(2), aCode(3)],
    games: [aGame(1, 11, 1), aGame(2, 22, 2)],
    lastCodeIssuedAt: '2026-08-09T12:00:00Z',
    lastGameAt: '2026-08-09T12:20:00Z',
  });

vi.mock('../src/dennys.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/dennys.ts')>();
  return {
    ...actual,
    getTeam: vi.fn(async (id: number) => {
      calls.push('getTeam');
      return { id, name: `Team ${id}`, logo: null, eventId: 1 };
    }),
    getSeries: vi.fn(async () => {
      calls.push('getSeries');
      return seriesState;
    }),
    refreshSeriesFromCode: vi.fn(async (seriesId: number, shortcode: string) => {
      calls.push('refreshSeriesFromCode');
      refreshedWith.push({ seriesId, shortcode });
      if (refreshFailsWith) throw refreshFailsWith;
      // Dennys hands back the series as it stands after the re-check, so a game
      // Riot has just answered for is already in what the caller reads.
      seriesState = refreshFinds ?? seriesState;
      return seriesState;
    }),
    reportSeriesResult: vi.fn(async (seriesId: number, body: unknown) => {
      calls.push('reportSeriesResult');
      reported.push({ seriesId, body });
      return reportedGame;
    }),
  };
});

const { handleReportResult, handleReportTeam1Won } = await import(
  '../src/buttons/handlers/reportResult.ts'
);
const { createButtonData, parseButtonData } = await import('../src/buttons/button.ts');
const { buildControlRow, CUSTOM_MARKER, RECOVERY_MARKER, STALE_CODE_MS } = await import(
  '../src/seriesControl.ts'
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

const editReplyPayloads: unknown[] = [];
const threadSends: { content: string; components?: unknown[] }[] = [];

type FakeMessage = {
  id: string;
  content: string;
  components: { components?: { customId?: string | null }[] }[];
  delete: ReturnType<typeof vi.fn>;
  edit: ReturnType<typeof vi.fn>;
};

const aThreadMessage = (id: string, content: string, customId?: string): FakeMessage => ({
  id,
  content,
  components: [{ components: customId ? [{ customId }] : [] }],
  delete: vi.fn(async () => {}),
  edit: vi.fn(async () => {}),
});

/** A code message carrying its own report button, as the thread has it. */
const aGameMessage = (id: string, gameNumber: number, tournamentCodeId: number) =>
  aThreadMessage(
    id,
    `# Game ${gameNumber} \nCode: \`\`\`CODE${tournamentCodeId}\`\`\``,
    createButtonData(
      'report_result',
      ORIGINAL_USER,
      seriesData,
      `${tournamentCodeId}-${gameNumber}`,
    ).serialize(),
  );

/** The custom-in-progress message, whose button names its game but no code. */
const aCustomMessage = (id: string, gameNumber: number) =>
  aThreadMessage(
    id,
    `${CUSTOM_MARKER} A custom game is being played for **Game ${gameNumber}**.`,
    createButtonData('report_custom', ORIGINAL_USER, seriesData, `0-${gameNumber}`).serialize(),
  );

function makeInteraction(
  tag: string,
  userId = ORIGINAL_USER,
  existing: FakeMessage[] = [],
  tagArg?: string,
  /** The message the button rides on. A code message carries the shortcode. */
  messageContent?: string,
) {
  const interaction = {
    customId: createButtonData(tag, ORIGINAL_USER, seriesData, tagArg).serialize(),
    user: { id: userId },
    message: messageContent === undefined ? undefined : { content: messageContent },
    replied: false,
    deferred: false,
    isRepliable: () => true,
    isMessageComponent: () => true,
    channel: {
      send: vi.fn(async (payload: { content: string; components?: unknown[] }) => {
        threadSends.push(payload);
        return { id: '1' };
      }),
      messages: { fetch: vi.fn(async () => new Map(existing.map(m => [m.id, m]))) },
    },
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
    reply: vi.fn(async (payload: unknown) => {
      calls.push('reply');
      editReplyPayloads.push(payload);
      interaction.replied = true;
    }),
  };
  return interaction;
}

/** Narrows past the SKU variant of the button union, which carries no label. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const buttonsOf = (row: any) =>
  row.toJSON().components as { label: string; custom_id: string }[];

beforeEach(() => {
  calls.length = 0;
  reported.length = 0;
  editReplyPayloads.length = 0;
  threadSends.length = 0;
  seriesState = aSeries();
  reportedGame = aGame(1, 11, null);
  refreshedWith.length = 0;
  refreshFailsWith = null;
  refreshFinds = null;
});

describe('reporting does not live on the control message', () => {
  const now = Date.parse('2026-08-09T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('offers no Report button, however long the code has gone unanswered', () => {
    // A button here could only mean "the game I think you mean", and it has no
    // code to name. Dennys handles a codeless report badly: it inserts a new
    // game every time instead of returning the one it already has.
    const series = aSeries({
      tournamentCodes: [aCode(1)],
      lastCodeIssuedAt: ago(STALE_CODE_MS * 5),
    });
    const labels = buttonsOf(buildControlRow(ORIGINAL_USER, seriesData, series)).map(b => b.label);
    expect(labels).toEqual(['Generate Next Game', 'Code not working?']);
  });

  it('hides the recovery entry point once nothing is outstanding', () => {
    // "Code not working?" only makes sense against a code that hasn't been
    // reported yet. No series data at all means nothing to recover.
    const labels = buttonsOf(buildControlRow(ORIGINAL_USER, seriesData, undefined)).map(
      b => b.label,
    );
    expect(labels).not.toContain('Code not working?');
  });

  it('offers the recovery entry point immediately for an outstanding code', () => {
    // A dead code can be known the moment it's tried, so it does not wait on
    // the staleness window.
    const series = aSeries({ tournamentCodes: [aCode(1)], lastCodeIssuedAt: ago(1000) });
    const labels = buttonsOf(buildControlRow(ORIGINAL_USER, seriesData, series)).map(b => b.label);
    expect(labels).toContain('Code not working?');
  });
});

describe('opening the winner picker', () => {
  it('offers one button per team plus a way out', async () => {
    const interaction = makeInteraction('report_result');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (editReplyPayloads.at(-1) as any).components[0];
    expect(buttonsOf(row).map(b => b.label)).toEqual(['Team 11 won', 'Team 22 won', 'Cancel']);
  });

  it('does not label the winners by side', async () => {
    // team1/team2 are the sides the *next* code will use, and Switch Sides swaps
    // them between games, so they say nothing about the game being reported.
    const interaction = makeInteraction('report_result');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (editReplyPayloads.at(-1) as any).components[0];
    const emoji = row.toJSON().components.map((b: { emoji?: { name?: string } }) => b.emoji?.name);
    expect(emoji).not.toContain('ðŸŸ¦');
    expect(emoji).not.toContain('ðŸŸ¥');
  });

  it('lets the enemy captain report too', async () => {
    const interaction = makeInteraction('report_result', ENEMY_CAPTAIN);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    expect(interaction.deferReply).toHaveBeenCalled();
  });

  it('refuses anyone else without touching dennys', async () => {
    const interaction = makeInteraction('report_result', '999999999999999999');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    expect(calls).not.toContain('getTeam');
    expect(editReplyPayloads.at(-1)).toMatchObject({
      content: expect.stringContaining('Only the two captains'),
    });
  });
});

/**
 * A captain cannot see whether Riot's callback has landed, and the button they
 * are pressing was minted before it had any chance to. Reporting on top of a
 * game dennys already has would record a second game for the same match.
 *
 * The button names its own tournament code, so this asks whether *that* game is
 * recorded - not whether some game is. Counting codes against games cannot tell
 * the two apart once a regenerate has left an extra code behind.
 */
describe('checking whether Riot got there first', () => {
  it('does not open the picker for a game that is already recorded', async () => {
    seriesState = alreadyReported();
    const interaction = makeInteraction('report_result', ORIGINAL_USER, [], '2-2');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const last = editReplyPayloads.at(-1) as any;
    expect(last.content).toContain("stats are in");
    expect(last.components).toEqual([]);
  });

  it('names the winner rather than just refusing', async () => {
    // The captain pressed this because they could not tell whether the result
    // had landed. Showing it is the answer to that.
    seriesState = alreadyReported();
    const interaction = makeInteraction('report_result', ORIGINAL_USER, [], '2-2');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const last = editReplyPayloads.at(-1) as any;
    expect(last.content).toContain('Game 2');
    expect(last.content).toContain('Team 22');
  });

  it('uses the number on the button, not the one dennys assigned', async () => {
    // Dennys numbers games in the order results are written. This game is its
    // number 2, but the thread has been calling it Game 4 all along.
    seriesState = alreadyReported();
    const interaction = makeInteraction('report_result', ORIGINAL_USER, [], '2-4');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const last = editReplyPayloads.at(-1) as any;
    expect(last.content).toContain('Game 4');
    expect(last.content).not.toContain('Game 2');
  });

  it('retires the stale button for the other captain too', async () => {
    // Riot's callback lands without anyone pressing anything, so this press is
    // the first chance Todd has had to notice.
    seriesState = alreadyReported();
    const game2 = aGameMessage('9', 2, 2);
    const interaction = makeInteraction('report_result', ORIGINAL_USER, [game2], '2-2');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    expect(game2.edit).toHaveBeenCalledWith({ components: [] });
  });

  it('opens the picker for a game whose own code is still unanswered', async () => {
    // Code 3 has no game against it, even though codes 1 and 2 do.
    seriesState = alreadyReported();
    const interaction = makeInteraction('report_result', ORIGINAL_USER, [], '3-3');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (editReplyPayloads.at(-1) as any).components[0];
    expect(buttonsOf(row).map(b => b.label)).toEqual(['Team 11 won', 'Team 22 won', 'Cancel']);
  });

  it('does not refuse game 3 because game 2 is recorded', async () => {
    // The regression this replaces: a check that only knew "some game landed
    // after the newest code" refused every game once any of them was recorded.
    seriesState = alreadyReported();
    const interaction = makeInteraction('report_result', ORIGINAL_USER, [], '3-3');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((editReplyPayloads.at(-1) as any).content).not.toContain('already recorded');
  });

  it('names the game it is about, so the captain knows which one they answered', async () => {
    seriesState = alreadyReported();
    const interaction = makeInteraction('report_result', ORIGINAL_USER, [], '3-3');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((editReplyPayloads.at(-1) as any).content).toContain('Game 3');
  });

  it('carries the target through to the winner buttons', async () => {
    // This click only opens the picker; the next one writes, so it needs to
    // know which game it is writing for.
    const interaction = makeInteraction('report_result', ORIGINAL_USER, [], '3-3');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (editReplyPayloads.at(-1) as any).components[0];
    const [team1Won] = buttonsOf(row);
    expect(parseButtonData(team1Won.custom_id).tagArg).toBe('3-3');
  });

  it('always opens the picker for a custom, which dennys can never know about', async () => {
    // A custom is played outside Riot, so there is no code and nothing to check
    // against. Checking anyway would read another game's result and refuse the
    // one report only a captain can file.
    seriesState = alreadyReported();
    const interaction = makeInteraction('report_custom');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (editReplyPayloads.at(-1) as any).components[0];
    expect(buttonsOf(row).map(b => b.label)).toContain('Team 11 won');
    expect(calls).not.toContain('getSeries');
  });
});

describe('recording the result', () => {
  it('names the code the button was for', async () => {
    // This is what makes the write idempotent and correctly attributed: dennys
    // returns the game it already has for that code rather than inserting a
    // second one, even while another code is outstanding.
    const interaction = makeInteraction('report_team1_won', ORIGINAL_USER, [], '42-3');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    expect(reported).toEqual([
      { seriesId: 756, body: { winnerTeamId: 11, tournamentCodeId: 42 } },
    ]);
  });

  it('sends no shortcode alongside the code id', async () => {
    // Dennys 1.4.0 rejects a request carrying both outright.
    const interaction = makeInteraction('report_team1_won', ORIGINAL_USER, [], '42-3');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    expect(reported[0]).not.toHaveProperty('body.shortcode');
  });

  it('names no code for a custom, which never had one', async () => {
    const interaction = makeInteraction('report_team1_won');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    expect(reported).toEqual([{ seriesId: 756, body: { winnerTeamId: 11 } }]);
  });

  it('credits the game number from the button, not the one dennys assigned', async () => {
    // Dennys numbers games in the order results are written, so reporting out of
    // play order makes its number disagree with the heading the thread shows.
    reportedGame = aGame(2, 11, 42);
    const interaction = makeInteraction('report_team1_won', ORIGINAL_USER, [], '42-4');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    const credit = threadSends.find(m => m.content.includes('Reported By'))!;
    expect(credit.content).toContain('Game 4');
    expect(credit.content).not.toContain('Game 2');
  });

  it('falls back to dennys for the number when the button carried none', async () => {
    // A custom has no code message to take a number from.
    reportedGame = aGame(3, 11, null);
    const interaction = makeInteraction('report_team1_won');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    const credit = threadSends.find(m => m.content.includes('Reported By'))!;
    expect(credit.content).toContain('Game 3');
  });

  it('retires the report button on the game it just recorded', async () => {
    seriesState = aSeries({ games: [aGame(1, 11, 42)] });
    const game = aGameMessage('9', 3, 42);
    const interaction = makeInteraction('report_team1_won', ORIGINAL_USER, [game], '42-3');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    expect(game.edit).toHaveBeenCalledWith({ components: [] });
  });

  it('leaves the report button on a game that is still unreported', async () => {
    // Reporting game 3 must not disarm game 4.
    seriesState = aSeries({ games: [aGame(1, 11, 42)] });
    const reportedMessage = aGameMessage('9', 3, 42);
    const stillOpen = aGameMessage('10', 4, 43);
    const interaction = makeInteraction(
      'report_team1_won',
      ORIGINAL_USER,
      [reportedMessage, stillOpen],
      '42-3',
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    expect(stillOpen.edit).not.toHaveBeenCalled();
  });

  it('refreshes the control message afterwards', async () => {
    const interaction = makeInteraction('report_team1_won');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    expect(threadSends.at(-1)!.content).toContain('Best of 3');
  });

  it('retires the recovery buttons the recorded game just answered', async () => {
    // "Try again" and "Go play a custom game" both stayed live for the rest of
    // the series, so a captain reaching for the next game's controls could
    // press one and re-report a game that was already reported.
    const recoveryRow = aThreadMessage('9', `${RECOVERY_MARKER} Riot refused to create a code.`);
    const customGame = aCustomMessage('10', 3);
    const interaction = makeInteraction(
      'report_team1_won',
      ORIGINAL_USER,
      [recoveryRow, customGame],
      '0-3',
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    expect(recoveryRow.edit).toHaveBeenCalledWith({ components: [] });
    expect(customGame.edit).toHaveBeenCalledWith({ components: [] });
  });

  it('retires the dead code button for the game the custom stood in for', async () => {
    // The custom records a game with no code on it, so nothing dennys holds
    // marks that code answered - its Report button used to survive and offer a
    // second report of the game the custom had just recorded.
    const deadCode = aGameMessage('9', 3, 1003);
    const interaction = makeInteraction('report_team1_won', ORIGINAL_USER, [deadCode], '0-3');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    expect(deadCode.edit).toHaveBeenCalledWith({ components: [] });
  });

  it('leaves an unrelated game alone when a custom is reported', async () => {
    const otherGame = aGameMessage('9', 4, 1004);
    const interaction = makeInteraction('report_team1_won', ORIGINAL_USER, [otherGame], '0-3');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    expect(otherGame.edit).not.toHaveBeenCalled();
  });

  it('credits the custom under the game it stood in for', async () => {
    // Dennys numbers it by write order; the thread has been calling it Game 3.
    reportedGame = aGame(1, 11, null);
    const interaction = makeInteraction('report_team1_won', ORIGINAL_USER, [], '0-3');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    const credit = threadSends.find(m => m.content.includes('Reported By'))!;
    expect(credit.content).toContain('Game 3');
  });

  it('leaves the custom game button alone when a coded game is what was reported', async () => {
    // The tangle this fixes: with a coded game and a custom both unreported,
    // reporting either one used to retire the other's button, and the control
    // row had nothing left to offer. The custom became unreportable.
    const customGame = aThreadMessage('10', `${CUSTOM_MARKER} A custom game is being played`);
    const interaction = makeInteraction(
      'report_team1_won',
      ORIGINAL_USER,
      [customGame],
      '42-3',
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    expect(customGame.edit).not.toHaveBeenCalled();
  });

  it('says so when dennys answered for an outstanding code instead of the custom', async () => {
    // Dennys pulls from Riot before it records. A codeless report takes whatever
    // that pull found, so the captain's custom result is dropped - which used to
    // happen silently, credited to a game they did not report.
    reportedGame = aGame(2, 22, 42);
    const interaction = makeInteraction('report_team1_won');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((editReplyPayloads.at(-1) as any).content).toContain('Report the custom again');
  });

  it('posts no credit for a report that was swallowed', async () => {
    // Crediting it would claim a result that was never recorded.
    reportedGame = aGame(2, 22, 42);
    const interaction = makeInteraction('report_team1_won');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    expect(threadSends.find(m => m.content.includes('Reported By'))).toBeUndefined();
  });

  it('keeps the custom game button live when the report was swallowed', async () => {
    // The custom still needs reporting - that is the whole point of the notice.
    reportedGame = aGame(2, 22, 42);
    const customGame = aThreadMessage('10', `${CUSTOM_MARKER} A custom game is being played`);
    const interaction = makeInteraction('report_team1_won', ORIGINAL_USER, [customGame]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    expect(customGame.edit).not.toHaveBeenCalled();
  });

  it('records the result even if the recovery sweep cannot reach the thread', async () => {
    const interaction = makeInteraction('report_team1_won');
    interaction.channel.messages.fetch.mockRejectedValue(new Error('no permission'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    expect(reported).toEqual([{ seriesId: 756, body: { winnerTeamId: 11 } }]);
  });

  it('credits whoever reported it, in a message of its own', async () => {
    // The control message is replaced after every code, so the credit would not
    // survive there. Stands beside "Game Generated By" on the code message.
    const interaction = makeInteraction('report_team1_won');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    const credit = threadSends.find(m => m.content.includes('Reported By'))!;
    expect(credit.content).toContain(`<@${ORIGINAL_USER}>`);
    expect(credit.content).toContain('Team 11');
    expect(credit.components).toBeUndefined();
  });

  it('names the reporter even when the enemy captain is the one clicking', async () => {
    const interaction = makeInteraction('report_team1_won', ENEMY_CAPTAIN);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    expect(threadSends.find(m => m.content.includes('Reported By'))!.content).toContain(
      `<@${ENEMY_CAPTAIN}>`,
    );
  });

  it('carries the pinned series onto the refreshed row', async () => {
    const interaction = makeInteraction('report_team1_won');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [button] = buttonsOf((threadSends.at(-1)!.components as any[])[0]);
    expect(parseButtonData(button.custom_id).seriesData.seriesId).toBe(756);
  });

  it('refuses anyone but the two captains', async () => {
    const interaction = makeInteraction('report_team1_won', '999999999999999999');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    expect(calls).not.toContain('reportSeriesResult');
  });

  it('acknowledges before calling dennys', async () => {
    const interaction = makeInteraction('report_team1_won');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    expect(calls.indexOf('deferUpdate')).toBeLessThan(calls.indexOf('reportSeriesResult'));
  });
});

/**
 * The form is what records the match in the standings - nothing Todd writes
 * does - so the thread has to say so the moment dennys closes the series.
 */
describe('the series finishing', () => {
  const finished = () =>
    aSeries({
      completed: true,
      completedAt: '2026-08-09T13:00:00Z',
      tournamentCodes: [aCode(1)],
      games: [aGame(1, 11, 1), aGame(2, 11, null)],
      lastCodeIssuedAt: '2026-08-09T12:00:00Z',
      lastGameAt: '2026-08-09T12:40:00Z',
    });

  it('points at the post-game form once the result closes the series', async () => {
    seriesState = finished();
    const interaction = makeInteraction('report_team1_won');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    const finish = threadSends.find(s => s.content.startsWith('# The series is finished!'));
    expect(finish).toBeDefined();
    expect(finish!.content).toContain('will NOT be recorded');
    expect(finish!.content).toContain('https://forms.gle/');
  });

  it('says nothing while the series is still going', async () => {
    const interaction = makeInteraction('report_team1_won');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    expect(threadSends.some(s => s.content.includes('series is finished'))).toBe(false);
  });

  it('keeps the control message last, below the form', async () => {
    // The controls are the bottom of the thread by convention, and a captain
    // correcting a result still needs to reach them.
    seriesState = finished();
    const interaction = makeInteraction('report_team1_won');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    const finish = threadSends.findIndex(s => s.content.startsWith('# The series is finished!'));
    const control = threadSends.findIndex(s => s.content.startsWith('## 📋 Series status'));
    expect(finish).toBeGreaterThanOrEqual(0);
    expect(control).toBeGreaterThan(finish);
  });

  it('says it when Riot closed the series with nobody reporting', async () => {
    // The captain presses Verify Stats, dennys says the game is already in -
    // and that game was the one that finished the series.
    seriesState = { ...alreadyReported(), completed: true };
    const interaction = makeInteraction('report_result', ORIGINAL_USER, [], '2-2');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    expect(threadSends.some(s => s.content.startsWith('# The series is finished!'))).toBe(true);
  });

  it('does not repeat itself when the form message is already in the thread', async () => {
    seriesState = finished();
    const already = aThreadMessage('9', '# The series is finished! Please report the match results in the form!');
    const interaction = makeInteraction('report_team1_won', ORIGINAL_USER, [already]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    expect(threadSends.filter(s => s.content.includes('series is finished'))).toHaveLength(0);
  });
});

/**
 * Pressing Verify asks dennys to re-check Riot for the one code, rather than
 * only reading what dennys already holds. A missed callback is far likelier
 * than a genuinely unreported game, and a refresh costs nothing against the
 * per-game code limit - the old workaround was issuing a fresh code.
 */
describe('verifying a game against Riot', () => {
  const codeMessage = (gameNumber: number, shortcode: string) =>
    `# Game ${gameNumber} \n 🟦 A v.s. B 🟥\nCode: \`\`\`${shortcode}\`\`\`\n`;

  it('names the code by shortcode, not by the id on the button', async () => {
    // The shortcode is what Riot issued, what dennys stored and what the
    // captains pasted into the client. The id is Todd's copy of dennys's handle
    // and is only as fresh as the button carrying it.
    const interaction = makeInteraction(
      'report_result',
      ORIGINAL_USER,
      [],
      '2-2',
      codeMessage(2, 'NA050c5-abc'),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    expect(refreshedWith).toEqual([{ seriesId: 756, shortcode: 'NA050c5-abc' }]);
  });

  it('reads the code off the message the button rides on, with no extra fetch', async () => {
    const interaction = makeInteraction(
      'report_result',
      ORIGINAL_USER,
      [],
      '2-2',
      codeMessage(2, 'NA050c5-abc'),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    expect(interaction.channel.messages.fetch).not.toHaveBeenCalled();
  });

  it('falls back to the thread when the button is not on a code message', async () => {
    // The code-limit row is posted on a ⚠️ message, which names a code it does
    // not print.
    const interaction = makeInteraction('report_result', ORIGINAL_USER, [
      aThreadMessage('1', codeMessage(2, 'NA050c5-xyz')),
    ], '2-2', '⚠️ No more codes can be issued for this game.');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    expect(refreshedWith).toEqual([{ seriesId: 756, shortcode: 'NA050c5-xyz' }]);
  });

  it('reads the series instead when no code was ever printed', async () => {
    const interaction = makeInteraction('report_result', ORIGINAL_USER, [], '2-2');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    expect(calls).not.toContain('refreshSeriesFromCode');
    expect(calls).toContain('getSeries');
  });

  it('never refreshes for a custom, which dennys would reject', async () => {
    // A custom names no code, and a refresh naming none is a 422.
    const interaction = makeInteraction('report_custom', ORIGINAL_USER, [], '0-2');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    expect(calls).not.toContain('refreshSeriesFromCode');
    expect(calls).not.toContain('getSeries');
  });

  it('declines the picker when the re-check turned the game up', async () => {
    // The whole point: Riot had it all along, so the captain does not have to
    // claim a winner Riot can contradict.
    refreshFinds = alreadyReported();
    const interaction = makeInteraction(
      'report_result',
      ORIGINAL_USER,
      [],
      '2-2',
      codeMessage(2, 'CODE2'),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const last = editReplyPayloads.at(-1) as any;
    expect(last.content).toContain("stats are in");
    expect(last.components).toEqual([]);
  });

  it('matches the game on the id dennys files the shortcode under', async () => {
    // The button says code 99; dennys files that shortcode as code 2. Trusting
    // the button would miss the recorded game and offer the picker anyway.
    refreshFinds = alreadyReported();
    const interaction = makeInteraction(
      'report_result',
      ORIGINAL_USER,
      [],
      '99-2',
      codeMessage(2, 'CODE2'),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const last = editReplyPayloads.at(-1) as any;
    expect(last.content).toContain("stats are in");
  });

  it('still opens the picker when Riot answered with nothing', async () => {
    const interaction = makeInteraction(
      'report_result',
      ORIGINAL_USER,
      [],
      '2-2',
      codeMessage(2, 'CODE2'),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const last = editReplyPayloads.at(-1) as any;
    expect(buttonsOf(last.components[0]).map(b => b.label)).toEqual([
      'Team 11 won',
      'Team 22 won',
      'Cancel',
    ]);
  });

  it('falls back to what dennys holds when Riot is unreachable', async () => {
    // 503 is the documented outcome for that, and it must not cost the captain
    // the ability to self-report.
    const { HttpError } = await import('../src/http.ts');
    refreshFailsWith = new HttpError('riot', 503, '');
    seriesState = alreadyReported();
    const interaction = makeInteraction(
      'report_result',
      ORIGINAL_USER,
      [],
      '2-2',
      codeMessage(2, 'CODE2'),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    expect(calls).toContain('getSeries');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((editReplyPayloads.at(-1) as any).content).toContain("stats are in");
  });

  it('acknowledges before re-checking, which goes out to Riot and back', async () => {
    const interaction = makeInteraction(
      'report_result',
      ORIGINAL_USER,
      [],
      '2-2',
      codeMessage(2, 'CODE2'),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportResult(interaction as any);

    expect(calls.indexOf('deferReply')).toBeLessThan(calls.indexOf('refreshSeriesFromCode'));
  });
});
