import { ButtonInteraction } from "discord.js";
import { parseButtonData } from "../button.ts";
import log from "loglevel";

const logger = log.getLogger("cancelFlow");
logger.setLevel("info");

export async function handleCancel(interaction: ButtonInteraction) {
  try {
    const data = parseButtonData(interaction.customId);
    logger.info(`handleCancel called with data: ${JSON.stringify(data)}`);
    const seriesData = data.seriesData;

    if (interaction.user.id !== data.originalUserId && interaction.user.id !== seriesData.enemyCaptainId) {
      await interaction.reply({
        content: "Only the original requester can cancel this action.",
        ephemeral: true,
      });
      return;
    }

    // Delete the ephemeral confirmation message
    await interaction.deferUpdate();
    await interaction.deleteReply();
  } catch (error) {
    logger.error(error);
    try {
      await interaction.reply({
        content: "There was an error while cancelling.",
        ephemeral: true,
      });
    } catch {
      // ignore if the reply already exists
    }
  }
}