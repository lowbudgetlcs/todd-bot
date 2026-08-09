import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createButton, createButtonData } from './buttons/button.ts';
import { SeriesData } from './types/toddData.ts';
import { SeriesWithGames } from './dennys.ts';
import log from 'loglevel';

const logger = log.getLogger('seriesControl');
logger.setLevel('info');

/**
 * First line of the control message, and the only way it is recognised.
 *
 * Matching on "has components" instead would also match the draft-links message
 * in threads created before the control message existed, which carried the
 * Generate Next Game row. Nothing else Todd posts may start with this.
 */
export const CONTROL_MARKER = '## 📋 Series status';

/** Discord: the message is already gone, which the delete race below produces. */
const UNKNOWN_MESSAGE = 10008;

/** Threads are short; the control message is always among the most recent. */
const SCAN_LIMIT = 50;

/**
 * How long a code may go unplayed before Todd stops assuming Riot is simply
 * behind. Dennys pulls a played game from Riot whenever a code is issued, so
 * anything sooner than this is very likely to arrive on its own.
 */
export const STALE_CODE_MS = 10 * 60 * 1000;

type ControlMessage = {
  id: string;
  content: string;
  components: readonly unknown[];
  delete(): Promise<unknown>;
};

type ControlThread = {
  send(payload: {
    content: string;
    components: ActionRowBuilder<ButtonBuilder>[];
  }): Promise<{ id: string }>;
  messages: { fetch(options: { limit: number }): Promise<Map<string, ControlMessage>> };
};

const isControlMessage = (message: ControlMessage) =>
  message.content.startsWith(CONTROL_MARKER) && message.components.length > 0;

const winsFor = (series: SeriesWithGames, teamId: number) =>
  series.games.filter(game => game.result?.winningTeamId === teamId).length;

/** A code issued with no matching game yet - the only thing "Code not working?" can apply to. */
const hasOutstandingCode = (series: SeriesWithGames) =>
  series.tournamentCodes.length > series.games.length;

/**
 * True when the newest code has been outstanding long enough that waiting is no
 * longer the better option. Codes issued and games played differing is the
 * normal state between issuing a code and its result landing, so the elapsed
 * time is the signal rather than the counts.
 */
export function isCodeStale(series: SeriesWithGames, now: number): boolean {
  if (!series.lastCodeIssuedAt) return false;
  const issued = Date.parse(series.lastCodeIssuedAt);
  if (Number.isNaN(issued)) return false;
  const played = series.lastGameAt ? Date.parse(series.lastGameAt) : 0;
  if (played >= issued) return false;
  return now - issued > STALE_CODE_MS;
}

export function buildSeriesStatus(
  series: SeriesWithGames,
  teams: { id: number; name: string }[],
  now: number = Date.now(),
): string {
  const score = teams.map(team => `**${team.name}** ${winsFor(series, team.id)}`).join(' – ');
  const lines = [`${score}  ·  Best of ${series.totalGames}`];

  if (series.completed) {
    lines.push('This series is complete.');
  }

  // One outstanding code is just the game in progress. More than one means codes
  // were issued that nobody played - a replaced dead code, or both captains
  // pressing at once. Only the code that was actually used needs a result.
  const outstanding = series.tournamentCodes.length - series.games.length;
  if (outstanding > 1) {
    lines.push(`${outstanding} codes are outstanding — only the one you played needs reporting.`);
  }

  if (isCodeStale(series, now)) {
    lines.push('The last code has no result yet.');
  }

  return lines.join('\n');
}

/**
 * Report only appears once the newest code has gone unanswered long enough.
 *
 * Filing one earlier is not merely redundant, it is harmful: Dennys finds no
 * game on the code yet, records the claim against no code at all, and inserts a
 * second row for the same match once Riot catches up. A lost callback repairs
 * itself when the next code is issued, so waiting is the better default.
 */
export function buildControlRow(
  originalUserId: string,
  seriesData: SeriesData,
  series?: SeriesWithGames,
  now: number = Date.now(),
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    createButton(
      createButtonData('generate_another', originalUserId, seriesData),
      'Generate Next Game',
      ButtonStyle.Success,
      '⚔️',
    ),
  );

  // Not gated on completion. Dennys does not block a completed series from
  // taking codes or results either, and a captain who needs to correct one
  // should not be locked out because Dennys closed it early.
  if (series && isCodeStale(series, now)) {
    row.addComponents(
      createButton(
        createButtonData('report_result', originalUserId, seriesData),
        'Report result',
        ButtonStyle.Secondary,
        '📝',
      ),
    );
  }

  // Not gated on staleness like Report result is - staleness exists to give
  // Riot's callback time to land, but a dead code can be known immediately
  // (League client says "invalid code"), so this shouldn't wait on it. Gated
  // on there being an outstanding code at all: once every issued code already
  // has a matching reported game, there's nothing left for this to recover.
  if (series && hasOutstandingCode(series)) {
    row.addComponents(
      createButton(
        createButtonData('code_not_working', originalUserId, seriesData),
        'Code not working?',
        ButtonStyle.Secondary,
        '❓',
      ),
    );
  }

  return row;
}

/**
 * Shown when Riot would not issue a code at all, so there is no code message to
 * hang the usual controls on. The series still gets a thread: a series played
 * entirely on customs has to live somewhere.
 */
export function buildRecoveryRow(
  originalUserId: string,
  seriesData: SeriesData,
  retryable: boolean,
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (retryable) {
    row.addComponents(
      createButton(
        createButtonData('generate_another_confirm', originalUserId, seriesData),
        'Try again',
        ButtonStyle.Primary,
        '🔄',
      ),
    );
  }
  row.addComponents(
    createButton(
      createButtonData('play_custom', originalUserId, seriesData),
      'Go play a custom game',
      ButtonStyle.Secondary,
      '⚠️',
    ),
  );
  return row;
}

/**
 * Puts the control message at the bottom of the thread.
 *
 * The replacement is posted before the old ones are removed. Deleting first
 * would leave the thread with no working buttons whenever the post then failed,
 * and a captain with no way to continue; two control messages for a moment is
 * recoverable, none is not.
 *
 * Cleanup is best-effort for the same reason. Since the rule is "delete every
 * control message except the newest", a skipped delete is corrected on the next
 * post rather than accumulating.
 */
export async function postSeriesControl(
  thread: ControlThread,
  content: string,
  components: ActionRowBuilder<ButtonBuilder>[],
): Promise<void> {
  const posted = await thread.send({ content: `${CONTROL_MARKER}\n${content}`, components });

  try {
    const recent = await thread.messages.fetch({ limit: SCAN_LIMIT });
    for (const message of recent.values()) {
      if (message.id === posted.id || !isControlMessage(message)) continue;
      try {
        await message.delete();
      } catch (error) {
        const code = (error as { code?: number })?.code;
        if (code !== UNKNOWN_MESSAGE) {
          logger.warn(`Could not remove a previous series control message: ${String(error)}`);
        }
      }
    }
  } catch (error) {
    logger.warn(`Could not scan the thread for previous control messages: ${String(error)}`);
  }
}
