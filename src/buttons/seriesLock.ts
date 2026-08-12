import { ButtonInteraction } from 'discord.js';
import { getSeries, isSeriesLocked, SERIES_CODE_HARD_CAP } from '../dennys.ts';
import { announceSeriesLocked, shareThreadScan } from '../seriesControl.ts';
import type { ControlThread } from '../seriesControl.ts';
import { config } from '../config.ts';
import log from 'loglevel';

const logger = log.getLogger('seriesLock');
logger.setLevel('info');

/**
 * Tags that carry no pinned series, so there is nothing to look up.
 *
 * The selection flow runs before a series is resolved - its buttons carry
 * seriesId 0 - and cancel_flow only deletes an ephemeral prompt. Blocking that
 * one would strand the prompt on screen with no way to dismiss it, which is the
 * opposite of stopping the flow.
 */
const UNPINNED_TAGS = new Set([
  'division_select',
  'team1_select',
  'team2_select',
  'stage_select',
  'series_select',
  'switch',
  'cancel',
  'cancel_flow',
]);

/** The ping, or a plain phrase when no role id is configured. */
const devTeamMention = () =>
  config.DEV_TEAM_ROLE_ID ? `<@&${config.DEV_TEAM_ROLE_ID}>` : '**Dev team**';

/**
 * Stops every button in a series that has run away with tournament codes.
 *
 * Sits in the router rather than in each handler: "stop all flows" has to hold
 * for flows nobody thinks about at the time, and a guard per handler is a list
 * that goes stale the first time one is added. See docs/ARCHITECTURE.md.
 *
 * Scoped to the one series the button names, so a runaway thread cannot take
 * anyone else's game down with it.
 *
 * A series that cannot be read is allowed through. The cap exists to catch a
 * loop, not to fail closed on a dennys blip - and failing closed here would
 * take every button in every thread down whenever dennys was unreachable.
 */
export async function refuseIfSeriesLocked(
  interaction: ButtonInteraction,
  tag: string,
  seriesId: number,
): Promise<boolean> {
  if (UNPINNED_TAGS.has(tag) || !seriesId) return false;

  let series;
  try {
    series = await getSeries(seriesId);
  } catch (error) {
    logger.warn(`Could not check the code cap for series ${seriesId}: ${String(error)}`);
    return false;
  }
  if (!isSeriesLocked(series)) return false;

  logger.error(
    `Series ${seriesId} is locked: ${series.tournamentCodes.length} tournament codes issued ` +
      `(cap ${SERIES_CODE_HARD_CAP}). Refusing "${tag}" from ${interaction.user.id}`,
  );

  // Ephemeral, and said to whoever pressed. The public message below is posted
  // once; this is what every press after it gets.
  await interaction.reply({
    content:
      'This series is locked — it has been issued too many tournament codes. ' +
      'A dev has been notified, and nothing in this thread will work until they look at it.',
    ephemeral: true,
  });

  const thread = interaction.channel;
  if (thread && 'send' in thread) {
    await announceSeriesLocked(
      shareThreadScan(thread as unknown as ControlThread),
      seriesId,
      series.tournamentCodes.length,
      devTeamMention(),
    );
  }

  return true;
}
