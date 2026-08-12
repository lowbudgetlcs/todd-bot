import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createButton, createButtonData, parseButtonData } from './buttons/button.ts';
import { SeriesData } from './types/toddData.ts';
import {
  isSeriesLocked,
  remainingCodeAllowance,
  SeriesWithGames,
  TOURNAMENT_CODE_LIMIT,
} from './dennys.ts';
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

/**
 * First character of every message whose buttons only apply to the game
 * currently in progress: the recovery row posted when Riot refuses a code, and
 * the custom game's "We finished" button.
 *
 * Matched together with "has components", like CONTROL_MARKER, so the only
 * messages this can catch are the two that mint recovery buttons - the code,
 * draft-link and result-credit messages carry none.
 */
export const RECOVERY_MARKER = '⚠️';

/**
 * First character of the message that says a custom is being played.
 *
 * Deliberately not RECOVERY_MARKER, even though this message is posted by the
 * same flow. The buttons on a ⚠️ message are answered by the next result to
 * land; this one is answered only by the custom itself being reported, and it
 * has to outlive however many coded games are recorded meanwhile. Sweeping them
 * together retired the one button that still had a job.
 */
export const CUSTOM_MARKER = '🎮';

/**
 * First line of the post-game form message, and the only thing stopping a
 * second one. Nothing else Todd posts may start with it.
 */
export const FINISHED_MARKER = '# The series is finished!';

/** First line of the lock message, and what stops it being posted twice. */
export const LOCKED_MARKER = '# 🛑 This series is locked';

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
  components: readonly { components?: readonly { customId?: string | null }[] }[];
  delete(): Promise<unknown>;
  edit(payload: { components: ActionRowBuilder<ButtonBuilder>[] }): Promise<unknown>;
};

export type ControlThread = {
  send(payload: {
    content: string;
    components: ActionRowBuilder<ButtonBuilder>[];
  }): Promise<{ id: string }>;
  messages: { fetch(options: { limit: number }): Promise<Map<string, ControlMessage>> };
};

/**
 * One fetch of the thread, shared by every sweep that follows it.
 *
 * The sweeps are deliberately separate - each answers one question, and they are
 * combined differently by each caller - but they all begin by asking Discord for
 * the same fifty messages. Reporting a custom ran five of them back to back, so
 * a captain waited on five sequential round trips to learn their result was in.
 * They are also strictly ordered (retire before listing what is left), so they
 * cannot simply be fired in parallel.
 *
 * Reads are shared; writes are not. An edit still goes to Discord - it has to,
 * that is the point of the sweep - but it updates this view of the message as it
 * goes, so a later sweep sees the button its predecessor retired rather than the
 * one Discord had when the fetch happened. That is what makes sharing safe here:
 * every sweep in a chain writes the same thing, `components: []`.
 *
 * Scoped to one interaction, so nothing outlives the handler that made it. A
 * cache with a lifetime would have to worry about Riot recording a game in the
 * meantime; this cannot, because it is gone by then.
 */
export function shareThreadScan(thread: ControlThread): ControlThread {
  let pending: Promise<Map<string, ControlMessage>> | undefined;

  const share = (message: ControlMessage, all: Map<string, ControlMessage>): ControlMessage => {
    let components = message.components;
    return {
      id: message.id,
      get content() {
        return message.content;
      },
      get components() {
        return components;
      },
      delete: async () => {
        const result = await message.delete();
        all.delete(message.id);
        return result;
      },
      edit: async payload => {
        // Nothing to say. Two sweeps matching the same message - which is the
        // normal case for a custom, retired once by game number and once by
        // recorded code - otherwise spend a REST call each restating it.
        if (components.length === 0 && payload.components.length === 0) return message;
        const result = await message.edit(payload);
        // Every sweep clears; a payload that added buttons back would have to be
        // translated into the read shape, and none exists to translate.
        components = [];
        return result;
      },
    };
  };

  return {
    send: payload => thread.send(payload),
    messages: {
      // A rejection is shared too, on purpose: if the thread cannot be read, the
      // remaining sweeps should give up on their own terms rather than each
      // retrying the call that just failed.
      fetch: options => {
        pending ??= thread.messages.fetch(options).then(messages => {
          const shared = new Map<string, ControlMessage>();
          for (const [id, message] of messages) shared.set(id, share(message, shared));
          return shared;
        });
        return pending;
      },
    },
  };
}

