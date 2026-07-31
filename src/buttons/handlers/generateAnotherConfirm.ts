import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { createButton, createButtonData, parseButtonData } from "../button.ts";
import { getTournamentCode } from "../../commands/tournament.ts";
import log from 'loglevel';
import { safeDefer, safeInteractionError } from "../../interactionSafety.ts";

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

    const tournamentCode = await getTournamentCode(
      team1,
      team2,
      division,
      seriesData.stage,
      interaction,
      opposing_captain,
      false
    );

    if (tournamentCode.error) {
      // Report in place of the "Generating..." message. followUp() here used to
      // run before the interaction had been acknowledged at all.
      await interaction.editReply({
        content: tournamentCode.error,
        components: [],
      });
      return;
    }

    // Create generate another button

    // Regenerate button row
    // data.metadata[3] = tournamentCode.gameId.toString(); 
    // logger.info(data.metadata);
    // const regenerateButtonData = createButtonData("regenerate_code", data.originalUserId, data.metadata);
    // const regenerateButton = createButton(regenerateButtonData, "Code Not Work?", ButtonStyle.Secondary, '❓');


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


  } catch (error) {
    logger.error(error);
    // followUp() throws again on a dead token; safeInteractionError picks the
    // channel that is still valid and swallows the failure.
    await safeInteractionError(interaction, 'There was an error generating a new tournament code.');
  }
}