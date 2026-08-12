import { ButtonInteraction } from "discord.js";
import { parseButtonData } from "../button.ts";
import { getTournamentCode } from "../../commands/tournament.ts";
import log from 'loglevel';
import { safeDefer, safeInteractionError } from "../../interactionSafety.ts";
import {
  buildCodeLimitRow,
  buildControlRow,
  buildGameReportRow,
  buildRecoveryRow,
  buildSeriesStatus,
  clearSupersededCodes,
  gamesAwaitingReport,
  postSeriesControl,
  RECOVERY_MARKER,
  shareThreadScan,
} from "../../seriesControl.ts";
import type { ControlThread } from "../../seriesControl.ts";
import { SeriesData } from "../../types/toddData.ts";

const logger =log.getLogger('generateAnotherConfirm');
logger.setLevel('info');
export async function handleGenerateAnotherConfirm(interaction: ButtonInteraction) {
  try {
    const data = parseButtonData(interaction.customId);
    const seriesData = data.seriesData;
    logger.info(`handleGenerateAnotherConfirm called with data: ${JSON.stringify(data)}`);
    const team1 = seriesData.team1Id;
    const team2 = seriesData.team2Id;
    const division = seriesData.divisionId;
    const enemyCaptainId = seriesData.enemyCaptainId;
    if (interaction.user.id !== data.originalUserId && interaction.user.id !== enemyCaptainId) {
      await interaction.reply({
        content: "Only the person who generated the original code can generate another one.",
        ephemeral: true
      });
      return;
    }
    const opposing_captain = enemyCaptainId != interaction.user.id? enemyCaptainId: data.originalUserId;

    // getTournamentCode is the slowest call in the bot - an event lookup, two
    // team lookups, then code generation - so acknowledge before any of it.
    if (!(await safeDefer(interaction, { update: true }))) return;

    // Clearing the components here rather than after the call also stops a
    // second Confirm click from generating a duplicate code while we wait.
    await interaction.editReply({
      content: "Generating new tournament code...",
      components: [],
    });

    // Only "Code not working?" means the existing code is dead. Generate Next
    // Game asks for the following slot, even when the current game has not been
    // reported yet - game numbers move on results, so nothing else would tell
    // these two apart.
    const replacement = data.tag === 'regenerate_confirm';

    const tournamentCode = await getTournamentCode({
      team1Id: team1,
      team2Id: team2,
      divisionId: division,
      stage: seriesData.stage,
      seriesId: seriesData.seriesId,
      interaction,
      enemyCaptainId: opposing_captain,
      first: false,
      replacement,
    });

    if (tournamentCode.riotUnavailable) {
      // Report in place of the "Generating..." message. followUp() here used to
      // run before the interaction had been acknowledged at all.
      await interaction.editReply({
        content: tournamentCode.error!,
        components: [],
      });

      // A mid-series regenerate that never got a code has nothing for
      // "Code not working?" to gate on - hasOutstandingCode only sees codes
      // Riot actually issued. Without this, the only failure exit is the one
      // posted at series start, which this series may not have gone through.
      const thread = interaction.channel;
      if (thread && 'send' in thread) {
        await thread.send({
          content: `${RECOVERY_MARKER} ${tournamentCode.error}`,
          components: [
            buildRecoveryRow(data.originalUserId, seriesData, tournamentCode.retryable),
          ],
        });
      }
      return;
    }

    // Dennys refused: this game has used its code allowance. Said once, in the
    // thread, where both captains can see it and either can act on the buttons.
    if (tournamentCode.codeLimitReached) {
      const limitThread = interaction.channel;
      if (limitThread && 'send' in limitThread) {
        await limitThread.send({
          content: `${RECOVERY_MARKER} ${tournamentCode.error}`,
          components: [
            buildCodeLimitRow(
              data.originalUserId,
              seriesData,
              tournamentCode.tournamentCodeId || null,
              tournamentCode.gameNumber,
            ),
          ],
        });
        // Posted first, so a failed send leaves the ephemeral to carry the news.
        await interaction.deleteReply();
        return;
      }

      await interaction.editReply({
        content: tournamentCode.error!,
        components: [],
      });
      return;
    }

    if (tournamentCode.error) {
      // Report in place of the "Generating..." message. followUp() here used to
      // run before the interaction had been acknowledged at all.
      await interaction.editReply({
        content: tournamentCode.error,
        components: [],
      });
      return;
    }

    // Drop the ephemeral "Generating..." message, then post the code publicly.
    await interaction.deleteReply();

    // discordResponse already carries the game number and shortcode (built in
    // tournament.ts). There was a `response.concat(...)` here that appended them
    // a second time - it discarded its result, so it never took effect; keeping
    // it and "fixing" it would have duplicated the code line.
    const response = tournamentCode.discordResponse?.toString() || "";

    const pinnedSeries: SeriesData = { ...seriesData, seriesId: tournamentCode.seriesId };

    const posted = await interaction.followUp({
      content: response,
      ephemeral: false,
      flags: 1 << 2,
      // The report button rides on the code message so it can name the code it
      // reports - see buildGameReportRow.
      components: [
        buildGameReportRow(
          data.originalUserId,
          pinnedSeries,
          tournamentCode.tournamentCodeId,
          tournamentCode.gameNumber,
        ),
      ],
    });

    // Re-post the controls so they stay below the code that was just added.
    const thread = interaction.channel;
    if (thread && tournamentCode.series) {
      // Sweep, list, post - three passes over the same fifty messages, and the
      // fetch is lazy, so it still happens after the code above was posted and
      // sees it. See shareThreadScan.
      const scan = shareThreadScan(thread as unknown as ControlThread);

      // Only when the captain came through "Code not working?", which is the one
      // path that declares the existing code dead. Generate Next Game pressed
      // before the current result is in produces a code for that same game
      // number, and removing its message would take away a code still in use.
      if (replacement) {
        await clearSupersededCodes(scan, tournamentCode.gameNumber, posted.id);
      }

      // Issuing a code is the moment an unreported game falls behind: the game
      // it was issued for becomes the one in progress, and anything below it
      // that nobody reported is now genuinely overdue rather than in flight.
      const awaiting = await gamesAwaitingReport(scan, tournamentCode.series);

      await postSeriesControl(
        scan,
        buildSeriesStatus(
          tournamentCode.series,
          [
            { id: seriesData.team1Id, name: tournamentCode.team1Name },
            { id: seriesData.team2Id, name: tournamentCode.team2Name },
          ],
          Date.now(),
          awaiting,
        ),
        [buildControlRow(data.originalUserId, pinnedSeries, tournamentCode.series)],
      );
    }

  } catch (error) {
    logger.error(error);
    // followUp() throws again on a dead token; safeInteractionError picks the
    // channel that is still valid and swallows the failure.
    await safeInteractionError(interaction, 'There was an error generating a new tournament code.');
  }
}