import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionRowBuilder, ButtonBuilder } from 'discord.js';
import {
  CONTROL_MARKER,
  CUSTOM_MARKER,
  RECOVERY_MARKER,
  STALE_CODE_MS,
  buildCodeLimitRow,
  buildControlRow,
  buildGameReportRow,
  announceSeriesFinished,
  announceSeriesLocked,
  buildSeriesStatus,
  clearRecoveryButtons,
  clearSupersededCodes,
  decodeReportTarget,
  encodeReportTarget,
  gamesAwaitingReport,
  highestPostedGameNumber,
  isCodeStale,
  latestCodeHasResult,
  postSeriesControl,
  reconcileGameButtons,
  retireGameButtons,
  shareThreadScan,
  shortcodeForGame,
  shortcodeIn,
} from '../src/seriesControl.ts';
import { createButtonData, parseButtonData } from '../src/buttons/button.ts';
import { SeriesData } from '../src/types/toddData.ts';
import { SeriesWithGames } from '../src/dennysSchemas.ts';

const NOW = Date.parse('2026-08-09T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const TEAMS = [
  { id: 11, name: 'Alpha' },
  { id: 22, name: 'Bravo' },
];

const aSeries = (over: Partial<SeriesWithGames> = {}): SeriesWithGames => ({
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

const aGame = (number: number, winningTeamId: number, tournamentCodeId: number | null = null) => ({
  id: number,
  seriesId: 756,
  number,
  result: { winningTeamId, losingTeamId: winningTeamId === 11 ? 22 : 11 },
  tournamentCodeId,
  riotMatchId: null,
  createdAt: null,
});

const aCode = (id: number, createdAt: string | null = null) => ({
  id,
  shortcode: `CODE${id}`,
  seriesId: 756,
  blueTeamId: 11,
  redTeamId: 22,
  createdAt,
});

const seriesData: SeriesData = {
  enemyCaptainId: '223456789012345678',
  divisionId: 7,
  team1Id: 11,
  team2Id: 22,
  seriesId: 756,
  stage: 'REGULAR_SEASON',
};

describe('buildSeriesStatus', () => {
  it('reads 0 - 0 before anything is played', () => {
    expect(buildSeriesStatus(aSeries(), TEAMS, NOW)).toContain('**Alpha** 0 – **Bravo** 0');
  });

  it('counts wins per team from the recorded results', () => {
    const series = aSeries({ games: [aGame(1, 11), aGame(2, 22), aGame(3, 11)] });
    expect(buildSeriesStatus(series, TEAMS, NOW)).toContain('**Alpha** 2 – **Bravo** 1');
  });

  it('names the Bo', () => {
    expect(buildSeriesStatus(aSeries({ totalGames: 5 }), TEAMS, NOW)).toContain('Best of 5');
  });

  it('says when the series is complete', () => {
    expect(buildSeriesStatus(aSeries({ completed: true }), TEAMS, NOW)).toContain(
      'This series is complete',
    );
  });

  it('does not treat a freshly issued code as an anomaly', () => {
    // One code with no game is simply the game in progress. Warning here would
    // fire on every single game.
    const series = aSeries({
      tournamentCodes: [aCode(1)],
      lastCodeIssuedAt: ago(1000),
    });
    const status = buildSeriesStatus(series, TEAMS, NOW);
    expect(status).not.toContain('outstanding');
    expect(status).not.toContain('no result yet');
  });

  it('never states a code count, which read as a count of pending reports', () => {
    // Regenerating a dead code, or both captains pressing at once, issues
    // several codes for the same game. "3 codes are outstanding" sounded like
    // three games needed reporting when only one ever does.
    const series = aSeries({ totalGames: 5, tournamentCodes: [aCode(1), aCode(2), aCode(3)] });
    const status = buildSeriesStatus(series, TEAMS, NOW);
    expect(status).not.toContain('outstanding');
    // The only number left is the score and the Bo.
    expect(status).not.toContain('3');
  });

  it('stays quiet about an unplayed code even after a result is in', () => {
    // The captain generated the next game's code and has not played it yet.
    // Nothing is pending, so nothing should be announced.
    const series = aSeries({
      tournamentCodes: [aCode(1), aCode(2)],
      games: [aGame(1, 11)],
      lastCodeIssuedAt: ago(1000),
    });
    const status = buildSeriesStatus(series, TEAMS, NOW);
    expect(status).not.toContain('waiting');
    expect(status).not.toContain('outstanding');
  });

  it('calls out a code that has gone unanswered', () => {
    const series = aSeries({
      tournamentCodes: [aCode(1)],
      lastCodeIssuedAt: ago(STALE_CODE_MS * 2),
    });
    expect(buildSeriesStatus(series, TEAMS, NOW)).toContain('no result yet');
  });

  it('names the game still waiting on a result', () => {
    const status = buildSeriesStatus(aSeries(), TEAMS, NOW, [1]);
    expect(status).toContain('**Game 1** still needs a result');
  });

  it('names every one of them when several are behind', () => {
    const status = buildSeriesStatus(aSeries({ totalGames: 5 }), TEAMS, NOW, [1, 3]);
    expect(status).toContain('**Game 1**, **Game 3** still need results');
  });

  it('says nothing about pending reports when there are none', () => {
    // The default. Every existing caller that has nothing to pass gets silence.
    expect(buildSeriesStatus(aSeries(), TEAMS, NOW)).not.toContain('still need');
  });
});

describe('isCodeStale', () => {
  it('is false when no code has been issued', () => {
    expect(isCodeStale(aSeries(), NOW)).toBe(false);
  });

  it('is false inside the window', () => {
    expect(isCodeStale(aSeries({ lastCodeIssuedAt: ago(STALE_CODE_MS - 1000) }), NOW)).toBe(false);
  });

  it('is true past it', () => {
    expect(isCodeStale(aSeries({ lastCodeIssuedAt: ago(STALE_CODE_MS + 1000) }), NOW)).toBe(true);
  });

  it('is false once a game landed after the code', () => {
    const series = aSeries({
      lastCodeIssuedAt: ago(STALE_CODE_MS * 3),
      lastGameAt: ago(STALE_CODE_MS * 2),
    });
    expect(isCodeStale(series, NOW)).toBe(false);
  });
});

/**
 * The one question a captain cannot answer from the thread: did Riot's callback
 * land, or is this game still mine to report? Reporting on top of a game dennys
 * already has records a duplicate.
 */
describe('latestCodeHasResult', () => {
  it('is true when a game landed after the newest code went out', () => {
    const series = aSeries({
      lastCodeIssuedAt: ago(STALE_CODE_MS * 3),
      lastGameAt: ago(STALE_CODE_MS * 2),
    });
    expect(latestCodeHasResult(series)).toBe(true);
  });

  it('is false when the newest code went out after the last result', () => {
    // The ordinary state of a game in progress: game 1 is recorded, game 2's
    // code has just been issued.
    const series = aSeries({
      lastCodeIssuedAt: ago(STALE_CODE_MS),
      lastGameAt: ago(STALE_CODE_MS * 2),
    });
    expect(latestCodeHasResult(series)).toBe(false);
  });

  it('is false when no result has ever landed', () => {
    expect(latestCodeHasResult(aSeries({ lastCodeIssuedAt: ago(1000) }))).toBe(false);
  });

  it('is false when no code has ever been issued', () => {
    // A series played entirely on customs after a Riot outage. There is no code
    // for a result to belong to, and the captain is the only source of one.
    expect(latestCodeHasResult(aSeries({ lastGameAt: ago(1000) }))).toBe(false);
  });

  it('does not answer from the code and game counts', () => {
    // Two codes and one game is what a regenerate leaves behind, whether or not
    // that game is the one about to be reported. Only the ordering separates
    // them.
    const series = aSeries({
      tournamentCodes: [aCode(1), aCode(2)],
      games: [aGame(1, 11)],
      lastCodeIssuedAt: ago(STALE_CODE_MS * 3),
      lastGameAt: ago(STALE_CODE_MS * 2),
    });
    expect(latestCodeHasResult(series)).toBe(true);
  });
});

/**
 * discord.js is not mocked, so rows reaching a stub are real builders. toJSON()
 * types the button as a union that includes the SKU variant, which carries
 * neither field, so it is narrowed to what a link-less button always has.
 */
export const buttonsOf = (row: ActionRowBuilder<ButtonBuilder>) =>
  row.toJSON().components as unknown as { label: string; custom_id: string }[];

describe('buildControlRow', () => {
  it('carries the pinned series on Generate Next Game', () => {
    const [button] = buttonsOf(buildControlRow('123456789012345678', seriesData));
    expect(button.label).toBe('Generate Next Game');
    const parsed = parseButtonData(button.custom_id);
    expect(parsed.tag).toBe('generate_another');
    expect(parsed.seriesData.seriesId).toBe(756);
  });

  it('hides "Code not working?" once the newest code has a game against it', () => {
    const series = aSeries({ tournamentCodes: [aCode(1)], games: [aGame(1, 11, 1)] });
    const labels = buttonsOf(buildControlRow('123456789012345678', seriesData, series)).map(
      b => b.label,
    );
    expect(labels).not.toContain('Code not working?');
  });

  it('hides it even when earlier codes were abandoned and never answered', () => {
    // Codes 1 and 2 were superseded - a second Generate Next Game, a
    // regenerate, a custom played instead. None will ever get a result, so
    // counting codes against games stays lopsided for the rest of the series
    // and every check built on that count sticks on forever.
    const series = aSeries({
      tournamentCodes: [aCode(1), aCode(2), aCode(3)],
      games: [aGame(1, 11, 3)],
    });
    const labels = buttonsOf(buildControlRow('123456789012345678', seriesData, series)).map(
      b => b.label,
    );
    expect(labels).not.toContain('Code not working?');
  });

  it('shows it when the newest code is unanswered, whatever the older ones did', () => {
    const series = aSeries({
      tournamentCodes: [aCode(1), aCode(2)],
      games: [aGame(1, 11, 1)],
      lastCodeIssuedAt: ago(1000),
      lastGameAt: ago(STALE_CODE_MS),
    });
    const labels = buttonsOf(buildControlRow('123456789012345678', seriesData, series)).map(
      b => b.label,
    );
    expect(labels).toContain('Code not working?');
  });

  it('hides it once a custom was played instead of the newest code', () => {
    // The custom records a game with no code on it, so nothing ever names code
    // 2 and it stays unanswered for good. Only the ordering shows it was
    // superseded: the custom landed after that code went out.
    const series = aSeries({
      tournamentCodes: [aCode(1), aCode(2)],
      games: [aGame(1, 11, 1), aGame(2, 22, null)],
      lastCodeIssuedAt: ago(STALE_CODE_MS),
      lastGameAt: ago(1000),
    });
    const labels = buttonsOf(buildControlRow('123456789012345678', seriesData, series)).map(
      b => b.label,
    );
    expect(labels).not.toContain('Code not working?');
  });

  it('says nothing about a stale code once the custom that replaced it is in', () => {
    // The same evidence drives the status line, so the two can never disagree.
    const series = aSeries({
      tournamentCodes: [aCode(1), aCode(2)],
      games: [aGame(1, 11, 1), aGame(2, 22, null)],
      lastCodeIssuedAt: ago(STALE_CODE_MS * 2),
      lastGameAt: ago(1000),
    });
    expect(buildSeriesStatus(series, TEAMS, NOW)).not.toContain('no result yet');
  });

  it('shows "Code not working?" as soon as a code is outstanding, without waiting for staleness', () => {
    const series = aSeries({ tournamentCodes: [aCode(1)], lastCodeIssuedAt: ago(1000) });
    const labels = buttonsOf(buildControlRow('123456789012345678', seriesData, series)).map(
      b => b.label,
    );
    expect(labels).toContain('Code not working?');
  });

  it('never carries a report button, however stale the code', () => {
    // A button here could only mean "the game I think you mean", and it has no
    // code to name - which is the one shape dennys handles badly. Reporting
    // lives on each game's own code message instead.
    const series = aSeries({
      tournamentCodes: [aCode(1)],
      lastCodeIssuedAt: ago(STALE_CODE_MS * 5),
    });
    const labels = buttonsOf(buildControlRow('123456789012345678', seriesData, series)).map(
      b => b.label,
    );
    expect(labels).not.toContain('Report result');
  });
});

/**
 * Dennys 1.4.1 caps tournament codes per game, counted since the most recent
 * recorded game (todd-bot#126). Todd counts the same way so it can say how many
 * are left before a captain spends the last one.
 */
describe('the code allowance', () => {
  /** Two codes for one game, which takes a regenerate to arrive at. */
  const spent = () =>
    aSeries({
      tournamentCodes: [aCode(1, ago(2000)), aCode(2, ago(1000))],
      lastCodeIssuedAt: ago(1000),
    });

  it('says nothing before a code has gone out for this game', () => {
    // Both codes belong to the game already in the books, so the game in
    // progress has its full allowance.
    const series = aSeries({
      tournamentCodes: [aCode(1, ago(5000)), aCode(2, ago(4000))],
      games: [aGame(1, 11, 2)],
      lastGameAt: ago(3000),
    });
    expect(buildSeriesStatus(series, TEAMS, NOW)).not.toContain('No more codes');
  });

  it('says why, and names the remedies, once the allowance is spent', () => {
    const status = buildSeriesStatus(spent(), TEAMS, NOW);
    expect(status).toContain('No more codes can be issued for this game');
    expect(status).toContain('Report a result');
    expect(status).toContain('custom game');
  });

  it('counts only the codes issued since the last recorded game', () => {
    // The first two belong to a game that is now in the books. Counting those
    // would read as spent with a code still owed for the game in progress.
    const series = aSeries({
      tournamentCodes: [aCode(1, ago(5000)), aCode(2, ago(4000)), aCode(3, ago(1000))],
      games: [aGame(1, 11, 2)],
      lastGameAt: ago(3000),
    });
    expect(buildSeriesStatus(series, TEAMS, NOW)).not.toContain('No more codes');
  });

  it('stays quiet when the count cannot be worked out', () => {
    // A code with no createdAt makes the count a guess, and a guess that reads
    // low would announce a limit dennys is not applying.
    const series = aSeries({ tournamentCodes: [aCode(1), aCode(2)] });
    expect(buildSeriesStatus(series, TEAMS, NOW)).not.toContain('No more codes');
  });
});

/**
 * One game at a time. The next code is unlocked by reporting the
 * current game, which is also the thing that clears dennys's code allowance -
 * so every code counted since the last result belongs to the game in progress,
 * and the allowance line above can be trusted to mean what it says.
 */
describe('generating the next game', () => {
  const USER = '123456789012345678';
  const labelsOfControl = (series?: SeriesWithGames) =>
    buttonsOf(buildControlRow(USER, seriesData, series)).map(b => b.label);
  const generateIsDisabled = (series?: SeriesWithGames) =>
    (buttonsOf(buildControlRow(USER, seriesData, series))[0] as { disabled?: boolean }).disabled ===
    true;

  /** A code is out and nobody has reported the game it was issued for. */
  const inProgress = () =>
    aSeries({ tournamentCodes: [aCode(1, ago(1000))], lastCodeIssuedAt: ago(1000) });

  it('greys the button while a game is in progress', () => {
    expect(labelsOfControl(inProgress())).toContain('Generate Next Game');
    expect(generateIsDisabled(inProgress())).toBe(true);
  });

  it('says why it is greyed, and where the button that clears it is', () => {
    // A disabled button explains nothing on its own, and a captain who cannot
    // tell "not yet" from "broken" opens a ticket.
    const status = buildSeriesStatus(inProgress(), TEAMS, NOW);
    expect(status).toContain('Report the game in progress to unlock the next one');
    expect(status).toContain('code message above');
  });

  it('frees the button once the captain reports the game', () => {
    const series = aSeries({
      tournamentCodes: [aCode(1, ago(2000))],
      games: [aGame(1, 11, 1)],
      lastCodeIssuedAt: ago(2000),
      lastGameAt: ago(1000),
    });
    expect(generateIsDisabled(series)).toBe(false);
    expect(buildSeriesStatus(series, TEAMS, NOW)).not.toContain('unlock the next one');
  });

  it('frees the button when Riot records the game with nobody pressing anything', () => {
    // No game names the code - a Riot pull can land one without Todd hearing -
    // so the ordering of the two timestamps is what says the game is in.
    const series = aSeries({
      tournamentCodes: [aCode(1, ago(2000))],
      lastCodeIssuedAt: ago(2000),
      lastGameAt: ago(1000),
    });
    expect(generateIsDisabled(series)).toBe(false);
  });

  it('frees the button when a custom was played instead', () => {
    // A custom leaves a game with no code on it, so nothing ever names code 1.
    const series = aSeries({
      tournamentCodes: [aCode(1, ago(2000))],
      games: [aGame(1, 11, null)],
      lastCodeIssuedAt: ago(2000),
      lastGameAt: ago(1000),
    });
    expect(generateIsDisabled(series)).toBe(false);
  });

  it('is live at the start of a series, before any code exists', () => {
    expect(generateIsDisabled(aSeries())).toBe(false);
  });

  it('leaves the button live when there is no series to read', () => {
    expect(generateIsDisabled()).toBe(false);
  });

  it('always leaves exactly one live button - never two, never none', () => {
    // The greyed generate and "Code not working?" are gated on the same
    // condition, so the row cannot end up with nothing a captain can press.
    for (const series of [inProgress(), aSeries()]) {
      const buttons = buttonsOf(buildControlRow(USER, seriesData, series)) as {
        label: string;
        disabled?: boolean;
      }[];
      expect(buttons.filter(b => b.disabled !== true)).toHaveLength(1);
    }
  });

  it('does not offer a second code as the way past a game in progress', () => {
    // "Code not working?" is there for a dead code, and it is the only door to
    // a replacement - which is what keeps the allowance one game deep.
    expect(labelsOfControl(inProgress())).toEqual(['Generate Next Game', 'Code not working?']);
  });
});

describe('buildCodeLimitRow', () => {
  const USER = '123456789012345678';

  it('offers both remedies: report what was played, or play a custom', () => {
    const buttons = buttonsOf(buildCodeLimitRow(USER, seriesData, 9, 2));
    expect(buttons.map(b => b.label)).toEqual(['Verify Game 2 Stats', 'Go play a custom game']);
    expect(buttons.map(b => parseButtonData(b.custom_id).tag)).toEqual([
      'report_result',
      'play_custom',
    ]);
  });

  it('never offers a retry - the allowance clears on a result, not on a press', () => {
    const labels = buttonsOf(buildCodeLimitRow(USER, seriesData, 9, 2)).map(b => b.label);
    expect(labels).not.toContain('Try again');
    expect(labels).not.toContain('Generate Next Game');
  });

  it('names the code a result would be credited to', () => {
    const [report] = buttonsOf(buildCodeLimitRow(USER, seriesData, 9, 2));
    expect(parseButtonData(report.custom_id).tagArg).toBe('9-2');
  });

  it('drops the report button when no code is outstanding', () => {
    const labels = buttonsOf(buildCodeLimitRow(USER, seriesData, null, 2)).map(b => b.label);
    expect(labels).toEqual(['Go play a custom game']);
  });
});

type FakeMessage = {
  id: string;
  content: string;
  components: { components?: { customId?: string | null }[] }[];
  delete: ReturnType<typeof vi.fn>;
  edit: ReturnType<typeof vi.fn>;
};

function makeMessage(
  id: string,
  content: string,
  hasComponents: boolean,
  customId?: string,
): FakeMessage {
  return {
    id,
    content,
    components: hasComponents ? [{ components: customId ? [{ customId }] : [] }] : [],
    delete: vi.fn(async () => {}),
    edit: vi.fn(async () => {}),
  };
}

/** A code message carrying the report button for one game, as the thread has it. */
const makeGameMessage = (id: string, gameNumber: number, tournamentCodeId: number) =>
  makeMessage(
    id,
    `# Game ${gameNumber} \nCode: \`\`\`CODE${tournamentCodeId}\`\`\``,
    true,
    buttonsOf(
      buildGameReportRow('123456789012345678', seriesData, tournamentCodeId, gameNumber),
    )[0].custom_id,
  );

/** The custom-in-progress message, whose button names its game but no code. */
const makeCustomMessage = (id: string, gameNumber: number) =>
  makeMessage(
    id,
    `${CUSTOM_MARKER} A custom game is being played for **Game ${gameNumber}**.`,
    true,
    createButtonData(
      'report_custom',
      '123456789012345678',
      seriesData,
      encodeReportTarget(null, gameNumber),
    ).serialize(),
  );

function makeThread(existing: FakeMessage[]) {
  const sent: { content: string; components: ActionRowBuilder<ButtonBuilder>[] }[] = [];
  let nextId = 100;
  const thread = {
    sent,
    fetch: vi.fn(async () => new Map(existing.map(m => [m.id, m]))),
    send: vi.fn(async (payload: { content: string; components: ActionRowBuilder<ButtonBuilder>[] }) => {
      sent.push(payload);
      return { id: String(nextId++) };
    }),
    get messages() {
      return { fetch: thread.fetch };
    },
  };
  return thread;
}

const row = () => buildControlRow('123456789012345678', seriesData);

/**
 * The form is what actually records the match - nothing Todd writes reaches the
 * standings - so this message must land, and must land once.
 */
describe('announceSeriesFinished', () => {
  const FORM = 'https://forms.gle/test-form';

  it('posts the form with the warning that results are not recorded without it', async () => {
    const thread = makeThread([]);
    await announceSeriesFinished(thread, FORM);

    expect(thread.sent).toHaveLength(1);
    expect(thread.sent[0].content).toContain('The series is finished!');
    expect(thread.sent[0].content).toContain('will NOT be recorded');
    expect(thread.sent[0].content).toContain('winning captain');
    expect(thread.sent[0].content).toContain(FORM);
  });

  it('takes the form from config, so a new season does not need a deploy', async () => {
    const thread = makeThread([]);
    await announceSeriesFinished(thread, 'https://forms.gle/next-season');

    expect(thread.sent[0].content).toContain('https://forms.gle/next-season');
  });

  it('carries no buttons - the form is the only action left', async () => {
    const thread = makeThread([]);
    await announceSeriesFinished(thread, FORM);

    expect(thread.sent[0].components).toEqual([]);
  });

  it('says it once, however many times the series is read as complete', async () => {
    // A correction reported after the series closed re-runs this path.
    const thread = makeThread([]);
    await announceSeriesFinished(thread, FORM);
    const posted = makeMessage('100', thread.sent[0].content, false);
    const second = makeThread([posted]);
    await announceSeriesFinished(second, FORM);

    expect(second.sent).toHaveLength(0);
  });

  it('is not confused by the code messages already in the thread', async () => {
    // Both start with "# ", which is why the marker is the whole first phrase.
    const thread = makeThread([makeGameMessage('1', 1, 9), makeGameMessage('2', 2, 10)]);
    await announceSeriesFinished(thread, FORM);

    expect(thread.sent).toHaveLength(1);
  });

  it('posts anyway when the thread cannot be read', async () => {
    // A duplicate reminder costs a scroll; staying quiet costs the match result.
    const thread = makeThread([]);
    thread.fetch.mockRejectedValueOnce(new Error('no permission'));
    await announceSeriesFinished(thread, FORM);

    expect(thread.sent).toHaveLength(1);
  });
});

describe('postSeriesControl', () => {
  let oldControl: FakeMessage;
  let codeBlock: FakeMessage;
  let legacyDraftLinks: FakeMessage;

  beforeEach(() => {
    oldControl = makeMessage('1', `${CONTROL_MARKER}\nolder status`, true);
    codeBlock = makeMessage('2', '# Game 1\nCode: ```ABC123```', false);
    // Threads created before the control message existed carry the Generate Next
    // Game row on their draft-links message.
    legacyDraftLinks = makeMessage('3', '[Blue Link](https://draft.test/1)', true);
  });

  it('posts the new control message behind the marker', async () => {
    const thread = makeThread([]);
    await postSeriesControl(thread, 'status here', [row()]);

    expect(thread.sent).toHaveLength(1);
    expect(thread.sent[0].content.startsWith(CONTROL_MARKER)).toBe(true);
    expect(thread.sent[0].content).toContain('status here');
  });

  it('removes the previous control message', async () => {
    const thread = makeThread([oldControl]);
    await postSeriesControl(thread, 'status', [row()]);

    expect(oldControl.delete).toHaveBeenCalled();
  });

  it('posts before it deletes, so a failed post leaves the old buttons live', async () => {
    const thread = makeThread([oldControl]);
    thread.send.mockRejectedValueOnce(new Error('discord is down'));

    await expect(postSeriesControl(thread, 'status', [row()])).rejects.toThrow();
    expect(oldControl.delete).not.toHaveBeenCalled();
  });

  it('leaves code blocks alone', async () => {
    const thread = makeThread([oldControl, codeBlock]);
    await postSeriesControl(thread, 'status', [row()]);

    expect(codeBlock.delete).not.toHaveBeenCalled();
  });

  it('leaves a legacy draft-links message alone even though it has buttons', async () => {
    const thread = makeThread([legacyDraftLinks]);
    await postSeriesControl(thread, 'status', [row()]);

    expect(legacyDraftLinks.delete).not.toHaveBeenCalled();
  });

  it('does not delete the message it just posted', async () => {
    const thread = makeThread([]);
    await postSeriesControl(thread, 'status', [row()]);
    const posted = makeMessage('100', `${CONTROL_MARKER}\nstatus`, true);

    const second = makeThread([posted]);
    second.send.mockImplementationOnce(async (payload) => {
      second.sent.push(payload);
      return { id: '100' };
    });
    await postSeriesControl(second, 'status', [row()]);
    expect(posted.delete).not.toHaveBeenCalled();
  });

  it('survives a delete that races another press', async () => {
    // Both captains generating at once: the loser's delete finds it already gone.
    const thread = makeThread([oldControl]);
    oldControl.delete.mockRejectedValue({ code: 10008 });

    await expect(postSeriesControl(thread, 'status', [row()])).resolves.toBeUndefined();
  });

  it('survives the thread scan failing entirely', async () => {
    const thread = makeThread([oldControl]);
    thread.fetch.mockRejectedValue(new Error('no permission'));

    await expect(postSeriesControl(thread, 'status', [row()])).resolves.toBeUndefined();
    expect(thread.sent).toHaveLength(1);
  });
});

/**
 * Dennys cannot say which game a code was issued for, so the thread is the
 * record. See the doc comment on highestPostedGameNumber for the two flows that
 * are indistinguishable without it.
 */
describe('highestPostedGameNumber', () => {
  const codeMessage = (id: string, game: number) =>
    makeMessage(id, `# Game ${game} \n 🟦 A v.s. B 🟥\nCode: \`\`\`STUB-${game}\`\`\``, false);

  it('reads the newest slot a code went out for', async () => {
    const thread = makeThread([codeMessage('1', 1), codeMessage('2', 2), codeMessage('3', 3)]);
    expect(await highestPostedGameNumber(thread)).toBe(3);
  });

  it('takes the highest, not the last fetched', async () => {
    // messages.fetch is newest-first, but nothing should depend on the order.
    const thread = makeThread([codeMessage('3', 3), codeMessage('1', 1)]);
    expect(await highestPostedGameNumber(thread)).toBe(3);
  });

  it('is 0 on a thread that has never had a code', async () => {
    // A series played entirely on customs. The caller falls back to its
    // recorded-results baseline rather than a number read from nothing.
    const thread = makeThread([makeMessage('1', `${CONTROL_MARKER}\nstatus`, true)]);
    expect(await highestPostedGameNumber(thread)).toBe(0);
  });

  it('does not read a game number out of the result credit', async () => {
    // "📝 Game 2: Alpha won" is a different message with the same words in it.
    const thread = makeThread([makeMessage('1', '📝 Game 9: **Alpha** won', false)]);
    expect(await highestPostedGameNumber(thread)).toBe(0);
  });

  it('falls back to 0 when the thread cannot be scanned', async () => {
    const thread = makeThread([codeMessage('1', 4)]);
    thread.fetch.mockRejectedValue(new Error('no permission'));
    expect(await highestPostedGameNumber(thread)).toBe(0);
  });
});

/**
 * Regenerating leaves the code it replaced on screen, so the thread shows two
 * live codes for one game with nothing to say which to use. Riot will not
 * retract the old code, so collapsing the slot to its newest message is all
 * Todd can do - and all it needs to, since reporting names a winner rather
 * than a code.
 */
describe('clearSupersededCodes', () => {
  const codeMessage = (id: string, game: number, shortcode: string) =>
    makeMessage(id, `# Game ${game} \n 🟦 A v.s. B 🟥\nCode: \`\`\`${shortcode}\`\`\``, false);

  it('removes the code it replaced', async () => {
    const old = codeMessage('1', 2, 'STUB-6-2');
    const fresh = codeMessage('2', 2, 'STUB-6-3');
    await clearSupersededCodes(makeThread([old, fresh]), 2, '2');

    expect(old.delete).toHaveBeenCalled();
  });

  it('never removes the code it was just handed', async () => {
    const fresh = codeMessage('2', 2, 'STUB-6-3');
    await clearSupersededCodes(makeThread([fresh]), 2, '2');

    expect(fresh.delete).not.toHaveBeenCalled();
  });

  it('leaves earlier games alone - they are the record of what was played', async () => {
    const gameOne = codeMessage('1', 1, 'STUB-6-1');
    const old = codeMessage('2', 2, 'STUB-6-2');
    await clearSupersededCodes(makeThread([gameOne, old]), 2, '3');

    expect(gameOne.delete).not.toHaveBeenCalled();
    expect(old.delete).toHaveBeenCalled();
  });

  it('does not mistake Game 12 for Game 1', async () => {
    const gameTwelve = codeMessage('1', 12, 'STUB-6-12');
    await clearSupersededCodes(makeThread([gameTwelve]), 1, '9');

    expect(gameTwelve.delete).not.toHaveBeenCalled();
  });

  it('leaves the control and recovery messages alone', async () => {
    const control = makeMessage('1', `${CONTROL_MARKER}\nstatus`, true);
    const recovery = makeMessage('2', `${RECOVERY_MARKER} A custom game is being played`, true);
    await clearSupersededCodes(makeThread([control, recovery]), 2, '9');

    expect(control.delete).not.toHaveBeenCalled();
    expect(recovery.delete).not.toHaveBeenCalled();
  });

  it('survives a delete that races another press', async () => {
    const old = codeMessage('1', 2, 'STUB-6-2');
    old.delete.mockRejectedValue({ code: 10008 });

    await expect(clearSupersededCodes(makeThread([old]), 2, '9')).resolves.toBeUndefined();
  });
});


/**
 * Which game a report button is for. The code id is what makes the write
 * idempotent and correctly attributed; the game number is what keeps the credit
 * message consistent with the code message above it, since dennys numbers games
 * in the order results are written rather than the order they were played.
 */
describe('report targets', () => {
  it('round-trips a code id and a game number', () => {
    expect(decodeReportTarget(encodeReportTarget(42, 3))).toEqual({
      tournamentCodeId: 42,
      gameNumber: 3,
    });
  });

  it('has no target when the button carries no argument', () => {
    // The custom game button. There is no code, which is the whole point.
    expect(decodeReportTarget(undefined)).toBeNull();
  });

  it('rejects a malformed argument rather than reporting against code NaN', () => {
    expect(decodeReportTarget('rubbish')).toBeNull();
    expect(decodeReportTarget('12')).toBeNull();
    expect(decodeReportTarget('4-0')).toBeNull();
  });

  it('carries a game number with no code, for a custom', () => {
    // A custom is played outside Riot, so there is no code to name - but Todd
    // still knows which game it is standing in for, which is what ties it to the
    // code message it replaced.
    expect(decodeReportTarget(encodeReportTarget(null, 3))).toEqual({
      tournamentCodeId: null,
      gameNumber: 3,
    });
  });

  it('puts the target on the button, so the press that writes knows the game', () => {
    const [button] = buttonsOf(buildGameReportRow('123456789012345678', seriesData, 42, 3));
    expect(button.label).toBe('Verify Game 3 Stats');
    const parsed = parseButtonData(button.custom_id);
    expect(parsed.tag).toBe('report_result');
    expect(decodeReportTarget(parsed.tagArg)).toEqual({ tournamentCodeId: 42, gameNumber: 3 });
    // The series still has to survive the round trip alongside it.
    expect(parsed.seriesData.seriesId).toBe(756);
    expect(parsed.seriesData.stage).toBe('REGULAR_SEASON');
  });
});

/**
 * A recovery button outlives the problem it was offering a way around. "Try
 * again" and "Go play a custom game" used to stay live for the rest of the
 * series, so a captain reaching for the next game's controls could press one
 * and re-report a game that was already reported.
 */
describe('clearRecoveryButtons', () => {
  let recoveryRow: FakeMessage;
  let customGame: FakeMessage;
  let control: FakeMessage;
  let codeBlock: FakeMessage;

  beforeEach(() => {
    recoveryRow = makeMessage('1', `${RECOVERY_MARKER} Riot refused to create a code.`, true);
    customGame = makeMessage('2', `${CUSTOM_MARKER} A custom game is being played`, true);
    control = makeMessage('3', `${CONTROL_MARKER}\nstatus`, true);
    codeBlock = makeMessage('4', '# Game 1\nCode: ```ABC123```', false);
  });

  it('takes the buttons off a recovery message', async () => {
    const thread = makeThread([recoveryRow]);
    await clearRecoveryButtons(thread);

    expect(recoveryRow.edit).toHaveBeenCalledWith({ components: [] });
  });

  it('keeps the text, so the thread still records what happened', async () => {
    const thread = makeThread([recoveryRow]);
    await clearRecoveryButtons(thread);

    expect(recoveryRow.delete).not.toHaveBeenCalled();
  });

  it('leaves the custom game button alone', async () => {
    // The custom is answered only by its own report, and has to outlive every
    // coded game recorded between now and then. Sweeping them together retired
    // the one button that still had a job.
    const thread = makeThread([recoveryRow, customGame]);
    await clearRecoveryButtons(thread);

    expect(customGame.edit).not.toHaveBeenCalled();
  });

  it('leaves the control message alone - it manages its own replacement', async () => {
    const thread = makeThread([control, recoveryRow]);
    await clearRecoveryButtons(thread);

    expect(control.edit).not.toHaveBeenCalled();
    expect(control.delete).not.toHaveBeenCalled();
  });

  it('ignores messages that carry no buttons', async () => {
    const thread = makeThread([codeBlock]);
    await clearRecoveryButtons(thread);

    expect(codeBlock.edit).not.toHaveBeenCalled();
  });

  it('survives an edit racing a delete', async () => {
    const second = makeMessage('5', `${RECOVERY_MARKER} Riot is unreachable.`, true);
    const thread = makeThread([recoveryRow, second]);
    recoveryRow.edit.mockRejectedValue({ code: 10008 });

    await expect(clearRecoveryButtons(thread)).resolves.toBeUndefined();
    // The one that raced does not stop the rest of the sweep.
    expect(second.edit).toHaveBeenCalled();
  });

  it('survives the thread scan failing entirely', async () => {
    const thread = makeThread([recoveryRow]);
    thread.fetch.mockRejectedValue(new Error('no permission'));

    await expect(clearRecoveryButtons(thread)).resolves.toBeUndefined();
  });
});

/**
 * A custom is played instead of a code that would not work, and records a game
 * with no code on it - so nothing dennys holds ever marks that code answered,
 * and reconcileGameButtons can never retire its button. Retiring by game number
 * is what closes that gap.
 */
describe('retireGameButtons', () => {
  it('retires the dead code button for the game the custom replaces', async () => {
    const game3 = makeGameMessage('1', 3, 1003);
    const thread = makeThread([game3]);
    await retireGameButtons(thread, 3);

    expect(game3.edit).toHaveBeenCalledWith({ components: [] });
  });

  it('retires the custom game button for that game too', async () => {
    const customGame = makeCustomMessage('1', 3);
    const thread = makeThread([customGame]);
    await retireGameButtons(thread, 3);

    expect(customGame.edit).toHaveBeenCalledWith({ components: [] });
    // The text stays: "played as a custom, so there are no stats" is worth
    // keeping in the thread's log.
    expect(customGame.delete).not.toHaveBeenCalled();
  });

  it('leaves other games alone', async () => {
    const game2 = makeGameMessage('1', 2, 1002);
    const game4 = makeGameMessage('2', 4, 1004);
    const thread = makeThread([game2, game4]);
    await retireGameButtons(thread, 3);

    expect(game2.edit).not.toHaveBeenCalled();
    expect(game4.edit).not.toHaveBeenCalled();
  });

  it('leaves a second custom, for a different game, live', async () => {
    const custom3 = makeCustomMessage('1', 3);
    const custom5 = makeCustomMessage('2', 5);
    const thread = makeThread([custom3, custom5]);
    await retireGameButtons(thread, 3);

    expect(custom3.edit).toHaveBeenCalledWith({ components: [] });
    expect(custom5.edit).not.toHaveBeenCalled();
  });

  it('survives the thread scan failing entirely', async () => {
    const thread = makeThread([makeGameMessage('1', 3, 1003)]);
    thread.fetch.mockRejectedValue(new Error('no permission'));

    await expect(retireGameButtons(thread, 3)).resolves.toBeUndefined();
  });
});

/**
 * Driven off what dennys has recorded rather than off what was just clicked,
 * which is what makes it both self-healing and safe: Riot's callback records a
 * game without anyone pressing anything, and a button survives precisely until
 * its own code turns up on a game.
 */
describe('reconcileGameButtons', () => {
  it('retires the button for a game dennys has recorded', async () => {
    const game2 = makeGameMessage('1', 2, 42);
    const thread = makeThread([game2]);
    await reconcileGameButtons(thread, aSeries({ games: [aGame(2, 11, 42)] }));

    expect(game2.edit).toHaveBeenCalledWith({ components: [] });
  });

  it('leaves the button for a game that is still unreported', async () => {
    // The heart of it: reporting game 2 must not disarm game 3.
    const game2 = makeGameMessage('1', 2, 42);
    const game3 = makeGameMessage('2', 3, 43);
    const thread = makeThread([game2, game3]);
    await reconcileGameButtons(thread, aSeries({ games: [aGame(2, 11, 42)] }));

    expect(game2.edit).toHaveBeenCalledWith({ components: [] });
    expect(game3.edit).not.toHaveBeenCalled();
  });

  it('catches up on a game Riot answered while nobody was pressing anything', async () => {
    const game1 = makeGameMessage('1', 1, 41);
    const game2 = makeGameMessage('2', 2, 42);
    const thread = makeThread([game1, game2]);
    await reconcileGameButtons(thread, aSeries({ games: [aGame(1, 11, 41), aGame(2, 22, 42)] }));

    expect(game1.edit).toHaveBeenCalledWith({ components: [] });
    expect(game2.edit).toHaveBeenCalledWith({ components: [] });
  });

  it('never retires anything when no recorded game carries a code', async () => {
    // A series played entirely on customs. Nothing here can be vouched for by a
    // recorded game, so nothing is touched.
    const customGame = makeMessage('1', `${CUSTOM_MARKER} A custom game is being played`, true);
    const thread = makeThread([customGame]);
    await reconcileGameButtons(thread, aSeries({ games: [aGame(1, 11, null)] }));

    expect(customGame.edit).not.toHaveBeenCalled();
  });

  it('ignores buttons that are not report buttons', async () => {
    const control = makeMessage(
      '1',
      `${CONTROL_MARKER}\nstatus`,
      true,
      buttonsOf(buildControlRow('123456789012345678', seriesData))[0].custom_id,
    );
    const thread = makeThread([control]);
    await reconcileGameButtons(thread, aSeries({ games: [aGame(1, 11, 41)] }));

    expect(control.edit).not.toHaveBeenCalled();
  });

  it('survives a custom_id it cannot parse', async () => {
    const junk = makeMessage('1', 'something else', true, 'not-a-todd-button');
    const thread = makeThread([junk]);

    await expect(
      reconcileGameButtons(thread, aSeries({ games: [aGame(1, 11, 41)] })),
    ).resolves.toBeUndefined();
    expect(junk.edit).not.toHaveBeenCalled();
  });

  it('survives the thread scan failing entirely', async () => {
    const thread = makeThread([makeGameMessage('1', 2, 42)]);
    thread.fetch.mockRejectedValue(new Error('no permission'));

    await expect(
      reconcileGameButtons(thread, aSeries({ games: [aGame(2, 11, 42)] })),
    ).resolves.toBeUndefined();
  });
});


/**
 * The one thing dennys cannot be asked and the thread can: which games were
 * played but never reported. Riot answers games out of order, so game 2 landing
 * first leaves game 1's button sitting there with nothing in the status message
 * to say it still matters.
 */
describe('gamesAwaitingReport', () => {
  /** A code message whose report button has already been retired. */
  const reportedGameMessage = (id: string, gameNumber: number) =>
    makeMessage(id, `# Game ${gameNumber} \nCode: \`\`\`CODE\`\`\``, false);

  it('names a game the series has moved past without a result', async () => {
    // Riot answered game 2 first; game 1 was never reported.
    const game1 = makeGameMessage('1', 1, 1001);
    const game2 = reportedGameMessage('2', 2);
    const thread = makeThread([game1, game2]);

    expect(await gamesAwaitingReport(thread, aSeries({ games: [aGame(2, 11, 1002)] }))).toEqual([1]);
  });

  it('says nothing about the game currently being played', async () => {
    // The whole life of a game is "code issued, not yet reported". Listing it
    // would put a warning on the thread the moment every code went out.
    const game1 = makeGameMessage('1', 1, 1001);
    const thread = makeThread([game1]);

    expect(await gamesAwaitingReport(thread, aSeries())).toEqual([]);
  });

  it('lists several, oldest first', async () => {
    const thread = makeThread([
      makeGameMessage('1', 1, 1001),
      makeGameMessage('3', 3, 1003),
      makeGameMessage('2', 2, 1002),
      makeGameMessage('4', 4, 1004),
    ]);

    expect(await gamesAwaitingReport(thread, aSeries())).toEqual([1, 2, 3]);
  });

  it('drops a game dennys has recorded even while its button is still up', async () => {
    // Riot's callback records a game without anyone pressing anything, so the
    // button can outlive its game until the next sweep. Announcing a game that
    // is already in would send captains to report it a second time.
    const game1 = makeGameMessage('1', 1, 1001);
    const game2 = makeGameMessage('2', 2, 1002);
    const thread = makeThread([game1, game2]);

    expect(await gamesAwaitingReport(thread, aSeries({ games: [aGame(1, 11, 1001)] }))).toEqual([]);
  });

  it('counts a superseded code once, not once per code issued', async () => {
    // Two codes for game 2 - a regenerate - and one unreported game 1. The old
    // code message is normally swept, but both being present must not turn one
    // outstanding game into two.
    const thread = makeThread([
      makeGameMessage('1', 1, 1001),
      makeGameMessage('2', 2, 1002),
      makeGameMessage('3', 2, 1003),
    ]);

    expect(await gamesAwaitingReport(thread, aSeries())).toEqual([1]);
  });

  it('keeps listing a custom, which no dennys record can ever vouch for', async () => {
    // A custom records a codeless game, so the recorded-code check can never
    // clear it. Only someone reporting it can.
    const custom = makeCustomMessage('1', 1);
    const game2 = makeGameMessage('2', 2, 1002);
    const thread = makeThread([custom, game2]);

    expect(await gamesAwaitingReport(thread, aSeries({ games: [aGame(1, 11, null)] }))).toEqual([1]);
  });

  it('reads the game in progress off a custom with no code message above it', async () => {
    // Riot refused a code outright, so there is no "# Game 2" heading - the
    // custom's own button is the only record that game 2 exists.
    const game1 = makeGameMessage('1', 1, 1001);
    const custom2 = makeCustomMessage('2', 2);
    const thread = makeThread([game1, custom2]);

    expect(await gamesAwaitingReport(thread, aSeries())).toEqual([1]);
  });

  it('stays quiet when everything is reported', async () => {
    const thread = makeThread([reportedGameMessage('1', 1), reportedGameMessage('2', 2)]);

    expect(await gamesAwaitingReport(thread, aSeries())).toEqual([]);
  });

  it('says nothing rather than guessing when the thread cannot be read', async () => {
    const thread = makeThread([makeGameMessage('1', 1, 1001), reportedGameMessage('2', 2)]);
    thread.fetch.mockRejectedValue(new Error('no permission'));

    expect(await gamesAwaitingReport(thread, aSeries())).toEqual([]);
  });
});

/**
 * The sweeps are strictly ordered - retire, then list what is left - so they
 * cannot be fired in parallel, and reporting a custom ran five of them back to
 * back against the same fifty messages. Sharing the read is the fix; the tests
 * here are about it staying a *correct* read once the sweeps start writing.
 */
describe('shareThreadScan', () => {
  it('asks Discord for the thread once, however many sweeps run', async () => {
    const thread = makeThread([makeGameMessage('1', 1, 1001), makeGameMessage('2', 2, 1002)]);
    const scan = shareThreadScan(thread);

    await reconcileGameButtons(scan, aSeries({ games: [aGame(1, 11, 1001)] }));
    await clearRecoveryButtons(scan);
    await retireGameButtons(scan, 2);
    await gamesAwaitingReport(scan, aSeries());

    expect(thread.fetch).toHaveBeenCalledTimes(1);
  });

  it('still reads the thread once per handler, not once per process', async () => {
    // Scoped to one interaction. A cache that outlived the handler would have
    // to reason about Riot recording a game in between; this cannot.
    const thread = makeThread([makeGameMessage('1', 1, 1001)]);

    await clearRecoveryButtons(shareThreadScan(thread));
    await clearRecoveryButtons(shareThreadScan(thread));

    expect(thread.fetch).toHaveBeenCalledTimes(2);
  });

  it('shows a later sweep the button an earlier one retired', async () => {
    // The whole reason sharing is safe. Without this, the status message would
    // name the game whose button was just cleared as still awaiting a result.
    const custom = makeCustomMessage('1', 3);
    const game4 = makeGameMessage('2', 4, 1004);
    const scan = shareThreadScan(makeThread([custom, game4]));

    await retireGameButtons(scan, 3);

    expect(await gamesAwaitingReport(scan, aSeries())).toEqual([]);
  });

  it('does not spend a second edit clearing buttons that are already gone', async () => {
    // A custom is matched twice over: once by game number, once by the recorded
    // game its report wrote. Both sweeps have to run; only one needs a request.
    const game2 = makeGameMessage('1', 2, 1002);
    const scan = shareThreadScan(makeThread([game2]));

    await reconcileGameButtons(scan, aSeries({ games: [aGame(2, 11, 1002)] }));
    await retireGameButtons(scan, 2);

    expect(game2.edit).toHaveBeenCalledTimes(1);
  });

  it('stops offering a message that has been deleted', async () => {
    const control = makeMessage('1', `${CONTROL_MARKER}\nolder status`, true);
    const game1 = makeGameMessage('2', 1, 1001);
    const scan = shareThreadScan(makeThread([control, game1]));

    await postSeriesControl(scan, 'status', []);
    await clearRecoveryButtons(scan);

    expect(control.delete).toHaveBeenCalledTimes(1);
  });

  it('passes sends straight through', async () => {
    const thread = makeThread([]);
    await postSeriesControl(shareThreadScan(thread), 'status', []);

    expect(thread.sent).toHaveLength(1);
    expect(thread.sent[0].content).toContain('status');
  });

  it('lets every sweep fail on its own terms when the thread cannot be read', async () => {
    // Shared rejection: one failed call, not one per sweep retrying it.
    const thread = makeThread([makeGameMessage('1', 1, 1001)]);
    thread.fetch.mockRejectedValue(new Error('no permission'));
    const scan = shareThreadScan(thread);

    await expect(clearRecoveryButtons(scan)).resolves.toBeUndefined();
    await expect(retireGameButtons(scan, 1)).resolves.toBeUndefined();
    expect(thread.fetch).toHaveBeenCalledTimes(1);
  });
});

/**
 * Todd's own ceiling, not dennys's. Ten codes on one series means something is
 * looping, and the only safe move is to stop and fetch a human.
 */
describe('a series that has run away with codes', () => {
  const USER = '123456789012345678';
  const tenCodes = () =>
    aSeries({ tournamentCodes: Array.from({ length: 10 }, (_, i) => aCode(i + 1, ago(1000))) });
  const nineCodes = () =>
    aSeries({ tournamentCodes: Array.from({ length: 9 }, (_, i) => aCode(i + 1, ago(1000))) });

  it('leaves no button at all on the control row', () => {
    expect(buttonsOf(buildControlRow(USER, seriesData, tenCodes()))).toHaveLength(0);
  });

  it('still has its buttons one code short of the cap', () => {
    expect(buttonsOf(buildControlRow(USER, seriesData, nineCodes())).length).toBeGreaterThan(0);
  });

  it('says it is locked, and says nothing that names a button', () => {
    const status = buildSeriesStatus(tenCodes(), TEAMS, NOW);
    expect(status).toContain('This series is locked');
    expect(status).toContain('dev has been notified');
    expect(status).not.toContain('Verify Stats');
    expect(status).not.toContain('unlock the next one');
    expect(status).not.toContain('No more codes');
  });

  it('keeps the score, so the thread still says where the series got to', () => {
    const series = aSeries({
      tournamentCodes: Array.from({ length: 10 }, (_, i) => aCode(i + 1, ago(1000))),
      games: [aGame(1, 11, 1)],
    });
    expect(buildSeriesStatus(series, TEAMS, NOW)).toContain('**Alpha** 1 – **Bravo** 0');
  });

  it('drops the empty row rather than sending one Discord rejects', async () => {
    const thread = makeThread([]);
    await postSeriesControl(thread, 'locked', [buildControlRow(USER, seriesData, tenCodes())]);

    expect(thread.sent).toHaveLength(1);
    expect(thread.sent[0].components).toEqual([]);
  });
});

describe('announceSeriesLocked', () => {
  it('pings the dev team and names the series and the count', async () => {
    const thread = makeThread([]);
    await announceSeriesLocked(thread, 756, 10, '<@&1209287588796436561>');

    expect(thread.sent[0].content).toContain('<@&1209287588796436561>');
    expect(thread.sent[0].content).toContain('756');
    expect(thread.sent[0].content).toContain('10');
  });

  it('says it once, so a captain hammering a button cannot spam the ping', async () => {
    const thread = makeThread([]);
    await announceSeriesLocked(thread, 756, 10, '<@&1>');
    const posted = makeMessage('100', thread.sent[0].content, false);
    const second = makeThread([posted]);
    await announceSeriesLocked(second, 756, 10, '<@&1>');

    expect(second.sent).toHaveLength(0);
  });

  it('carries no buttons - that is the point of it', async () => {
    const thread = makeThread([]);
    await announceSeriesLocked(thread, 756, 10, '<@&1>');

    expect(thread.sent[0].components).toEqual([]);
  });
});

/**
 * The shortcode is the one handle Riot, dennys, Todd and the captains all agree
 * on, so the refresh endpoint is keyed by it - and the only place Todd keeps it
 * after issuing is the message it printed it on.
 */
describe('reading a code back off a message', () => {
  const codeMessage = (game: number, shortcode: string) =>
    `# Game ${game} \n 🟦 A v.s. B 🟥\nCode: \`\`\`${shortcode}\`\`\`\nGame Generated By: <@1>`;

  it('takes the code out of the message Todd printed it on', () => {
    expect(shortcodeIn(codeMessage(1, 'NA050c5-695bbdae-f77a'))).toBe('NA050c5-695bbdae-f77a');
  });

  it('says nothing for a message that carries no code', () => {
    expect(shortcodeIn('## 📋 Series status\n**Alpha** 0 – **Bravo** 0')).toBeNull();
    expect(shortcodeIn(undefined)).toBeNull();
  });

  it('is not fooled by a draft link or a team name', () => {
    // Matched against the exact shape getTournamentCode prints, not by hunting
    // for anything code-shaped.
    expect(shortcodeIn('[Blue Link](https://draft.test/UnB26yxPUw/Sf8SyLnXsQ)')).toBeNull();
  });

  it('finds the code for one game among the thread', async () => {
    const thread = makeThread([
      makeMessage('1', codeMessage(1, 'CODE-ONE'), false),
      makeMessage('2', codeMessage(2, 'CODE-TWO'), false),
    ]);
    expect(await shortcodeForGame(thread, 2)).toBe('CODE-TWO');
  });

  it('does not match game 1 against game 12', async () => {
    const thread = makeThread([makeMessage('1', codeMessage(12, 'CODE-TWELVE'), false)]);
    expect(await shortcodeForGame(thread, 1)).toBeNull();
  });

  it('says nothing rather than guessing when the thread cannot be read', async () => {
    const thread = makeThread([]);
    thread.fetch.mockRejectedValueOnce(new Error('no permission'));
    expect(await shortcodeForGame(thread, 1)).toBeNull();
  });
});
