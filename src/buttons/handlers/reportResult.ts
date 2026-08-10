import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from 'discord.js';
import { createButton, createButtonData, parseButtonData } from '../button.ts';
import { getSeries, getTeam, reportSeriesResult } from '../../dennys.ts';
import type { SeriesWithGames, Team } from '../../dennys.ts';
import {
  buildControlRow,
  buildSeriesStatus,
  clearRecoveryButtons,
  decodeReportTarget,
  gamesAwaitingReport,
  reconcileGameButtons,
  postSeriesControl,
  retireGameButtons,
  shareThreadScan,
} from '../../seriesControl.ts';
import type { ControlThread } from '../../seriesControl.ts';
import { safeDefer, safeInteractionError } from '../../interactionSafety.ts';
import log from 'loglevel';

const logger = log.getLogger('reportResult');
logger.setLevel('info');

const mayAct = (interaction: ButtonInteraction, originalUserId: string, enemyCaptainId: string) =>
  interaction.user.id === originalUserId || interaction.user.id === enemyCaptainId;

/**
 * What to say instead of opening the picker, when Riot got there first.
 *
 * Names the winner rather than just refusing: the captain pressed this because
 * they could not tell whether the result had landed, and seeing it is the
 * answer. A wrong result is a correction by staff, not a second report.
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
    `Game ${gameNumber} is already recorded${scoreline}, so there is nothing to report.\n` +
    'If that result is wrong, ask an admin to fix it.'
  );
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

    const [team1, team2, series] = await Promise.all([
      getTeam(seriesData.team1Id),
      getTeam(seriesData.team2Id),
      codeId != null ? getSeries(seriesData.seriesId) : undefined,
    ]);

    // Exact, not a guess: dennys stamps the code on the game it records, so this
    // asks whether *this* game is recorded rather than whether some game is.
    const recorded = series?.games.find(
      game => game.tournamentCodeId === codeId && game.result,
    );
    if (series) {
      logger.info(
        `dennys answered for series ${seriesData.seriesId}: ${series.games.length} game(s) on record` +
          `, codes recorded ${JSON.stringify(series.games.map(game => game.tournamentCodeId))}` +
          ` - code ${codeId} ${recorded ? 'already has a result' : 'does not'}`,
      );
    }
    if (target && series && recorded) {
      logger.info(
        `Report declined for series ${seriesData.seriesId}: code ${codeId} already has a result`,
      );
      await interaction.editReply({
        content: describeExistingResult(recorded, target.gameNumber, [team1, team2]),
        components: [],
      });

      // Retire the button that should not still have been there - for the other
      // captain too, rather than leaving them to press it and read the same
      // refusal. Riot's callback lands without anyone pressing anything, so
      // this is the first chance Todd has had to notice.
      const thread = interaction.channel;
      if (thread && 'send' in thread) {
        await reconcileGameButtons(
          thread as unknown as Parameters<typeof reconcileGameButtons>[0],
          series,
        );
      }
      return;
    }

    // No blue/red framing here. The sides in SeriesData are the ones the *next*
    // code will use, and Switch Sides swaps them between games, so they say
    // nothing about which side either team played in the game being reported.
    //
    // The target rides on through to the winner buttons: this click only opens
    // the picker, and the next one is what writes, so it needs to know which
    // game it is writing for.
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      createButton(
        createButtonData('report_team1_won', data.originalUserId, seriesData, data.tagArg),
        `${team1.name} won`,
        ButtonStyle.Secondary,
        '🏆',
      ),
      createButton(
        createButtonData('report_team2_won', data.originalUserId, seriesData, data.tagArg),
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

      // The four sweeps below have to run in this order and cannot be fired in
      // parallel, so they shared five sequential fetches of the same fifty
      // messages. One fetch now serves all of them.
      const scan = shareThreadScan(thread as unknown as ControlThread);

      // Retires the report button on every game dennys now holds - the one just
      // written, and any Riot has answered since the thread was last touched.
      await reconcileGameButtons(scan, series);

      // A recorded game is the way past whatever the ⚠️ rows were offering a way
      // past, so those retire on any result.
      await clearRecoveryButtons(scan);

      // A custom records a game with no code on it, so reconcile above can never
      // reach either the custom's own button or the dead code's. Retiring by
      // game number is what closes that gap - and only once the custom is
      // genuinely on record, since a swallowed report still needs filing.
      if (codeId == null && !swallowed && target) {
        await retireGameButtons(scan, target.gameNumber);
      }

      // After the three sweeps above, so the game just reported is not counted
      // among the ones still waiting - which is only true because the shared
      // scan carries their edits forward.
      const awaiting = await gamesAwaitingReport(scan, series);

      await postSeriesControl(
        scan,
        buildSeriesStatus(
          series,
          [
            { id: team1.id, name: team1.name },
            { id: team2.id, name: team2.name },
          ],
          Date.now(),
          awaiting,
        ),
        [buildControlRow(data.originalUserId, seriesData, series)],
      );
    }
  } catch (error) {
    logger.error(error);
    await safeInteractionError(interaction, 'There was an error recording that result.');
  }
}

export const handleReportTeam1Won = (interaction: ButtonInteraction) => report(interaction, 'team1');
export const handleReportTeam2Won = (interaction: ButtonInteraction) => report(interaction, 'team2');
