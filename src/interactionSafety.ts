import { BaseInteraction, MessageFlags } from 'discord.js';
import log from 'loglevel';

const logger = log.getLogger('interactionSafety');
logger.setLevel('info');

/** Discord: the interaction token is gone (usually because we took >3s to ack). */
const UNKNOWN_INTERACTION = 10062;
/** Discord: we already acknowledged this one. */
const ALREADY_ACKNOWLEDGED = 40060;

function errorCode(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: number }).code
    : undefined;
}

export function isExpiredInteraction(error: unknown): boolean {
  const code = errorCode(error);
  return code === UNKNOWN_INTERACTION || code === ALREADY_ACKNOWLEDGED;
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
    logger.error(`${label} failed:`, error);
    await safeInteractionError(interaction, userMessage);
  }
}
