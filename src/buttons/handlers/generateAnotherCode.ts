import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { createButton, createButtonData, parseButtonData } from "../button.ts";
import { getTeam, Team } from '../../dennys.ts';
import log from 'loglevel';
import { SeriesData } from "../../types/toddData.ts";

const logger =log.getLogger('generateAnotherCode');
logger.setLevel('info');
export async function handleGenerateAnotherCode(interaction: ButtonInteraction) {
  try {
    const data = parseButtonData(interaction.customId);
    const seriesData = data.seriesData;
    const enemyCaptainId = seriesData.enemyCaptainId;
    logger.info(`handleGenerateAnotherCode called with data: ${JSON.stringify(data)}`);
    if (interaction.user.id !== data.originalUserId && interaction.user.id !== enemyCaptainId) {
      await interaction.reply({
        content: "Only the person who generated the original code can generate another one.",
        ephemeral: true
      });
      return;
    }

    const generateButtonData = createButtonData("generate_another_confirm", data.originalUserId, seriesData);
    const generateButton = createButton(generateButtonData, "Confirm", ButtonStyle.Success, '⚔️');

    const team1:Team = await getTeam(seriesData.team1Id);
    const team2:Team = await getTeam(seriesData.team2Id);

    const seriesDataSwitched: SeriesData = {
          team1Id: team2.id,
          team2Id: team1.id,
          divisionId: seriesData.divisionId,
          enemyCaptainId: seriesData.enemyCaptainId,
        };
        
    const switchButtonData = createButtonData("switch_sides", data.originalUserId, seriesDataSwitched);  
    const switchButton = createButton(switchButtonData, "Switch Sides",ButtonStyle.Primary, '🔄');
    const cancelButtonData = createButtonData("cancel_flow", data.originalUserId, seriesData);
    const cancelButton = createButton(cancelButtonData, "Cancel", ButtonStyle.Danger, '❌');
    
    const buttonRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(generateButton, switchButton, cancelButton);

    const content = `Current team sides:\n` +
      `# Blue Side: ${team1.name}\n` +
      `# Red Side: ${team2.name}\n\n` +
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