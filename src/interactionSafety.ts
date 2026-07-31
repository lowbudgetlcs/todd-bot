import { BaseInteraction, MessageFlags } from 'discord.js';
import log from 'loglevel';

const logger = log.getLogger('interactionSafety');
logger.setLevel('info');

/** Discord: the interaction token is gone (usually because we took >3s to ack). */
const UNKNOWN_INTERACTION = 10062;
/** Discord: this interaction was already acknowledged, i.e. we acked it twice. */
const ALREADY_ACKNOWLEDGED = 40060;

function errorCode(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: number }).code
    : undefined;
}

/**
 * The token is dead and nothing can be delivered to the user. Callers may give
 * up quietly, because there is no longer anyone to give up in front of.
 */
export function isExpiredInteraction(error: unknown): boolean {
  return errorCode(error) === UNKNOWN_INTERACTION;
}

/**
 * We acknowledged the same interaction twice.
 *
 * This used to be lumped in with `isExpiredInteraction`, which was wrong in a
 * way that hid bugs: 40060 means the token is *alive* and two code paths are
 * both answering it. Treating it as "expired" made `runGuarded` log at warn and
 * return, so a genuine double-reply looked identical to a user who wandered off.
 * It is our bug, not Discord's, so it is reported like any other failure.
 */
export function isAlreadyAcknowledged(error: unknown): boolean {
  return errorCode(error) === ALREADY_ACKNOWLEDGED;
}

/**
 * Acknowledges an interaction before slow work so Discord's 3 second deadline
 * can't expire the token while we wait on dennys. Deferring buys ~15 minutes.
 *
 * Returns false if the interaction was already dead, so callers can skip the
 * work entirely rather than doing it and failing to report the result.
 */
export async function safeDefer(
  interaction: BaseInteraction,
  opts: { update?: boolean; ephemeral?: boolean } = {},
): Promise<boolean> {
  if (!interaction.isRepliable()) return false;
  if (interaction.replied || interaction.deferred) return true;
  try {
    if (opts.update && interaction.isMessageComponent()) {
      await interaction.deferUpdate();
    } else {
      await interaction.deferReply(
        opts.ephemeral ? { flags: MessageFlags.Ephemeral } : {},
      );
    }
    return true;
  } catch (error) {
    if (isAlreadyAcknowledged(error)) {
      // This function's postcondition is "the interaction is acknowledged", and
      // 40060 says it already is - so the caller can safely carry on, and
      // returning false here would abandon a live interaction. Still worth an
      // error: the replied/deferred check above should have caught this, so two
      // paths are racing on the same interaction.
      logger.error('Interaction was already acknowledged when deferring:', error);
      return true;
    }
    if (isExpiredInteraction(error)) {
      logger.warn('Interaction expired before it could be deferred, dropping it');
      return false;
    }
    logger.error('Failed to defer interaction:', error);
    return false;
  }
}

/**
 * Reports an error back to the user on whichever channel is still valid,
 * swallowing any failure. Previously the error path itself called followUp()
 * on a dead token, which threw again and took the process down.
 */
export async function safeInteractionError(
  interaction: BaseInteraction,
  content: string,
): Promise<void> {
  if (!interaction.isRepliable()) return;
  try {
    if (interaction.deferred) {
      await interaction.editReply({ content, components: [] });
    } else if (interaction.replied) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    // Nothing left to do - the user's interaction is gone. Just don't crash.
    logger.warn(`Could not deliver error message to user: ${String(error)}`);
  }
}

/** Wraps a handler so a rejection is logged and reported, never unhandled. */
export async function runGuarded(
  interaction: BaseInteraction,
  label: string,
  fn: () => Promise<void>,
  userMessage = 'Something went wrong handling that. Please try again.',
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (isExpiredInteraction(error)) {
      logger.warn(`${label}: interaction expired before we could respond`);
      return;
    }
    // 40060 deliberately falls through to here rather than being treated as
    // expired: the user is still waiting, and a double ack is a bug we want in
    // the logs at error level instead of silently absorbed.
    logger.error(`${label} failed:`, error);
    await safeInteractionError(interaction, userMessage);
  }
}