const isControlMessage = (message: ControlMessage) =>
  message.content.startsWith(CONTROL_MARKER) && message.components.length > 0;

const isRecoveryMessage = (message: ControlMessage) =>
  message.content.startsWith(RECOVERY_MARKER) && message.components.length > 0;

const winsFor = (series: SeriesWithGames, teamId: number) =>
  series.games.filter(game => game.result?.winningTeamId === teamId).length;

/**
 * True when there is a code currently in play - the only thing "Code not
 * working?" can apply to.
 *
 * Two ways for the newest code to be finished with, and it takes both to be
 * sure, because dennys records only one of them. Either a game names it, or a
 * game was recorded after it went out: a custom played instead of that code
 * lands codeless, so nothing ever names it, and only the ordering shows it has
 * been superseded.
 *
 * Counting codes against games answers neither. Codes are abandoned routinely -
 * Generate Next Game pressed twice, a regenerate, a custom played instead - and
 * none of them will ever be answered, so that count stays lopsided for the rest
 * of the series and anything built on it sticks on forever.
 */
const hasOutstandingCode = (series: SeriesWithGames) => {
  const newest = series.tournamentCodes.reduce<{ id: number } | null>(
    (latest, code) => (!latest || code.id > latest.id ? code : latest),
    null,
  );
  if (newest === null) return false;
  if (series.games.some(game => game.tournamentCodeId === newest.id)) return false;
  return !latestCodeHasResult(series);
};

/**
 * True when a result has already landed for the game the newest code was issued
 * for - Riot's callback got there first, and there is nothing left to report.
 *
 * Counting codes against games cannot answer this. A captain who regenerated
 * once sits at two codes and one game whether or not that game is the one they
 * are about to report, so the ordering of the two timestamps is the signal: a
 * game recorded after the newest code went out can only be that code's game.
 *
 * Says nothing about a custom, which is played outside Riot entirely and so
 * leaves no trace here until someone reports it. Callers reached from the
 * custom flow must not consult this.
 */
export function latestCodeHasResult(series: SeriesWithGames): boolean {
  if (!series.lastCodeIssuedAt) return false;
  const issued = Date.parse(series.lastCodeIssuedAt);
  if (Number.isNaN(issued)) return false;
  const played = series.lastGameAt ? Date.parse(series.lastGameAt) : 0;
  return played >= issued;
}

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
  if (latestCodeHasResult(series)) return false;
  return now - issued > STALE_CODE_MS;
}

export function buildSeriesStatus(
  series: SeriesWithGames,
  teams: { id: number; name: string }[],
  now: number = Date.now(),
  awaitingReport: readonly number[] = [],
): string {
  const score = teams.map(team => `**${team.name}** ${winsFor(series, team.id)}`).join(' – ');
  const lines = [`${score}  ·  Best of ${series.totalGames}`];

  // Nothing below this is true of a locked series - every line it adds names a
  // button that has just been taken away.
  if (isSeriesLocked(series)) {
    lines.push('**This series is locked.** A dev has been notified. Nothing here will work.');
    return lines.join('\n');
  }

  if (series.completed) {
    lines.push('This series is complete.');
  }

  // Named games, never a count. A number on its own ("1 game needs reporting")
  // is the same mistake the code count made: it tells a captain that something
  // is wrong without telling them which button fixes it, and with two games in
  // flight they cannot work it out. See gamesAwaitingReport for how the list is
  // arrived at - and for why the game in progress is not on it.
  if (awaitingReport.length > 0) {
    const named = awaitingReport.map(number => `**Game ${number}**`).join(', ');
    lines.push(
      awaitingReport.length === 1
        ? `${named} still needs a result — use the Verify Stats button on its code message above.`
        : `${named} still need results — use the Verify Stats buttons on their code messages above.`,
    );
  }

  // Deliberately says nothing about outstanding codes. Every code issued since
  // the last result is for the same game, so a count of them never meant "this
  // many reports are needed" - but it read that way, and a captain who
  // regenerated once saw "2 codes are outstanding" with a single game to
  // report. An outstanding code on its own is not news either: it is the
  // ordinary state of a game in progress, so announcing it would fire on every
  // game the moment its code was issued.
  //
  // Staleness is the one genuinely actionable signal left: a code old enough
  // that Riot should have reported it by now.
  if (isCodeStale(series, now)) {
    lines.push('The last code has no result yet.');
  }

  // Why Generate Next Game is greyed. A disabled button explains nothing on its
  // own, and this is the one line that turns it from broken into "not yet".
  if (hasOutstandingCode(series)) {
    lines.push(
      '**Report the game in progress to unlock the next one** — ' +
        'use the Verify Stats button on its code message above.',
    );
  }

  // Only at zero, which under one-game-at-a-time takes a regenerate to reach.
  // This is why "Code not working?" stops offering a new code.
  if (remainingCodeAllowance(series) === 0) {
    lines.push(
      `No more codes can be issued for this game — ${TOURNAMENT_CODE_LIMIT} have already gone out. ` +
        '**Report a result, or play a custom game.**',
    );
  }

  return lines.join('\n');
}

