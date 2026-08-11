import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SeriesData } from '../src/types/toddData.ts';
import { createButtonData, parseButtonData } from '../src/buttons/button.ts';
import { buildRecoveryRow } from '../src/seriesControl.ts';
import { getButtonHandler } from '../src/buttons/handlers.ts';
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

type FakeMessage = {
  id: string;
  content: string;
  components: { components?: { customId?: string | null }[] }[];
  delete: ReturnType<typeof vi.fn>;
  edit: ReturnType<typeof vi.fn>;
};

/** What the thread already holds. Set per test; cleared in beforeEach. */
let threadMessages: FakeMessage[] = [];

function makeInteraction(
  tag: string,
  userId = ORIGINAL_USER,
  { ephemeralOrigin = true }: { ephemeralOrigin?: boolean } = {},
) {
  const interaction = {
    customId: createButtonData(tag, ORIGINAL_USER, seriesData).serialize(),
    user: { id: userId },
    replied: false,
    deferred: false,
    isRepliable: () => true,
    isMessageComponent: () => true,
    // The button's own message - ephemeral for the "Code not working?" wizard,
    // public for the recovery row posted when a code fails outright.
    message: { flags: { has: (_flag: number) => ephemeralOrigin } },
    channel: {
      send: vi.fn(async (payload: { content?: string; components?: unknown[] }) => {
        threadSends.push(payload);
        return { id: '1' };
      }),
      // The custom flow reads the thread twice: for the game number it is
      // standing in for, and to retire that game's dead code button.
      messages: { fetch: vi.fn(async () => new Map(threadMessages.map(m => [m.id, m]))) },
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

/** A code message carrying the report button for one game, as the thread has it. */
const aGameMessage = (id: string, gameNumber: number, tournamentCodeId: number): FakeMessage => ({
  id,
  content: `# Game ${gameNumber} \nCode: \`\`\`CODE${tournamentCodeId}\`\`\``,
  components: [
    {
      components: [
        {
          customId: createButtonData(
            'report_result',
            ORIGINAL_USER,
            seriesData,
            `${tournamentCodeId}-${gameNumber}`,
          ).serialize(),
        },
      ],
    },
  ],
  delete: vi.fn(async () => {}),
  edit: vi.fn(async () => {}),
});

beforeEach(() => {
  editReplyPayloads.length = 0;
  threadSends.length = 0;
  threadMessages = [];
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

  it('points at the custom game as the way out', async () => {
    const interaction = makeInteraction('code_not_working');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleCodeNotWorking(interaction as any);

    expect(editReplyPayloads.at(-1)!.content).toBe(
      'You may either regenerate a new code to use OR play a custom.\n' +
        'If regenerating a code fails for any reason, please use a custom game.',
    );
  });

  it('replaces the code through the ordinary issue path, so the number holds', async () => {
    // A code nobody played produces no game, so reissuing does not advance the
    // number. That makes a replacement the same operation as the next game -
    // hence the same handler, reached under its own tag.
    const interaction = makeInteraction('code_not_working');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleCodeNotWorking(interaction as any);

    expect(tagsOf(editReplyPayloads.at(-1)!)[0]).toBe('regenerate_confirm');
    expect(getButtonHandler('regenerate_confirm')).toBe(
      getButtonHandler('generate_another_confirm'),
    );
  });

  it('marks the replacement apart from Generate Next Game', async () => {
    // The two produce a code for the same game number, but only this one means
    // "the code I have is dead" - the difference decides whether the existing
    // code message is removed, so it has to survive onto the wire.
    const interaction = makeInteraction('code_not_working');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleCodeNotWorking(interaction as any);

    expect(tagsOf(editReplyPayloads.at(-1)!)[0]).not.toBe('generate_another_confirm');
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

  it('edits the "Code not working?" menu in place rather than leaving it behind', async () => {
    // Previously this deferred a brand new ephemeral reply, so the prior step
    // stayed on screen forever with dead buttons once the flow moved on.
    const interaction = makeInteraction('play_custom', ORIGINAL_USER, { ephemeralOrigin: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePlayCustom(interaction as any);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  it('opens a fresh ephemeral reply when reached from the public recovery row instead', async () => {
    // Editing a public message in place would fold a private confirmation
    // into a message the other captain relies on, and would put "Cancel" a
    // click away from deleting it outright.
    const interaction = makeInteraction('play_custom', ORIGINAL_USER, { ephemeralOrigin: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePlayCustom(interaction as any);

    expect(interaction.deferReply).toHaveBeenCalled();
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
  });

  it('posts the way back into reporting once confirmed', async () => {
    const interaction = makeInteraction('play_custom_confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePlayCustomConfirm(interaction as any);

    expect(threadSends).toHaveLength(1);
    expect(labelsOf(threadSends[0])).toEqual(['We finished the custom game']);
    // Reuses the report flow rather than growing a second one, but under its
    // own tag: a custom leaves no record in dennys, so the check that stops a
    // duplicate report has nothing to find and must not run here.
    expect(tagsOf(threadSends[0])).toEqual(['report_custom']);
  });

  it('names the game the custom is standing in for', async () => {
    threadMessages = [aGameMessage('1', 3, 1003)];
    const interaction = makeInteraction('play_custom_confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePlayCustomConfirm(interaction as any);

    expect(threadSends[0].content).toContain('Game 3');
    // No code on the target: a custom never reaches Riot, so there is none.
    const [button] = buttonsOf((threadSends[0].components ?? [])[0]);
    expect(parseButtonData(button.custom_id).tagArg).toBe('0-3');
  });

  it('sends the screenshot to the post-game form rather than the thread', async () => {
    const interaction = makeInteraction('play_custom_confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePlayCustomConfirm(interaction as any);

    expect(threadSends[0].content).toContain('post-game form');
    expect(threadSends[0].content).toContain('not in this thread');
  });

  it('retires the dead code button as soon as the custom is committed', async () => {
    // Choosing the custom *is* the captain saying that code will not be played.
    // Leaving its Report button up offered a second report of the same game -
    // and dennys can never close that gap, because a custom records no code.
    const deadCode = aGameMessage('1', 3, 1003);
    threadMessages = [deadCode];
    const interaction = makeInteraction('play_custom_confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePlayCustomConfirm(interaction as any);

    expect(deadCode.edit).toHaveBeenCalledWith({ components: [] });
  });

  it('leaves an earlier game that is still unreported alone', async () => {
    const earlier = aGameMessage('1', 2, 1002);
    threadMessages = [earlier, aGameMessage('2', 3, 1003)];
    const interaction = makeInteraction('play_custom_confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePlayCustomConfirm(interaction as any);

    expect(earlier.edit).not.toHaveBeenCalled();
  });

  it('still posts the button when the thread has no code messages to read', async () => {
    // A series where Riot never issued a code at all. Game 1 by definition.
    const interaction = makeInteraction('play_custom_confirm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePlayCustomConfirm(interaction as any);

    expect(threadSends[0].content).toContain('Game 1');
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
