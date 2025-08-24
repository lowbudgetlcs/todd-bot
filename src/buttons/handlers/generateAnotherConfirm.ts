import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { createButton, createButtonData, parseButtonData } from "../button.ts";
import { getTournamentCode } from "../../commands/tournament.ts";
import log from 'loglevel';

const logger =log.getLogger('generateAnotherConfirm');
logger.setLevel('info');
export async function handleGenerateAnotherConfirm(interaction: ButtonInteraction) {
  try {
    const data = parseButtonData(interaction.customId);
    logger.info(`handleGenerateAnotherConfirm called with data: ${JSON.stringify(data)}`);
    const team1 = data.metadata[0];
    const team2 = data.metadata[1];
    const division = data.metadata[2];
    if (interaction.user.id !== data.originalUserId) {
      await interaction.reply({
        content: "Only the person who generated the original code can generate another one.",
        ephemeral: true
      });
      return;
    }

    const tournamentCode = await getTournamentCode(
      team1,
      team2,
      division,
      interaction
    );

    if (tournamentCode.error) {
      await interaction.followUp({
        content: tournamentCode.error,
        ephemeral: true
      });
      return;
    }

    // Create generate another button
    const generateButtonData = createButtonData("generate_another", data.originalUserId, data.metadata);
    const generateButton = createButton(generateButtonData, "Generate Next Game", ButtonStyle.Success, '⚔️');

    // Regenerate button row
    // data.metadata[3] = tournamentCode.gameId.toString(); 
    // logger.info(data.metadata);
    // const regenerateButtonData = createButtonData("regenerate_code", data.originalUserId, data.metadata);
    // const regenerateButton = createButton(regenerateButtonData, "Code Not Work?", ButtonStyle.Secondary, '❓');

    const buttonRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(generateButton);

    // Send new message with tournament code and button
    await interaction.update({
      content: "Generating new tournament code...",
      components: [],
    });

    await interaction.deleteReply();

    await interaction.followUp({
      content: tournamentCode.discordResponse?.toString(),
      components: [buttonRow],
      ephemeral: false,
      flags: 1 << 2
    });


  } catch (error) {
    console.error(error);
    await interaction.followUp({
      content: 'There was an error generating a new tournament code.',
      ephemeral: true
    });
  }
}