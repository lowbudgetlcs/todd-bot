import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from 'discord.js';
import { createButton, createButtonData, parseButtonData } from '../button.ts';
import {
  getSeries,
  getTeam,
  isRiotGatewayError,
  refreshSeriesFromCode,
  reportSeriesResult,
} from '../../dennys.ts';
import type { SeriesWithGames, Team } from '../../dennys.ts';
import {
  announceSeriesFinished,
  buildControlRow,
  buildSeriesStatus,
  clearRecoveryButtons,
  decodeReportTarget,
  encodeReportTarget,
  gamesAwaitingReport,
  reconcileGameButtons,
  postSeriesControl,
  retireGameButtons,
  shareThreadScan,
  shortcodeForGame,
  shortcodeIn,
} from '../../seriesControl.ts';
import type { ControlThread } from '../../seriesControl.ts';
import { safeDefer, safeInteractionError } from '../../interactionSafety.ts';
import { config } from '../../config.ts';
import { SeriesData } from '../../types/toddData.ts';
import log from 'loglevel';

const logger = log.getLogger('reportResult');
logger.setLevel('info');

const mayAct = (interaction: ButtonInteraction, originalUserId: string, enemyCaptainId: string) =>
  interaction.user.id === originalUserId || interaction.user.id === enemyCaptainId;

/**
 * Brings the thread into line with what dennys now holds.
 *
 * Both ways a game becomes recorded end here, and that is the whole point of it
 * being one function: the captain claiming a winner and Riot answering for the
 * code are the same event as far as the thread is concerned, and the status line
 * and the buttons have to say so either way.
 *
 * They did not. The verify path retired the report buttons and stopped, so a
 * game Riot had just confirmed left the status still asking for a result and
 * Generate Next Game still greyed against a game that was over - the series had
 * moved on and the only thing that said so was a message nobody could see.
 *
 * `retireCustomFor` is the game number a custom was just reported for, or null.
 * A custom records a game with no code on it, so reconcileGameButtons can never
 * reach its button and retiring by number is what closes that gap.
 *
 * The order is load-bearing: the sweeps run before the thread is read for what
 * is still awaiting a result, so the game just recorded is not counted among
 * them, and the control message is posted last so it stays at the bottom.
 */
async function catchThreadUp(
  scan: ControlThread,
  series: SeriesWithGames,
  teams: [Team, Team],
  seriesData: SeriesData,
  originalUserId: string,
  retireCustomFor: number | null,
): Promise<void> {
  // Retires the report button on every game dennys now holds - the one just
  // recorded, and any Riot has answered since the thread was last touched.
  await reconcileGameButtons(scan, series);

  // A recorded game is the way past whatever the ⚠️ rows were offering a way
  // past, so those retire on any result.
  await clearRecoveryButtons(scan);

  if (retireCustomFor != null) await retireGameButtons(scan, retireCustomFor);

  // Only true because the shared scan carries the sweeps' edits forward.
  const awaiting = await gamesAwaitingReport(scan, series);

  // Before the control message, which has to stay last in the thread.
  if (series.completed) {
    await announceSeriesFinished(scan, config.POST_GAME_FORM_URL);
  }

  await postSeriesControl(
    scan,
    buildSeriesStatus(
      series,
      teams.map(team => ({ id: team.id, name: team.name })),
      Date.now(),
      awaiting,
    ),
    [buildControlRow(originalUserId, seriesData, series)],
  );
}

/**
 * What to say instead of opening the picker, when the stats are already in.
 *
 * This is the ordinary outcome of the button, not a refusal - Todd has just
 * asked Riot, and the answer was yes. Worded as the verification succeeding.
 *
 * Names the winner rather than just saying "recorded": the captain pressed this
 * because they could not tell whether the result had landed, and seeing it is
 * the answer. A wrong result is a correction by staff, not a second report.
 *
 * Deliberately does not credit Riot. The same message covers a game an earlier
 * self-report put on record, which Riot may know nothing about.
 *
 * The game number comes from the button, not from dennys. Dennys numbers games
 * in the order results are written, so its number for this game can differ from
 * the one the thread has been showing all along; the thread's is the one the
 * captain is looking at.
 */
