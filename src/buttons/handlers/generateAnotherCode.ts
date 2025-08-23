import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { createButton, createButtonData, parseButtonData } from "../button.ts";
import log from 'loglevel';

const logger =log.getLogger('generateAnotherCode');
logger.setLevel('info');
export async function handleGenerateAnotherCode(interaction: ButtonInteraction) {
  try {
    const data = parseButtonData(interaction.customId);
    logger.info(`handleGenerateAnotherCode called with data: ${JSON.stringify(data)}`);
    if (interaction.user.id !== data.originalUserId) {
      await interaction.reply({
        content: "Only the person who generated the original code can generate another one.",
        ephemeral: true
      });
      return;
    }

    const generateButtonData = createButtonData("generate_another_confirm", data.originalUserId, data.metadata);
    const generateButton = createButton(generateButtonData, "Generate Next Game", ButtonStyle.Success, '⚔️');

    const team1 = data.metadata[0];
    const team2 = data.metadata[1];
    const switchTeams = [team2, team1, data.metadata[2]]; // Switch teams and keep the rest of the metadata
    const switchButtonData = createButtonData("switch_sides", data.originalUserId, switchTeams);  
    const switchButton = createButton(switchButtonData, "Switch Sides",ButtonStyle.Primary, '🔄');
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
    const buttonRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(generateButton, switchButton, cancelButton);

    const content = `Current team sides:\n` +
      `# Blue Side: ${team1}\n` +
      `# Red Side: ${team2}\n\n` +
      `Choose to generate with same sides or switch them`;

    // Use reply for new message when generating another code
    await interaction.reply({
      content: content,
      components: [buttonRow],
      ephemeral: true
    });
  } catch (error) {
    logger.error(error);
    await interaction.followUp({
      content: 'There was an error preparing the team selection.',
      ephemeral: true
    });
  }
}