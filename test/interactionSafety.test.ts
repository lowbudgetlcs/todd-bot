import { describe, it, expect, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import {
  isExpiredInteraction,
  isAlreadyAcknowledged,
  safeDefer,
  safeInteractionError,
  runGuarded,
} from '../src/interactionSafety.ts';

function makeInteraction(overrides: Record<string, unknown> = {}): any {
  return {
    replied: false,
    deferred: false,
    _component: false,
    isRepliable: () => true,
    isMessageComponent() {
      return this._component;
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('isExpiredInteraction', () => {
  it('treats 10062 (unknown interaction) as expired', () => {
    expect(isExpiredInteraction({ code: 10062 })).toBe(true);
  });
  it('does NOT treat 40060 (already acknowledged) as expired', () => {
    // 40060 means the token is alive and we acked twice - our bug, not a dead
    // interaction. Conflating the two let real double-replies pass as "the user
    // is gone" and never surface.
    expect(isExpiredInteraction({ code: 40060 })).toBe(false);
  });
  it('does not treat other errors as expired', () => {
    expect(isExpiredInteraction({ code: 50035 })).toBe(false);
    expect(isExpiredInteraction(new Error('boom'))).toBe(false);
    expect(isExpiredInteraction(null)).toBe(false);
    expect(isExpiredInteraction('nope')).toBe(false);
  });
});

describe('isAlreadyAcknowledged', () => {
  it('matches 40060 only', () => {
    expect(isAlreadyAcknowledged({ code: 40060 })).toBe(true);
    expect(isAlreadyAcknowledged({ code: 10062 })).toBe(false);
    expect(isAlreadyAcknowledged(new Error('boom'))).toBe(false);
    expect(isAlreadyAcknowledged(null)).toBe(false);
  });
});

describe('safeDefer', () => {
  it('returns false and does nothing when the interaction is not repliable', async () => {
    const i = makeInteraction({ isRepliable: () => false });
    expect(await safeDefer(i)).toBe(false);
    expect(i.deferReply).not.toHaveBeenCalled();
  });

  it('returns true without re-deferring when already replied or deferred', async () => {
    const replied = makeInteraction({ replied: true });
    expect(await safeDefer(replied)).toBe(true);
    expect(replied.deferReply).not.toHaveBeenCalled();

    const deferred = makeInteraction({ deferred: true });
    expect(await safeDefer(deferred)).toBe(true);
    expect(deferred.deferReply).not.toHaveBeenCalled();
  });

  it('defers a command reply as ephemeral when asked', async () => {
    const i = makeInteraction();
    expect(await safeDefer(i, { ephemeral: true })).toBe(true);
    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  });

  it('defers a non-ephemeral reply with no flags by default', async () => {
    const i = makeInteraction();
    expect(await safeDefer(i)).toBe(true);
    expect(i.deferReply).toHaveBeenCalledWith({});
  });

  it('uses deferUpdate for a component interaction with { update: true }', async () => {
    const i = makeInteraction({ _component: true });
    expect(await safeDefer(i, { update: true })).toBe(true);
    expect(i.deferUpdate).toHaveBeenCalledTimes(1);
    expect(i.deferReply).not.toHaveBeenCalled();
  });

  it('returns false when the token already expired', async () => {
    const i = makeInteraction({
      deferReply: vi.fn().mockRejectedValue({ code: 10062 }),
    });
    expect(await safeDefer(i)).toBe(false);
  });

  it('returns true on 40060, because the interaction is acknowledged either way', async () => {
    // safeDefer promises "this is acked now". 40060 says it already is, so
    // returning false would make the caller abandon a live interaction and
    // leave the user with nothing.
    const i = makeInteraction({
      deferReply: vi.fn().mockRejectedValue({ code: 40060 }),
    });
    expect(await safeDefer(i)).toBe(true);
  });

  it('returns false on any other defer failure rather than throwing', async () => {
    const i = makeInteraction({
      deferReply: vi.fn().mockRejectedValue(new Error('network')),
    });
    await expect(safeDefer(i)).resolves.toBe(false);
  });
});

describe('safeInteractionError picks the still-valid channel', () => {
  it('edits the reply when the interaction was deferred', async () => {
    const i = makeInteraction({ deferred: true });
    await safeInteractionError(i, 'oops');
    expect(i.editReply).toHaveBeenCalledWith({ content: 'oops', components: [] });
  });

  it('follows up when the interaction was already replied', async () => {
    const i = makeInteraction({ replied: true });
    await safeInteractionError(i, 'oops');
    expect(i.followUp).toHaveBeenCalledWith({ content: 'oops', flags: MessageFlags.Ephemeral });
  });

  it('replies fresh when nothing was sent yet', async () => {
    const i = makeInteraction();
    await safeInteractionError(i, 'oops');
    expect(i.reply).toHaveBeenCalledWith({ content: 'oops', flags: MessageFlags.Ephemeral });
  });

  it('swallows a delivery failure instead of throwing again', async () => {
    const i = makeInteraction({
      deferred: true,
      editReply: vi.fn().mockRejectedValue({ code: 10062 }),
    });
    await expect(safeInteractionError(i, 'oops')).resolves.toBeUndefined();
  });
});

describe('runGuarded', () => {
  it('runs the handler and reports nothing when it succeeds', async () => {
    const i = makeInteraction();
    await runGuarded(i, 'label', async () => {});
    expect(i.reply).not.toHaveBeenCalled();
  });

  it('reports a friendly message when the handler throws a real error', async () => {
    const i = makeInteraction();
    await runGuarded(i, 'label', async () => {
      throw new Error('kaboom');
    });
    expect(i.reply).toHaveBeenCalledWith({
      content: 'Something went wrong handling that. Please try again.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('stays quiet when the failure is just an expired interaction', async () => {
    const i = makeInteraction();
    await runGuarded(i, 'label', async () => {
      throw { code: 10062 };
    });
    expect(i.reply).not.toHaveBeenCalled();
    expect(i.editReply).not.toHaveBeenCalled();
    expect(i.followUp).not.toHaveBeenCalled();
  });

  it('does NOT stay quiet on 40060 - a double ack is a real bug', async () => {
    // The user is still there and still waiting, so they get told something
    // went wrong, and the error reaches the logs instead of being absorbed.
    const i = makeInteraction({ replied: true });
    await runGuarded(i, 'label', async () => {
      throw { code: 40060 };
    });
    expect(i.followUp).toHaveBeenCalledWith({
      content: 'Something went wrong handling that. Please try again.',
      flags: MessageFlags.Ephemeral,
    });
  });
});
