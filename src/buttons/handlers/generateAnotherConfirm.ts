import { ButtonInteraction } from "discord.js";
import { parseButtonData } from "../button.ts";
import { getTournamentCode } from "../../commands/tournament.ts";
import log from 'loglevel';
import { safeDefer, safeInteractionError } from "../../interactionSafety.ts";
import { buildControlRow, buildRecoveryRow, buildSeriesStatus, postSeriesControl } from "../../seriesControl.ts";
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

    const tournamentCode = await getTournamentCode({
      team1Id: team1,
      team2Id: team2,
      divisionId: division,
      stage: seriesData.stage,
      seriesId: seriesData.seriesId,
      interaction,
      enemyCaptainId: opposing_captain,
      first: false,
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
          content: `${tournamentCode.error}`,
          components: [
            buildRecoveryRow(data.originalUserId, seriesData, tournamentCode.retryable),
          ],
        });
      }
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

    await interaction.followUp({
      content: response,
      ephemeral: false,
      flags: 1 << 2
    });

    // Re-post the controls so they stay below the code that was just added.
    const thread = interaction.channel;
    if (thread && tournamentCode.series) {
      const pinnedSeries: SeriesData = { ...seriesData, seriesId: tournamentCode.seriesId };
      await postSeriesControl(
        thread as unknown as Parameters<typeof postSeriesControl>[0],
        buildSeriesStatus(tournamentCode.series, [
          { id: seriesData.team1Id, name: tournamentCode.team1Name },
          { id: seriesData.team2Id, name: tournamentCode.team2Name },
        ]),
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