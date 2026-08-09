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
      return aSeries();
    }),
    reportSeriesResult: vi.fn(async (seriesId: number, body: unknown) => {
      calls.push('reportSeriesResult');
      reported.push({ seriesId, body });
      return { id: 1, seriesId, number: 1, result: null };
    }),
  };
});

const { handleReportResult, handleReportTeam1Won } = await import(
  '../src/buttons/handlers/reportResult.ts'
);
const { createButtonData, parseButtonData } = await import('../src/buttons/button.ts');
const { buildControlRow, STALE_CODE_MS } = await import('../src/seriesControl.ts');

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

function makeInteraction(tag: string, userId = ORIGINAL_USER) {
  const interaction = {
    customId: createButtonData(tag, ORIGINAL_USER, seriesData).serialize(),
    user: { id: userId },
    replied: false,
    deferred: false,
    isRepliable: () => true,
    isMessageComponent: () => true,
    channel: {
      send: vi.fn(async (payload: { content: string; components?: unknown[] }) => {
        threadSends.push(payload);
        return { id: '1' };
      }),
      messages: { fetch: vi.fn(async () => new Map()) },
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
});

describe('the Report button only appears once a code has gone unanswered', () => {
  const now = Date.parse('2026-08-09T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('is absent while the code is fresh', () => {
    // A report filed now would be recorded codeless and duplicated when Riot
    // catches up, so waiting is the better default.
    const series = aSeries({ lastCodeIssuedAt: ago(1000) });
    const labels = buttonsOf(buildControlRow(ORIGINAL_USER, seriesData, series, now)).map(
      b => b.label,
    );
    expect(labels).toEqual(['Generate Next Game', 'Code not working?']);
  });

  it('appears once the code is stale', () => {
    const series = aSeries({ lastCodeIssuedAt: ago(STALE_CODE_MS + 1000) });
    const labels = buttonsOf(buildControlRow(ORIGINAL_USER, seriesData, series, now)).map(
      b => b.label,
    );
    expect(labels).toEqual(['Generate Next Game', 'Report result', 'Code not working?']);
  });

  it('still appears on a completed series', () => {
    // Dennys does not block a completed series from taking results either, and a
    // captain correcting one that closed early must not be locked out.
    const series = aSeries({ completed: true, lastCodeIssuedAt: ago(STALE_CODE_MS * 5) });
    const labels = buttonsOf(buildControlRow(ORIGINAL_USER, seriesData, series, now)).map(
      b => b.label,
    );
    expect(labels).toContain('Report result');
  });

  it('always offers the recovery entry point, code or no code', () => {
    // A dead code and a code that never generated need the same exits.
    const labels = buttonsOf(buildControlRow(ORIGINAL_USER, seriesData, undefined, now)).map(
      b => b.label,
    );
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
    expect(emoji).not.toContain('🟦');
    expect(emoji).not.toContain('🟥');
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

describe('recording the result', () => {
  it('sends the winner and nothing that identifies a code', async () => {
    // With two codes outstanding Todd cannot know which the lobby used. Dennys
    // asks Riot; naming the wrong code records a duplicate game.
    const interaction = makeInteraction('report_team1_won');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    expect(reported).toEqual([{ seriesId: 756, body: { winnerTeamId: 11 } }]);
  });

  it('refreshes the control message afterwards', async () => {
    const interaction = makeInteraction('report_team1_won');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleReportTeam1Won(interaction as any);

    expect(threadSends.at(-1)!.content).toContain('Best of 3');
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
