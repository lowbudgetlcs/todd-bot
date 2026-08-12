import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Ten codes on one series means something is looping - a captain, a stuck
 * button, or Todd itself - and no button in that thread should do anything
 * until a human has looked. The guard sits in the router precisely so "stop
 * all flows" holds for flows nobody remembered to gate.
 */

/** Codes on the series the guard reads. Set per test. */
let codeCount = 10;
/** Set to make the read fail, which must not lock anyone out. */
let seriesFailsToLoad = false;

vi.mock('../src/dennys.ts', async importOriginal => {
  // isSeriesLocked is pure and covered by dennys.test.ts - only the read is
  // stubbed, so the threshold under test is the real one.
  const actual = await importOriginal<typeof import('../src/dennys.ts')>();
  return {
    ...actual,
    getSeries: vi.fn(async (id: number) => {
      if (seriesFailsToLoad) throw new Error('dennys is down');
      return {
        id,
        eventId: 7,
        teamIds: [11, 22],
        totalGames: 3,
        eventStage: 'REGULAR_SEASON',
        completed: false,
        completedAt: null,
        reopenedAt: null,
        tournamentCodes: Array.from({ length: codeCount }, (_, i) => ({
          id: i + 1,
          shortcode: `CODE${i + 1}`,
          seriesId: id,
          blueTeamId: 11,
          redTeamId: 22,
          createdAt: '2026-08-09T12:00:00Z',
        })),
        games: [],
        lastCodeIssuedAt: '2026-08-09T12:00:00Z',
        lastGameAt: null,
      };
    }),
  };
});

const { refuseIfSeriesLocked } = await import('../src/buttons/seriesLock.ts');
const { config } = await import('../src/config.ts');

const ORIGINAL_USER = '123456789012345678';

const replies: { content?: string; ephemeral?: boolean }[] = [];
const threadSends: { content?: string; components?: unknown[] }[] = [];

function makeInteraction(withThread = true) {
  return {
    user: { id: ORIGINAL_USER },
    channel: withThread
      ? {
          send: vi.fn(async (payload: { content?: string; components?: unknown[] }) => {
            threadSends.push(payload);
            return { id: '1' };
          }),
          messages: { fetch: vi.fn(async () => new Map()) },
        }
      : null,
    reply: vi.fn(async (payload: { content?: string; ephemeral?: boolean }) => {
      replies.push(payload);
    }),
  };
}

beforeEach(() => {
  replies.length = 0;
  threadSends.length = 0;
  codeCount = 10;
  seriesFailsToLoad = false;
});

describe('refuseIfSeriesLocked', () => {
  it('refuses at the cap', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await refuseIfSeriesLocked(makeInteraction() as any, 'report_result', 756)).toBe(true);
  });

  it('lets everything through one code short of it', async () => {
    codeCount = 9;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await refuseIfSeriesLocked(makeInteraction() as any, 'report_result', 756)).toBe(false);
  });

  it('stops the flows a per-handler guard would have missed', async () => {
    // The point of sitting in the router: this list is every series button, and
    // it does not have to be maintained anywhere.
    for (const tag of [
      'generate_another',
      'generate_another_confirm',
      'regenerate_confirm',
      'switch_sides',
      'report_result',
      'report_custom',
      'report_team1_won',
      'report_team2_won',
      'code_not_working',
      'play_custom',
      'play_custom_confirm',
    ]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(await refuseIfSeriesLocked(makeInteraction() as any, tag, 756)).toBe(true);
    }
  });

  it('leaves Cancel alone, so an ephemeral prompt can still be dismissed', async () => {
    // Blocking the way out of a prompt is not stopping a flow, it is stranding
    // one on screen.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await refuseIfSeriesLocked(makeInteraction() as any, 'cancel_flow', 756)).toBe(false);
  });

  it('ignores the selection flow, which has no series yet', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await refuseIfSeriesLocked(makeInteraction() as any, 'confirm', 0)).toBe(false);
  });

  it('tells the captain who pressed, privately', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await refuseIfSeriesLocked(makeInteraction() as any, 'report_result', 756);

    expect(replies).toHaveLength(1);
    expect(replies[0].ephemeral).toBe(true);
    expect(replies[0].content).toContain('locked');
  });

  it('pings the dev team publicly, where a mention actually notifies', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await refuseIfSeriesLocked(makeInteraction() as any, 'report_result', 756);

    expect(threadSends).toHaveLength(1);
    expect(threadSends[0].content).toContain(`<@&${config.DEV_TEAM_ROLE_ID}>`);
    expect(threadSends[0].content).toContain('756');
  });

  it('still refuses when there is no thread to post the ping in', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await refuseIfSeriesLocked(makeInteraction(false) as any, 'report_result', 756)).toBe(
      true,
    );
    expect(replies).toHaveLength(1);
  });

  it('lets the press through when the series cannot be read', async () => {
    // Failing closed here would take every button in every thread down the
    // moment dennys blipped. The cap is for a runaway, not for an outage.
    seriesFailsToLoad = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await refuseIfSeriesLocked(makeInteraction() as any, 'report_result', 756)).toBe(false);
    expect(replies).toHaveLength(0);
  });

  it('locks only the series that ran away', async () => {
    // Scoped by the id on the button, so one bad thread cannot take the league
    // down with it.
    codeCount = 2;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await refuseIfSeriesLocked(makeInteraction() as any, 'report_result', 999)).toBe(false);
    expect(threadSends).toHaveLength(0);
  });
});