function describeExistingResult(
  recorded: SeriesWithGames['games'][number],
  gameNumber: number,
  teams: Team[],
): string {
  const winner = teams.find(team => team.id === recorded.result?.winningTeamId);
  const scoreline = winner ? ` — **${winner.name}** won` : '';
  return (
    `Game ${gameNumber}'s stats are in${scoreline}, so there is nothing to report.\n` +
    'If that result is wrong, ask an admin to fix it.'
  );
}

/**
 * The series as it stands once dennys has re-asked Riot about this one code,
 * plus the id dennys itself files that code under.
 *
 * A missed callback is far likelier than a genuinely unreported game, so the
 * button asks Riot before it asks the captain - which is what the label
 * promises. The refresh costs nothing against the per-game code limit, so this
 * replaces the old workaround of issuing a fresh code to trigger a pull.
 *
 * The code is named by **shortcode**, taken from the message Todd printed it
 * on. That string is what Riot issued, what dennys stored and what the captains
 * pasted into the client, so all four agree on it; the id on the button is
 * Todd's copy of dennys's handle and is only as fresh as the button. The id
 * that comes back is looked up *from the shortcode* for the same reason - the
 * duplicate check below matches on it, so trusting the button's copy there
 * would put the same doubt on the answer.
 *
 * Undefined for a custom: no code to name, dennys rejects a refresh naming none
 * (422), and Riot has never heard of the game anyway.
 *
 * Any refusal falls back to a plain read, so the duplicate check still runs
 * against whatever dennys holds. That read is deliberately not caught - if
 * dennys cannot be reached at all, this fails the way it always did rather than
 * opening the picker on no information and inviting a duplicate.
 */
async function verifyAgainstRiot(
  interaction: ButtonInteraction,
  seriesId: number,
  target: { tournamentCodeId: number | null; gameNumber: number } | null,
): Promise<{ series: SeriesWithGames; tournamentCodeId: number | null } | undefined> {
  if (!target || target.tournamentCodeId == null) return undefined;

  // The button rides on the code message, so its own content is the first place
  // to look and costs nothing. The thread is the fallback for the buttons that
  // live elsewhere - the code-limit row is posted on a ⚠️ message.
  const thread = interaction.channel;
  const shortcode =
    shortcodeIn(interaction.message?.content) ??
    (thread && 'messages' in thread
      ? await shortcodeForGame(thread as unknown as ControlThread, target.gameNumber)
      : null);

  const resolve = (series: SeriesWithGames) => ({
    series,
    // Falls back to the button's id only when the shortcode is not on the
    // series at all, which means the two have genuinely diverged.
    tournamentCodeId:
      series.tournamentCodes.find(code => code.shortcode === shortcode)?.id ??
      target.tournamentCodeId,
  });

  if (!shortcode) {
    logger.warn(
      `No code printed for game ${target.gameNumber} on series ${seriesId} - ` +
        'reading the series instead of re-asking Riot',
    );
    return resolve(await getSeries(seriesId));
  }

  try {
    return resolve(await refreshSeriesFromCode(seriesId, shortcode));
  } catch (error) {
    if (isRiotGatewayError(error)) {
      logger.warn(
        `Riot could not be reached to verify ${shortcode} on series ${seriesId}; ` +
          'falling back to what dennys already holds',
      );
    } else {
      logger.error(`Refreshing ${shortcode} on series ${seriesId} failed:`, error);
    }
    return resolve(await getSeries(seriesId));
  }
}

