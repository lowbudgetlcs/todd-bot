import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SeriesData } from '../src/types/toddData.ts';
import { createButtonData, parseButtonData } from '../src/buttons/button.ts';
import { buildRecoveryRow } from '../src/seriesControl.ts';
import {
  handleCodeNotWorking,
  handlePlayCustom,
  handlePlayCustomConfirm,
} from '../src/buttons/handlers/recovery.ts';

/**
 * A dead code and a code that never generated are different failures with the
 * same consequence: the captains cannot play. Both have to reach the custom
 * game, and the custom has to lead back into result reporting.
 */

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

const editReplyPayloads: { content?: string; components?: unknown[] }[] = [];
const threadSends: { content?: string; components?: unknown[] }[] = [];

function makeInteraction(tag: string, userId = ORIGINAL_USER) {
  const interaction = {
    customId: createButtonData(tag, ORIGINAL_USER, seriesData).serialize(),
    user: { id: userId },
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
    deferReply: vi.fn(async () => {
      interaction.deferred = true;
    }),
    editReply: vi.fn(async (payload: { content?: string; components?: unknown[] }) => {
      editReplyPayloads.push(payload);
    }),
    reply: vi.fn(async (payload: { content?: string; components?: unknown[] }) => {
      editReplyPayloads.push(payload);
      interaction.replied = true;
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
  editReplyPayloads.length = 0;
  threadSends.length = 0;
});

describe('a code that will not generate', () => {
  it('offers a retry only when pressing again could work', () => {
    // 503 is Riot unreachable and worth another press; 502 is a hard refusal.
    expect(labelsOf({ components: [buildRecoveryRow(ORIGINAL_USER, seriesData, true)] })).toEqual([
      'Try again',
      'Go play a custom game',
    ]);
    expect(labelsOf({ components: [buildRecoveryRow(ORIGINAL_USER, seriesData, false)] })).toEqual([
      'Go play a custom game',
    ]);
  });

  it('always reaches the custom path, retryable or not', () => {
    for (const retryable of [true, false]) {
      const tags = tagsOf({ components: [buildRecoveryRow(ORIGINAL_USER, seriesData, retryable)] });
      expect(tags).toContain('play_custom');
    }
  });
});

describe('a code that generated but does not work', () => {
  it('offers a replacement and the custom path', async () => {
    const interaction = makeInteraction('code_not_working');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleCodeNotWorking(interaction as any);

    expect(labelsOf(editReplyPayloads.at(-1)!)).toEqual([
      'Generate a new one',
      'Go play a custom game',
      'Cancel',
    ]);
  });

  it('replaces the code through the ordinary issue path, so the number holds', async () => {
    // A code nobody played produces no game, so reissuing does not advance the
    // number. That makes a replacement the same operation as the next game.
    const interaction = makeInteraction('code_not_working');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleCodeNotWorking(interaction as any);

    expect(tagsOf(editReplyPayloads.at(-1)!)[0]).toBe('generate_another_confirm');
  });

  it('carries the pinned series onto every option', async () => {
    const interaction = makeInteraction('code_not_working');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleCodeNotWorking(interaction as any);

    const ids = buttonsOf(editReplyPayloads.at(-1)!.components![0]).map(
      b => parseButtonData(b.custom_id).seriesData.seriesId,
    );
    expect(ids).toEqual([756, 756, 756]);
  });

  it('refuses anyone but the two captains', async () => {
    const interaction = makeInteraction('code_not_working', '999999999999999999');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleCodeNotWorking(interaction as any);

    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(editReplyPayloads.at(-1)!.content).toContain('Only the two captains');
  });
});

describe('committing to a custom game', () => {
  it('warns about stats and the screenshot before committing', async () => {
    const interaction = makeInteraction('play_custom');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePlayCustom(interaction as any);

    const content = editReplyPayloads.at(-1)!.content!;
    expect(content).toContain('no stats');
    expect(content).toContain('screenshot');
  });

  it('makes it cancellable', async () => {
    const interaction = makeInteraction('play_custom');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePlayCustom(interaction as any);

    expect(tagsOf(editReplyPayloads.at(-1)!)).toEqual(['play_custom_confirm', 'cancel_flow']);
  });

  it('posts the way back into reporting once confirmed', async () => {
    const interaction = makeInteraction('play_custom_confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePlayCustomConfirm(interaction as any);

    expect(threadSends).toHaveLength(1);
    expect(labelsOf(threadSends[0])).toEqual(['We finished the custom game']);
    // Reuses the report flow rather than growing a second one.
    expect(tagsOf(threadSends[0])).toEqual(['report_result']);
  });

  it('leaves that button in the thread rather than on a control message', async () => {
    // The custom is played over the next half hour, and the button has to
    // survive however many codes get issued meanwhile.
    const interaction = makeInteraction('play_custom_confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePlayCustomConfirm(interaction as any);

    expect(threadSends[0].content).not.toContain('Series status');
  });

  it('refuses anyone but the two captains', async () => {
    const interaction = makeInteraction('play_custom_confirm', '999999999999999999');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePlayCustomConfirm(interaction as any);

    expect(threadSends).toHaveLength(0);
  });
});
