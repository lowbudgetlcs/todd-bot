import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createButtonData, parseButtonData } from '../src/buttons/button.ts';
import { SeriesData } from '../src/types/toddData.ts';
import { CONTROL_MARKER } from '../src/seriesControl.ts';
import { HttpError } from '../src/http.ts';

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

/**
 * Stands in for dennys pulling a played game off Riot when a code is issued
 * (`SeriesService.createGame` calls `refreshQuietly` before minting one). Set by
 * the test that pins Todd reading the series *after* that has had a chance to run.
 */
let issueRecoversLostGame = false;

/** One open series for the pair unless a test says otherwise. */
const aSeries = (id: number, totalGames: number) => ({
  id,
  eventId: 7,
  teamIds: [11, 22],
  totalGames,
  eventStage: 'REGULAR_SEASON',
  completed: false,
  completedAt: null,
  reopenedAt: null,
});
let seriesCandidates: ReturnType<typeof aSeries>[] = [];

/** Set to make the code request fail: Riot being down, or the allowance being spent. */
let issueFailsWith: { status: number; body?: string } | null = null;

/** Codes already issued against the series, for the allowance the 409 reports on. */
let seriesCodes: { id: number; createdAt: string | null }[] = [];

/** Set to make the read that follows a refused code fail too. */
let seriesFailsToLoad = false;

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
    findSeriesForTeams: vi.fn(async () => {
      calls.push('findSeriesForTeams');
      return seriesCandidates;
    }),
    issueTournamentCode: vi.fn(async () => {
      calls.push('issueTournamentCode');
      if (issueFailsWith)
        throw new HttpError('riot', issueFailsWith.status, issueFailsWith.body ?? '');
      if (issueRecoversLostGame) seriesGames = [{ id: 4, seriesId: 756, number: 1 }];
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
      if (seriesFailsToLoad) throw new HttpError('series', 500, '');
      return {
        id,
        eventId: 7,
        teamIds: [11, 22],
        totalGames: 3,
        eventStage: 'REGULAR_SEASON',
        completed: false,
        completedAt: null,
        reopenedAt: null,
        tournamentCodes: seriesCodes,
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

const { getTournamentCode, handleBothTeamSubmission, handleTeamSelect } = await import(
  '../src/commands/tournament.ts'
);

const ORIGINAL_USER = '123456789012345678';

// Unpinned, which is the state the selection flow is in: the series is not known
// until handleBothTeamSubmission resolves it.
const seriesData: SeriesData = {
  enemyCaptainId: '223456789012345678',
  divisionId: 7,
  team1Id: 11,
  team2Id: 22,
  seriesId: 0,
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
        startThread: vi.fn(async (options: { name: string; autoArchiveDuration: number }) => {
          threadOptions.push(options);
          return {
            // discord.js is not mocked, so these are real builders and toJSON()
            // gives back the custom_id parseButtonData round-trips.
            send: vi.fn(async (payload: { content?: string; components?: unknown[] }) => {
              threadSends.push(payload?.content ?? '');
              threadComponents.push(payload?.components ?? []);
              return { id: String(threadSends.length) };
            }),
            // postSeriesControl scans for control messages it should replace.
            messages: { fetch: vi.fn(async () => new Map()) },
          };
        }),
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
let threadComponents: unknown[][] = [];
let threadOptions: { name: string; autoArchiveDuration: number }[] = [];

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
  threadComponents = [];
  threadOptions = [];
  seriesGames = [];
  issueRecoversLostGame = false;
  seriesCandidates = [aSeries(756, 3)];
  issueFailsWith = null;
  seriesCodes = [];
  seriesFailsToLoad = false;
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

  it('reads the series after the code is issued, so a recovered game counts', async () => {
    // Issuing a code makes dennys pull any played game it has not heard about
    // yet. Reading the series first reports the pre-pull count, which renders
    // "# Game 1" forever whenever a Riot callback went missing.
    issueRecoversLostGame = true;
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    // lastIndexOf, not indexOf: the code-cap check reads the series first, and
    // what this is about is the read the game number comes from.
    expect(calls.indexOf('issueTournamentCode')).toBeLessThan(calls.lastIndexOf('getSeries'));
    expect(threadSends.find(c => c.includes('# Game'))).toContain('# Game 2');
  });
});

describe('picking between repeat series for the same pair', () => {
  /** Rows on the last thing rendered to the selection message. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = () => ((editReplyPayloads.at(-1) as any)?.components ?? []) as any[];
  const rowTags = () =>
    rows().map(r => parseButtonData(r.toJSON().components[0].custom_id).tag);

  async function chooseAll(data: SeriesData = seriesData) {
    const interaction = makeInteraction('stage_select', { ...data, stage: '' });
    interaction.values = ['REGULAR_SEASON'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleTeamSelect(interaction as any);
    return interaction;
  }

  it('says so when the pair has no open series', async () => {
    seriesCandidates = [];
    await chooseAll();

    expect(editReplyPayloads.at(-1)).toMatchObject({
      content: expect.stringContaining('Failed to find a matching series'),
      components: [],
    });
  });

  it('uses the only candidate without asking', async () => {
    await chooseAll();

    expect(rowTags()).toEqual(['confirm']);
    expect(editReplyPayloads.at(-1)).toMatchObject({
      content: expect.stringContaining('Best of 3'),
    });
  });

  it('asks which series when two differ by Bo', async () => {
    seriesCandidates = [aSeries(756, 3), aSeries(801, 5)];
    await chooseAll();

    expect(rowTags()).toEqual([
      'team1_select',
      'team2_select',
      'stage_select',
      'series_select',
    ]);
    const options = rows()[3].toJSON().components[0].options;
    expect(options.map((o: { label: string }) => o.label)).toEqual(['Best of 3', 'Best of 5']);
  });

  it('does not offer Confirm until a series is chosen', async () => {
    seriesCandidates = [aSeries(756, 3), aSeries(801, 5)];
    await chooseAll();

    expect(rowTags()).not.toContain('confirm');
  });

  it('auto-picks the lowest id when two are the same Bo', async () => {
    // Interchangeable to a code-issuing service, and a "Bo3 / Bo3" dropdown
    // reads as broken.
    seriesCandidates = [aSeries(801, 3), aSeries(756, 3)];
    await chooseAll();

    expect(rowTags()).toEqual(['confirm']);
    const parsed = parseButtonData(rows()[0].toJSON().components[0].custom_id);
    expect(parsed.seriesData.seriesId).toBe(801);
  });

  it('pins the chosen series onto Confirm', async () => {
    seriesCandidates = [aSeries(756, 3), aSeries(801, 5)];
    const interaction = makeInteraction('series_select', { ...seriesData, seriesId: 0 });
    interaction.values = ['801'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleTeamSelect(interaction as any);

    expect(rowTags()).toEqual(['confirm']);
    const parsed = parseButtonData(rows()[0].toJSON().components[0].custom_id);
    expect(parsed.seriesData.seriesId).toBe(801);
  });

  it('drops a chosen series when the teams change under it', async () => {
    seriesCandidates = [aSeries(756, 3), aSeries(801, 5)];
    const interaction = makeInteraction('team1_select', { ...seriesData, seriesId: 801 });
    interaction.values = ['11'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleTeamSelect(interaction as any);

    // Back to asking, rather than carrying a series chosen against the old pair.
    expect(rowTags()).toContain('series_select');
  });
});

describe('Riot refusing a code at game 1', () => {
  beforeEach(() => {
    issueFailsWith = { status: 503 };
  });

  it('still opens the thread, so a codeless series has somewhere to live', async () => {
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(interaction.followUp).toHaveBeenCalled();
    expect(threadSends).toHaveLength(1);
  });

  it('offers a retry and the custom path when Riot is merely unreachable', async () => {
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const labels = (threadComponents[0][0] as any)
      .toJSON()
      .components.map((b: { label: string }) => b.label);
    expect(labels).toEqual(['Try again', 'Go play a custom game']);
  });

  it('drops the retry when Riot refused outright', async () => {
    // 502 will not succeed on another press; offering one wastes their time.
    issueFailsWith = { status: 502 };
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const labels = (threadComponents[0][0] as any)
      .toJSON()
      .components.map((b: { label: string }) => b.label);
    expect(labels).toEqual(['Go play a custom game']);
  });

  it('pins the resolved series onto the recovery buttons', async () => {
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [button] = (threadComponents[0][0] as any).toJSON().components;
    expect(parseButtonData(button.custom_id).seriesData.seriesId).toBe(756);
  });

  it('says Riot is the reason, not the series lookup', async () => {
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(threadSends[0]).toContain('Riot');
    expect(threadSends[0]).not.toContain('matching series');
  });
});

/**
 * Dennys 1.4.1 answers 409 once a game has taken its codes, counted since the
 * most recent recorded game (todd-bot#126). Another press cannot clear it, so
 * the captain gets the message dennys wrote and the two things that can.
 */
describe('dennys refusing a code because the allowance is spent', () => {
  const MESSAGE = "Series '756' has already been issued 2 tournament code(s).";

  beforeEach(() => {
    issueFailsWith = { status: 409, body: JSON.stringify({ code: 409, message: MESSAGE }) };
    seriesCodes = [
      { id: 8, createdAt: '2026-08-09T11:00:00Z' },
      { id: 9, createdAt: '2026-08-09T12:00:00Z' },
    ];
  });

  it('shows what dennys said, not generic failure text', async () => {
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(threadSends[0]).toContain('already been issued 2 tournament code(s)');
    expect(threadSends[0]).not.toContain('An error occurred');
  });

  it("drops the series id out of dennys's wording", async () => {
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(threadSends[0]).toContain('This game has already been issued');
    expect(threadSends[0]).not.toContain('756');
  });

  it('bolds the two things a captain can actually do', async () => {
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(threadSends[0]).toContain(
      '**Report the result of the game you already played, ' +
        'or play a custom game and report the winner.**',
    );
  });

  it('opens the thread anyway, so the series has somewhere to be played out', async () => {
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(interaction.followUp).toHaveBeenCalled();
    expect(threadSends).toHaveLength(1);
  });

  it('offers both remedies and no retry', async () => {
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const labels = (threadComponents[0][0] as any)
      .toJSON()
      .components.map((b: { label: string }) => b.label);
    expect(labels).toEqual(['Verify Game 1 Stats', 'Go play a custom game']);
  });

  it('points the report button at the code still outstanding', async () => {
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [report] = (threadComponents[0][0] as any).toJSON().components;
    const parsed = parseButtonData(report.custom_id);
    expect(parsed.tag).toBe('report_result');
    expect(parsed.tagArg).toBe('9-1');
    expect(parsed.seriesData.seriesId).toBe(756);
  });

  it('asks dennys once - pressing again cannot clear the allowance', async () => {
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(calls.filter(c => c === 'issueTournamentCode')).toHaveLength(1);
  });

  it('falls back to its own wording when dennys sends no message', async () => {
    issueFailsWith = { status: 409, body: 'Conflict' };
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(threadSends[0]).toContain('No more codes can be issued for this game');
  });

  it('drops the report button when the series cannot be read back', async () => {
    // The custom game is still the way forward; only the button that has to
    // name a code goes with the failed lookup.
    seriesFailsToLoad = true;
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const labels = (threadComponents[0][0] as any)
      .toJSON()
      .components.map((b: { label: string }) => b.label);
    expect(labels).toEqual(['Go play a custom game']);
  });
});

describe('the series thread', () => {
  it('is given the longest archive window Discord allows', async () => {
    // A series can sit paused for hours and still take games afterwards, and
    // Todd cannot post the next code into an archived thread. There is no way
    // to opt out of archiving, so the ceiling is the closest thing to it.
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(threadOptions[0].autoArchiveDuration).toBe(10080);
  });

  it('gets the same window when Riot refused the code', async () => {
    // That thread is the more important one: it is where a codeless series is
    // played out, which takes longer than a normal one.
    issueFailsWith = { status: 503 };
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(threadOptions[0].autoArchiveDuration).toBe(10080);
  });
});

describe('the thread ends with the controls', () => {
  it('posts draft links, then the code, then the controls', async () => {
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(threadSends[0]).toContain('draft links');
    expect(threadSends[1]).toContain('# Game');
    expect(threadSends.at(-1)).toContain(CONTROL_MARKER);
  });

  it('leaves the draft links without buttons', async () => {
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(threadComponents[0]).toEqual([]);
    expect(threadComponents.at(-1)).toHaveLength(1);
  });

  it('puts the report button on the code message, where it can name its code', async () => {
    // Not on the control message: a button there could only mean "the game I
    // think you mean", and it would have no code to name.
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [button] = (threadComponents[1] as any[])[0].toJSON().components as {
      label: string;
      custom_id: string;
    }[];
    expect(button.label).toBe('Verify Game 1 Stats');
    const parsed = parseButtonData(button.custom_id);
    expect(parsed.tag).toBe('report_result');
    // The code dennys just issued, and the game number the thread is showing.
    expect(parsed.tagArg).toBe('9-1');
  });

  it('renders the score and the Bo on the control message', async () => {
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(threadSends.at(-1)).toContain('**Team 11** 0 – **Team 22** 0');
    expect(threadSends.at(-1)).toContain('Best of 3');
  });
});

describe('the series is pinned once resolved', () => {
  /** The row on the message that drives every later game. */
  const generateButton = () => {
    const row = threadComponents.at(-1)?.[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (row as any)?.toJSON().components[0];
  };

  it('resolves by team pair when nothing is pinned yet', async () => {
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(calls).toContain('getSeriesId');
  });

  it('carries the resolved series on the button it posts', async () => {
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    const parsed = parseButtonData(generateButton().custom_id);
    expect(parsed.tag).toBe('generate_another');
    expect(parsed.seriesData.seriesId).toBe(756);
  });

  it('does not resolve by team pair again once pinned', async () => {
    // The failure this prevents: dennys closes series 1, and the next press
    // silently starts issuing codes into series 2 for the same pair.
    const interaction = makeInteraction('confirm', { ...seriesData, seriesId: 756 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(calls).not.toContain('getSeriesId');
    expect(calls).toContain('issueTournamentCode');
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
    // team pair and could disagree (todd-bot#97). Reads by id are not the
    // hazard and there are two - the code-cap check, then the read the number
    // and the Bo both come from; resolving by pair twice is.
    const interaction = makeInteraction('confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleBothTeamSubmission(interaction as any);

    expect(calls.filter(c => c === 'getSeriesId')).toHaveLength(1);
    expect(calls.filter(c => c === 'findSeriesForTeams')).toHaveLength(0);
    expect(calls).not.toContain('getTotalGames');
  });

  it('does not re-read the series for the cap on a mid-series generate', async () => {
    // The router refuses a locked series before the handler runs, so the check
    // here is only for /start-series. One read, after issuing, as before.
    await getTournamentCode({
      team1Id: 11,
      team2Id: 22,
      divisionId: 7,
      stage: 'REGULAR_SEASON',
      seriesId: 756,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      interaction: makeInteraction('generate_another_confirm') as any,
      enemyCaptainId: seriesData.enemyCaptainId,
      first: false,
    });

    expect(calls.filter(c => c === 'getSeries')).toHaveLength(1);
  });
});

/**
 * Recorded results only move when someone reports, so they cannot tell a second
 * "Generate Next Game" apart from a replacement for the code already out. The
 * thread's own "# Game N" headings are the missing half.
 */
describe('the game number of a code issued mid-series', () => {
  const codeMessage = (id: string, game: number) => ({
    id,
    content: `# Game ${game} \n 🟦 A v.s. B 🟥\nCode: \`\`\`STUB-${game}\`\`\``,
    components: [],
  });

  /** A thread already showing the code messages Todd posted for this series. */
  const inThread = (posted: { id: string; content: string; components: unknown[] }[]) => {
    const interaction = makeInteraction('generate_another_confirm');
    return Object.assign(interaction, {
      channel: { messages: { fetch: vi.fn(async () => new Map(posted.map(m => [m.id, m]))) } },
    });
  };

  const issue = async (
    interaction: ReturnType<typeof inThread>,
    replacement: boolean,
  ) =>
    getTournamentCode({
      team1Id: 11,
      team2Id: 22,
      divisionId: 7,
      stage: 'REGULAR_SEASON',
      seriesId: 756,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      interaction: interaction as any,
      enemyCaptainId: seriesData.enemyCaptainId,
      first: false,
      replacement,
    });

  it('advances past the last code even when nothing has been reported', async () => {
    // Generate Next Game twice: the second is game 3, not game 2 again.
    seriesGames = [{ id: 4, seriesId: 756, number: 1 }];
    const result = await issue(inThread([codeMessage('1', 1), codeMessage('2', 2)]), false);

    expect(result.gameNumber).toBe(3);
  });

  it('holds the number when the code it replaces was declared dead', async () => {
    // The recovery flow promises exactly this: "a replacement code does not
    // affect the game number".
    seriesGames = [{ id: 4, seriesId: 756, number: 1 }];
    const result = await issue(inThread([codeMessage('1', 1), codeMessage('2', 2)]), true);

    expect(result.gameNumber).toBe(2);
  });

  it('holds the number through repeated replacements', async () => {
    // Each regenerate deletes the message it replaced, so the thread keeps
    // showing one code for the slot and the number stays put.
    seriesGames = [{ id: 4, seriesId: 756, number: 1 }];
    const result = await issue(inThread([codeMessage('1', 1), codeMessage('3', 2)]), true);

    expect(result.gameNumber).toBe(2);
  });

  it('falls back to recorded results when the thread has no code messages', async () => {
    // A series played entirely on customs still has to number its first code.
    seriesGames = [{ id: 4, seriesId: 756, number: 1 }];
    const result = await issue(inThread([]), false);

    expect(result.gameNumber).toBe(2);
  });

  it('never goes backwards when the thread lags behind the recorded results', async () => {
    // Results can arrive from Riot without a code message ever being posted.
    seriesGames = [
      { id: 4, seriesId: 756, number: 1 },
      { id: 5, seriesId: 756, number: 2 },
      { id: 6, seriesId: 756, number: 3 },
    ];
    const result = await issue(inThread([codeMessage('1', 1)]), true);

    expect(result.gameNumber).toBe(4);
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