/** Opens the winner picker. The report itself happens on the next click. */
export async function handleReportResult(interaction: ButtonInteraction) {
  try {
    const data = parseButtonData(interaction.customId);
    const seriesData = data.seriesData;
    if (!mayAct(interaction, data.originalUserId, seriesData.enemyCaptainId)) {
      await interaction.reply({
        content: 'Only the two captains in this series can report a result.',
        ephemeral: true,
      });
      return;
    }

    if (!(await safeDefer(interaction, { ephemeral: true }))) return;

    // Which game this button is for. A custom carries a game number but no
    // code: it is played outside Riot, so dennys can never already hold it and
    // there is nothing to check against.
    const target = decodeReportTarget(data.tagArg);
    const codeId = target?.tournamentCodeId ?? null;

    // Logged on every press, both branches, so the check is visible in the logs
    // whether or not it finds anything. "No log line" would otherwise be
    // indistinguishable between "dennys said no result" and "Todd never asked".
    logger.info(
      `Report pressed by ${interaction.user.id} for series ${seriesData.seriesId}, ` +
        (target
          ? `game ${target.gameNumber} (code ${codeId ?? 'none - custom'})`
          : 'no target on the button') +
        (codeId != null
          ? ' - asking dennys whether it already has a result'
          : ' - nothing to ask dennys, a custom leaves no trace there'),
    );

    const [team1, team2, verified] = await Promise.all([
      getTeam(seriesData.team1Id),
      getTeam(seriesData.team2Id),
      verifyAgainstRiot(interaction, seriesData.seriesId, target),
    ]);
    const series = verified?.series;
    // Dennys's own id for the code the button names, resolved from the
    // shortcode - see verifyAgainstRiot for why the button's copy is not used.
    const recordedCodeId = verified?.tournamentCodeId ?? codeId;

    // Exact, not a guess: dennys stamps the code on the game it records, so this
    // asks whether *this* game is recorded rather than whether some game is.
    const recorded = series?.games.find(
      game => game.tournamentCodeId === recordedCodeId && game.result,
    );
    if (series) {
      logger.info(
        `dennys answered for series ${seriesData.seriesId}: ${series.games.length} game(s) on record` +
          `, codes recorded ${JSON.stringify(series.games.map(game => game.tournamentCodeId))}` +
          ` - code ${recordedCodeId} ${recorded ? 'already has a result' : 'does not'}`,
      );
    }
    if (target && series && recorded) {
      logger.info(
        `Report declined for series ${seriesData.seriesId}: code ${recordedCodeId} already has a result`,
      );
      await interaction.editReply({
        content: describeExistingResult(recorded, target.gameNumber, [team1, team2]),
        components: [],
      });

      // The same catch-up a self-reported result gets. Riot answering for the
      // code moves the series on exactly as much as a captain claiming it does,
      // so the status line and the buttons have to move with it - for both
      // captains, not just whoever pressed.
      const thread = interaction.channel;
      if (thread && 'send' in thread) {
        await catchThreadUp(
          shareThreadScan(thread as unknown as ControlThread),
          series,
          [team1, team2],
          seriesData,
          data.originalUserId,
          // Nothing to retire by number: this game has a code, so the sweep
          // above reaches its button.
          null,
        );
      }
      return;
    }

    // Re-encoded rather than passed straight through, so the write inherits the
    // id resolved from the shortcode instead of the one frozen into the button
    // that opened this. The next click is what calls /results, and a result
    // naming the wrong code is credited to the wrong game - worse than the
    // duplicate check merely missing. Minted fresh here, so it costs nothing.
    //
    // A custom resolves to null and encodes as 0, which is what it carried
    // anyway: it has no code, and that is how the write knows to omit one.
    const writeTarget = target
      ? encodeReportTarget(recordedCodeId, target.gameNumber)
      : data.tagArg;

    // No blue/red framing here. The sides in SeriesData are the ones the *next*
    // code will use, and Switch Sides swaps them between games, so they say
    // nothing about which side either team played in the game being reported.
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      createButton(
        createButtonData('report_team1_won', data.originalUserId, seriesData, writeTarget),
        `${team1.name} won`,
        ButtonStyle.Secondary,
        '🏆',
      ),
      createButton(
        createButtonData('report_team2_won', data.originalUserId, seriesData, writeTarget),
        `${team2.name} won`,
        ButtonStyle.Secondary,
        '🏆',
      ),
      createButton(
        createButtonData('cancel_flow', data.originalUserId, seriesData),
        'Cancel',
        ButtonStyle.Secondary,
        '❌',
      ),
    );

    logger.info(
      `Opening the winner picker for series ${seriesData.seriesId}` +
        (target ? `, game ${target.gameNumber}` : ''),
    );

    await interaction.editReply({
      content: target ? `Who won **Game ${target.gameNumber}**?` : 'Who won this game?',
      components: [row],
    });
  } catch (error) {
    logger.error(error);
    await safeInteractionError(interaction, 'There was an error opening the result form.');
  }
}

