import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionRowBuilder, ButtonBuilder } from 'discord.js';
import {
  CONTROL_MARKER,
  STALE_CODE_MS,
  buildControlRow,
  buildSeriesStatus,
  isCodeStale,
  postSeriesControl,
} from '../src/seriesControl.ts';
import { parseButtonData } from '../src/buttons/button.ts';
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

const aGame = (number: number, winningTeamId: number) => ({
  id: number,
  seriesId: 756,
  number,
  result: { winningTeamId, losingTeamId: winningTeamId === 11 ? 22 : 11 },
  tournamentCodeId: null,
  riotMatchId: null,
  createdAt: null,
});

const aCode = (id: number) => ({
  id,
  shortcode: `CODE${id}`,
  seriesId: 756,
  blueTeamId: 11,
  redTeamId: 22,
  createdAt: null,
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

  it('calls out more than one outstanding code', () => {
    // Two captains pressing at once, or a dead code that was replaced. Only the
    // one actually played needs a result.
    const series = aSeries({ tournamentCodes: [aCode(1), aCode(2), aCode(3)] });
    expect(buildSeriesStatus(series, TEAMS, NOW)).toContain('3 codes are outstanding');
  });

  it('calls out a code that has gone unanswered', () => {
    const series = aSeries({
      tournamentCodes: [aCode(1)],
      lastCodeIssuedAt: ago(STALE_CODE_MS * 2),
    });
    expect(buildSeriesStatus(series, TEAMS, NOW)).toContain('no result yet');
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
});

type FakeMessage = {
  id: string;
  content: string;
  components: unknown[];
  delete: ReturnType<typeof vi.fn>;
};

function makeMessage(id: string, content: string, hasComponents: boolean): FakeMessage {
  return {
    id,
    content,
    components: hasComponents ? [{}] : [],
    delete: vi.fn(async () => {}),
  };
}

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
