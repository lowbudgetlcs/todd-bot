import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { createButton, createButtonData, parseButtonData } from "../button.ts";
import log from 'loglevel';

const logger =log.getLogger('switchSides');
logger.setLevel('info');
export async function handleSwitchSides(interaction: ButtonInteraction) {
  try {
    const data = parseButtonData(interaction.customId);
    logger.info(`handleSwitchSides called with data: ${JSON.stringify(data)}`);
    if (interaction.user.id !== data.originalUserId) {
      await interaction.reply({
        content: "Only the person who generated the original code can switch sides.",
        ephemeral: true
      });
      return;
    }

    const team1 = data.metadata[0];
    const team2 = data.metadata[1];
    const switchTeams = [team2, team1, data.metadata[2]]; // Switch teams and keep the rest of the metadata

    const confirmButtonData = createButtonData("generate_another_confirm", data.originalUserId, data.metadata);
    const confirmButton = createButton(confirmButtonData, "Generate Next Game", ButtonStyle.Success, '✅');

    const cancelButtonData = createButtonData("switch_sides", data.originalUserId, switchTeams);
    const cancelButton = createButton(cancelButtonData, "Switch Sides", ButtonStyle.Primary, '🔄');

    const buttonRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(confirmButton, cancelButton);

    const content = `Please confirm the new sides:\n` +
      `# Blue Side: ${team1}\n` +
      `# Red Side: ${team2}\n\n` +
      `Click Generate to generate code with these sides`;

    // Use update to modify existing message for switch/cancel flow

    await interaction.update({
      content: content,
      components: [buttonRow],
    });
  } catch (error) {
    logger.error(error);
    await interaction.followUp({
      content: 'There was an error preparing the side switch confirmation.',
      ephemeral: true
    });
  }
}