/**
 * Records the winner and refreshes the thread.
 *
 * The request names the tournament code whose message the captain pressed. That
 * is what makes it safe to press twice: dennys returns the game it already has
 * for that code instead of inserting a second one, and it attributes the result
 * to the right game even while another code is outstanding. A report that names
 * no code gets neither - it inserts unconditionally, and if a Riot pull lands
 * during the same request it hands back whatever that pull found instead.
 *
 * A custom has no code to name, so it takes that codeless path by necessity.
 * The check after the write is how that case is caught.
 *
 * `tournamentCodeId` and `shortcode` are mutually exclusive as of dennys 1.4.0 -
 * sending both is rejected outright, so only the id goes.
 */
async function report(interaction: ButtonInteraction, winner: 'team1' | 'team2') {
  try {
    const data = parseButtonData(interaction.customId);
    const seriesData = data.seriesData;
    if (!mayAct(interaction, data.originalUserId, seriesData.enemyCaptainId)) {
      await interaction.reply({
        content: 'Only the two captains in this series can report a result.',
        ephemeral: true,
      });
      return;
    }

    if (!(await safeDefer(interaction, { update: true }))) return;

    const target = decodeReportTarget(data.tagArg);
    const codeId = target?.tournamentCodeId ?? null;
    const winnerTeamId = winner === 'team1' ? seriesData.team1Id : seriesData.team2Id;
    // A captain can report a winner Riot does not corroborate, and the blast
    // radius is series routing. Staff need to know who said so.
    logger.info(
      `Result reported by ${interaction.user.id} for series ${seriesData.seriesId}: team ${winnerTeamId} won` +
        (codeId != null ? ` on code ${codeId}` : ' for a custom game'),
    );

    const game = await reportSeriesResult(seriesData.seriesId, {
      winnerTeamId,
      ...(codeId != null ? { tournamentCodeId: codeId } : {}),
    });

    const [series, team1, team2] = await Promise.all([
      getSeries(seriesData.seriesId),
      getTeam(seriesData.team1Id),
      getTeam(seriesData.team2Id),
    ]);
    const winnerName = winner === 'team1' ? team1.name : team2.name;

    // Todd's number, not dennys's. Dennys numbers games in the order results
    // are written, so reporting two games out of the order they were played
    // makes its numbers disagree with the headings the thread has been showing.
    // The thread is what the captains read, so the thread wins - and for a
    // custom, which has no code message to take a number from, dennys's is the
    // only one there is.
    const gameNumber = target?.gameNumber ?? game.number;

    // Dennys pulls from Riot before it records. A codeless report - which is
    // every custom - takes whatever that pull found, so a custom reported while
    // a coded game is still outstanding can come back as the coded game
    // instead, with the captain's result silently dropped.
    const swallowed = codeId == null && game.tournamentCodeId != null;
    await interaction.editReply({
      content: swallowed
        ? 'Riot answered for an outstanding code first, so that result was recorded instead of ' +
          'your custom game. Report the custom again now that the code is settled.'
        : 'Result recorded.',
      components: [],
    });

    const thread = interaction.channel;
    if (thread && 'send' in thread) {
      if (!swallowed) {
        // Stands beside "Game Generated By" on the code message. The control
        // message is replaced after every code, so the credit goes in a message
        // of its own or it does not survive the next one.
        await thread.send({
          content: `📝 Game ${gameNumber}: **${winnerName}** won\nReported By: <@${interaction.user.id}>`,
        });
      }

      // The sweeps have to run in this order and cannot be fired in parallel, so
      // they shared five sequential fetches of the same fifty messages. One
      // fetch now serves all of them.
      await catchThreadUp(
        shareThreadScan(thread as unknown as ControlThread),
        series,
        [team1, team2],
        seriesData,
        data.originalUserId,
        // Only once the custom is genuinely on record: a swallowed report still
        // needs filing, so its button has to stay.
        codeId == null && !swallowed && target ? target.gameNumber : null,
      );
    }
  } catch (error) {
    logger.error(error);
    await safeInteractionError(interaction, 'There was an error recording that result.');
  }
}

export const handleReportTeam1Won = (interaction: ButtonInteraction) => report(interaction, 'team1');
export const handleReportTeam2Won = (interaction: ButtonInteraction) => report(interaction, 'team2');
