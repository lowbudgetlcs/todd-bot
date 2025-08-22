import { ButtonInteraction } from "discord.js";
import { parseButtonData } from "../button.ts";
import log from 'loglevel';

const logger =log.getLogger('endSeries');
logger.setLevel('info');
export async function handleEndSeries(interaction: ButtonInteraction) {
  try {
    const data = parseButtonData(interaction.customId);
    logger.info(`handleEndSeries called with data: ${JSON.stringify(data)}`);
    if (interaction.user.id !== data.originalUserId) {
      await interaction.reply({
        content: "Only the person who generated the original code can end this series.",
        ephemeral: true
      });
      return;
    }

    await interaction.update({
      content: interaction.message.content,
      components: [], // Remove all buttons
    });


  } catch (error) {
    logger.error(error);
    await interaction.followUp({
      content: 'There was an error ending the series.',
      ephemeral: true
    });
  }
}
