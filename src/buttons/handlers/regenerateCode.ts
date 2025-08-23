import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { createButton, createButtonData, parseButtonData } from "../button.ts";
import log from 'loglevel';

const logger =log.getLogger('regenerateCode');
logger.setLevel('info');

export async function handleRegenerateCode(interaction: ButtonInteraction) {
  try {
    const data = parseButtonData(interaction.customId);
    logger.info(`handleRegenerateCode called with data: ${JSON.stringify(data)}`);

    if (interaction.user.id !== data.originalUserId) {
      await interaction.reply({
        content: "Only the person who generated the original code can confirm this action.",
        ephemeral: true,
      });
      return;
    }

    const team1 = data.metadata[0];
    const team2 = data.metadata[1];
    const gameNumber = data.metadata[3]; // assuming this is stored in metadata

    // Need to decide if we make a different call to dennys (new handler) or use generate_another but pass gameId?
    const confirmButtonData = createButtonData(
      "generate_another_confirm",
      data.originalUserId,
      data.metadata
    );
    const confirmButton = createButton(
      confirmButtonData,
      "Confirm",
      ButtonStyle.Success,
      '✅'
    );

    // Cancel button → delete the ephemeral confirmation
    const cancelButtonData = createButtonData(
      "cancel_flow",
      data.originalUserId,
      data.metadata
    );
    const cancelButton = createButton(
      cancelButtonData,
      "Cancel",
      ButtonStyle.Danger,
      '❌'
    );

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      confirmButton,
      cancelButton
    );

    const content =
      `⚔️ Please confirm your game re-generation:\n` +
      `## Blue Side: ${team1}\n` +
      `## Red Side: ${team2}\n` +
      `## Game Number: ${gameNumber}\n\n` +
      `Do you want to re-generate a code for this match?`;

    await interaction.reply({
      content: content,
      components: [buttonRow],
      ephemeral: true,
    });
  } catch (error) {
    logger.error(error);
    await interaction.followUp({
      content: "There was an error preparing the confirmation step.",
      ephemeral: true,
    });
  }
}