/**
 * Carries no Report button, deliberately.
 *
 * A button here can only ever mean "the game I think you mean", which is wrong
 * the moment two games are waiting at once, and it has no code to name - and a
 * result that names no code is the one shape dennys handles badly. It inserts a
 * new game every time rather than returning the one it already has, and if a
 * Riot pull lands during the same request it hands back whichever game that
 * pull found instead of the one being reported. Reporting lives on each game's
 * own code message now; see buildGameReportRow.
 */
export function buildControlRow(
  originalUserId: string,
  seriesData: SeriesData,
  series?: SeriesWithGames,
): ActionRowBuilder<ButtonBuilder> {
  // Locked series get no row at all - an empty row is what the callers check
  // for, and Discord rejects one with no components in it.
  if (series && isSeriesLocked(series)) return new ActionRowBuilder<ButtonBuilder>();

  // One game at a time. See docs/ARCHITECTURE.md - this is also what keeps the
  // code allowance countable.
  const inProgress = series ? hasOutstandingCode(series) : false;

  const generate = createButton(
    createButtonData('generate_another', originalUserId, seriesData),
    'Generate Next Game',
    ButtonStyle.Success,
    '⚔️',
  );
  if (inProgress) generate.setDisabled(true);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(generate);

  // Not gated on staleness - staleness exists to give Riot's callback time to
  // land, but a dead code can be known immediately (League client says "invalid
  // code"), so this shouldn't wait on it. Gated on there being an outstanding
  // code at all: once every issued code already has a matching reported game,
  // there's nothing left for this to recover.
  //
  // Not gated on completion either. Dennys does not block a completed series
  // from taking codes or results, and a captain who needs to correct one should
  // not be locked out because dennys closed it early.
  //
  // The same condition that greys the button above, so the row always carries
  // exactly one live button - never two, never none.
  if (inProgress) {
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
 * Which game a report button is for: the tournament code dennys should credit
 * the result to, and the game number the thread is showing for it.
 *
 * The code id is the half that matters to dennys. A result naming its code is
 * idempotent - dennys returns the game it already has instead of inserting a
 * second one - and is attributed to the right game even when another code is
 * outstanding. A result naming nothing gets neither.
 *
 * The game number is the half that matters to captains. Dennys numbers games in
 * the order results are written, so a series reported out of order numbers them
 * differently from the order they were played; the thread shows what was
 * played, and this is how the credit message stays consistent with the code
 * message above it.
 */
export const encodeReportTarget = (
  tournamentCodeId: number | null,
  gameNumber: number,
): string => `${tournamentCodeId ?? 0}-${gameNumber}`;

/**
 * A null code means a custom: played outside Riot, so there is no code to name
 * and dennys can never hold the result already. The game number is still known,
 * and is what ties the custom to the code message it was played instead of.
 */
export function decodeReportTarget(
  tagArg: string | undefined,
): { tournamentCodeId: number | null; gameNumber: number } | null {
  if (!tagArg) return null;
  const [code, game] = tagArg.split('-');
  const tournamentCodeId = Number(code);
  const gameNumber = Number(game);
  if (!Number.isInteger(tournamentCodeId) || !Number.isInteger(gameNumber)) return null;
  if (tournamentCodeId < 0 || gameNumber <= 0) return null;
  return { tournamentCodeId: tournamentCodeId === 0 ? null : tournamentCodeId, gameNumber };
}

/**
 * The report button that lives on a game's own code message.
 *
 * One button per game played, rather than one shared button at the bottom of
 * the thread. The shared one could only ever mean "the most recent game", which
 * is wrong the moment two games are waiting at once - and it had no way to name
 * the code, so every press recorded a new game instead of returning the one
 * dennys already had.
 */
export function buildGameReportRow(
  originalUserId: string,
  seriesData: SeriesData,
  tournamentCodeId: number,
  gameNumber: number,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    createButton(
      createButtonData(
        'report_result',
        originalUserId,
        seriesData,
        encodeReportTarget(tournamentCodeId, gameNumber),
      ),
      `Verify Game ${gameNumber} Stats`,
      ButtonStyle.Secondary,
      '📝',
    ),
  );
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
 * Shown when dennys refuses a code because this game has spent its allowance.
 * Both buttons clear it; no retry, because pressing again cannot.
 */
export function buildCodeLimitRow(
  originalUserId: string,
  seriesData: SeriesData,
  outstandingCodeId: number | null,
  gameNumber: number,
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (outstandingCodeId != null) {
    row.addComponents(
      createButton(
        createButtonData(
          'report_result',
          originalUserId,
          seriesData,
          encodeReportTarget(outstandingCodeId, gameNumber),
        ),
        `Verify Game ${gameNumber} Stats`,
        ButtonStyle.Primary,
        '📝',
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
  // A locked series builds a row with nothing in it, and Discord rejects an
  // empty row outright - which would take the status message down with it.
  const usable = components.filter(row => row.components.length > 0);
  const posted = await thread.send({
    content: `${CONTROL_MARKER}\n${content}`,
    components: usable,
  });

  await sweepThread(
    thread,
    'remove a previous series control message',
    message => message.id !== posted.id && isControlMessage(message),
    message => message.delete(),
  );
}

/**
 * Says the series is locked, and pings whoever can unlock it.
 *
 * Public rather than ephemeral for two reasons: a role mention in an ephemeral
 * message notifies nobody, and both captains need to know why their buttons
 * stopped working rather than only whoever pressed last.
 *
 * Posted once, guarded like the finish message - every press that follows is
 * refused ephemerally instead, so a captain hammering the button cannot turn
 * the lock into a wall of pings.
 */
export async function announceSeriesLocked(
  thread: ControlThread,
  seriesId: number,
  codesIssued: number,
  devTeamMention: string,
): Promise<void> {
  try {
    const recent = await thread.messages.fetch({ limit: SCAN_LIMIT });
    for (const message of recent.values()) {
      if (message.content.startsWith(LOCKED_MARKER)) return;
    }
  } catch (error) {
    logger.warn(`Could not check whether the series lock message is already up: ${String(error)}`);
  }

  await thread.send({
    content:
      `${LOCKED_MARKER}\n` +
      `${devTeamMention} — series **${seriesId}** has been issued **${codesIssued}** tournament ` +
      'codes, which should not happen. Todd has stopped every button in this thread.\n' +
      '-# Captains: nothing here will work until a dev looks at it. Do not start another series ' +
      'for this match.',
    components: [],
  });
}

/**
 * Points at the post-game form once dennys closes the series.
 *
 * Nothing Todd writes reaches the standings - the form is what records the
 * match - so this is the last thing the thread has to say and it must not be
 * missed. Posted before the control message so the controls stay at the bottom.
 *
 * Posted once, guarded by FINISHED_MARKER rather than by "did this click
 * complete the series": Riot's callback can close a series with nobody pressing
 * anything, so the completing click is not a thing Todd can rely on seeing. A
 * thread it cannot read is posted to anyway - a duplicate reminder costs a
 * scroll, and staying quiet costs the match result.
 */
export async function announceSeriesFinished(
  thread: ControlThread,
  formUrl: string,
): Promise<void> {
  try {
    const recent = await thread.messages.fetch({ limit: SCAN_LIMIT });
    for (const message of recent.values()) {
      if (message.content.startsWith(FINISHED_MARKER)) return;
    }
  } catch (error) {
    logger.warn(`Could not check whether the series finish message is already up: ${String(error)}`);
  }

  await thread.send({
    content:
      `${FINISHED_MARKER} Please report the match results in the form!\n` +
      '-# The match results will NOT be recorded if you do not fill out the sheet! ' +
      'The winning captain needs to fill out the sheet\n\n' +
      formUrl,
    components: [],
  });
}

/**
 * The highest game number Todd has already stamped on a code message here.
 *
 * Dennys cannot answer this. A tournament code carries no game number, and a
 * game only exists once a result is written, so "two codes for two games" and
 * "a code and its replacement" are the same state on the wire:
 *
 *   report game 1, Generate Next, Generate Next  -> codes 2 and 3 are games 2, 3
 *   report game 1, Generate Next, regenerate     -> codes 2 and 3 are both game 2
 *
 * Todd knows which it was at the moment it issued the code, and the thread is
 * the only place that knowledge survives a restart - so the thread is what gets
 * read back.
 *
 * Returns 0 when there is nothing to read, leaving the caller on its
 * recorded-results baseline rather than guessing downwards.
 */
export async function highestPostedGameNumber(thread: ControlThread): Promise<number> {
  try {
    const recent = await thread.messages.fetch({ limit: SCAN_LIMIT });
    let highest = 0;
    for (const message of recent.values()) {
      const match = /^# Game (\d+) /.exec(message.content);
      if (match) highest = Math.max(highest, Number(match[1]));
    }
    return highest;
  } catch (error) {
    logger.warn(`Could not read the game numbers already posted to the thread: ${String(error)}`);
    return 0;
  }
}

/**
 * Removes the code messages that a freshly issued code supersedes.
 *
 * Scoped to one game number, which is what makes this safe: a code issued after
 * a result belongs to the next game, so every earlier game's code message stays
 * as the record of what was played. Only the slot still being fought over is
 * collapsed down to its newest code.
 *
 * This clears the confusion of two live codes on screen, not the codes
 * themselves - Riot keeps an unplayed code valid and offers no way to retract
 * it. That is also why it is safe: a captain who already copied the older code
 * can still play it, and reporting names a winner rather than a code.
 */
export async function clearSupersededCodes(
  thread: ControlThread,
  gameNumber: number,
  keepMessageId: string,
): Promise<void> {
  // The trailing space is load-bearing: without it "# Game 1 " also matches the
  // "# Game 12 " heading.
  const heading = `# Game ${gameNumber} `;
  await sweepThread(
    thread,
    'remove a superseded code message',
    message => message.id !== keepMessageId && message.content.startsWith(heading),
    message => message.delete(),
  );
}

/**
 * Retires the buttons on every ⚠️ recovery message in the thread.
 *
 * A result landing answers all of them at once: "Try again" and "Go play a
 * custom game" were both offering a way past a code that would not generate,
 * and a recorded game is the way past. Left alone they stayed live for the rest
 * of the series, and a captain reaching for the next game's controls could
 * press one and re-report a game that was already reported.
 *
 * Does not touch the custom-in-progress message, which carries CUSTOM_MARKER
 * for exactly this reason - see that marker.
 *
 * The text stays and only the buttons go - "this game was played as a custom,
 * so there are no stats" is worth keeping in the thread's log, and deleting
 * would take that with it.
 */
export async function clearRecoveryButtons(thread: ControlThread): Promise<void> {
  await sweepThread(
    thread,
    'retire a stale recovery button',
    isRecoveryMessage,
    message => message.edit({ components: [] }),
  );
}

/**
 * Retires every report button for one game, whichever message carries it.
 *
 * The custom flow needs this twice, and dennys can help with neither. A custom
 * is played *instead of* the code that would not work, but it records a game
 * with no code on it, so nothing dennys holds ever marks that code as answered
 * and reconcileGameButtons can never retire its button - which left the dead
 * code offering a second report of a game already reported as a custom.
 *
 * Called once when the captain commits to the custom, which is the moment the
 * code becomes dead, and again when the custom is reported, which is what
 * answers the custom's own button.
 */
export async function retireGameButtons(
  thread: ControlThread,
  gameNumber: number,
): Promise<void> {
  await sweepThread(
    thread,
    `retire a report button for game ${gameNumber}`,
    message => reportTargetOf(message)?.gameNumber === gameNumber,
    message => message.edit({ components: [] }),
  );
}

/** What a report button on this message is for, if it carries one. */
function reportTargetOf(message: ControlMessage) {
  for (const row of message.components) {
    for (const component of row.components ?? []) {
      if (!component.customId) continue;
      try {
        const data = parseButtonData(component.customId);
        if (data.tag !== 'report_result' && data.tag !== 'report_custom') continue;
        const target = decodeReportTarget(data.tagArg);
        if (target) return target;
      } catch {
        // A custom_id Todd cannot parse is not a report button. Nothing to do.
      }
    }
  }
  return null;
}

/**
 * Retires every report button whose game dennys has now recorded.
 *
 * Driven off recorded games rather than off whatever was just clicked, which is
 * what makes it self-healing: Riot's callback can record a game without anyone
 * pressing anything in Discord, and this catches up the next time the thread is
 * touched. It is also why it cannot retire a button that still has a job - a
 * button survives precisely until its own code appears on a game.
 *
 * Games played as customs carry no code and so are never matched here; their
 * button is retired by clearCustomGameButtons instead.
 */
export async function reconcileGameButtons(
  thread: ControlThread,
  series: SeriesWithGames,
): Promise<void> {
  const recorded = new Set(
    series.games
      .map(game => game.tournamentCodeId)
      .filter((id): id is number => typeof id === 'number'),
  );
  if (recorded.size === 0) return;
  await sweepThread(
    thread,
    'retire a report button for a game that is already recorded',
    message => {
      const codeId = reportTargetOf(message)?.tournamentCodeId;
      return codeId != null && recorded.has(codeId);
    },
    message => message.edit({ components: [] }),
  );
}

/**
 * The games the thread is still waiting on a result for, oldest first.
 *
 * Read off the live report buttons rather than off dennys. Dennys cannot answer
 * this: a code with no game against it is equally "played, not yet reported" and
 * "abandoned when the captain regenerated", and the whole series' worth of
 * abandoned codes never resolves. A button, by contrast, exists because Todd
 * posted a code message for a game it numbered, and is retired the moment that
 * game is accounted for.
 *
 * Dennys does get the last word on whether a game is recorded, though. Riot's
 * callback records one without anyone pressing anything in Discord, so a button
 * can outlive its game until the next sweep runs - and this must not announce a
 * game that is already in.
 *
 * The newest game is never listed. Its code was issued so it could be played,
 * and the gap between issuing and reporting is the ordinary life of a game, not
 * something to chase; saying otherwise would put a warning on the thread from
 * the moment every code went out. What is worth saying is that the series has
 * moved past a game nobody reported - which is exactly the games below it.
 */
export async function gamesAwaitingReport(
  thread: ControlThread,
  series: SeriesWithGames,
): Promise<number[]> {
  const recorded = new Set(
    series.games
      .map(game => game.tournamentCodeId)
      .filter((id): id is number => typeof id === 'number'),
  );

  try {
    const recent = await thread.messages.fetch({ limit: SCAN_LIMIT });
    const awaiting = new Set<number>();
    let inProgress = 0;

    for (const message of recent.values()) {
      // Headings and buttons both, because they go missing in opposite cases: a
      // code Riot refused outright leaves a custom's button with no heading
      // above it, and a game already reported leaves a heading with no button.
      const heading = /^# Game (\d+) /.exec(message.content);
      if (heading) inProgress = Math.max(inProgress, Number(heading[1]));

      const target = reportTargetOf(message);
      if (!target) continue;
      inProgress = Math.max(inProgress, target.gameNumber);

      // A custom has no code to look up, so it stays listed until someone
      // reports it - which is right, since a report is the only way it can
      // ever arrive.
      if (target.tournamentCodeId != null && recorded.has(target.tournamentCodeId)) continue;
      awaiting.add(target.gameNumber);
    }

    const behind = [...awaiting].filter(number => number < inProgress).sort((a, b) => a - b);
    if (behind.length > 0) {
      logger.info(
        `Series ${series.id} is on game ${inProgress} with no result yet for game(s) ${behind.join(', ')}`,
      );
    }
    return behind;
  } catch (error) {
    logger.warn(`Could not scan the thread for games awaiting a result: ${String(error)}`);
    // Silence rather than a guess. The status message is posted either way, and
    // a missing line is better than one naming games from a half-read thread.
    return [];
  }
}

/**
 * Applies `act` to every recent message matching `matches`.
 *
 * Best-effort at both levels, and for the same reason in either caller: a
 * skipped message leaves one stale button, which the next sweep corrects,
 * whereas throwing would abandon the code or result that was just recorded.
 */
async function sweepThread(
  thread: ControlThread,
  what: string,
  matches: (message: ControlMessage) => boolean,
  act: (message: ControlMessage) => Promise<unknown>,
): Promise<void> {
  try {
    const recent = await thread.messages.fetch({ limit: SCAN_LIMIT });
    for (const message of recent.values()) {
      if (!matches(message)) continue;
      try {
        await act(message);
      } catch (error) {
        const code = (error as { code?: number })?.code;
        if (code !== UNKNOWN_MESSAGE) {
          logger.warn(`Could not ${what}: ${String(error)}`);
        }
      }
    }
  } catch (error) {
    logger.warn(`Could not scan the thread to ${what}: ${String(error)}`);
  }
}
