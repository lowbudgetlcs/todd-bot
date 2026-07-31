import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { createButton, createButtonData, parseButtonData } from "../button.ts";
import log from 'loglevel';
import { getTeam, Team } from "../../dennys.ts";
import { SeriesData } from "../../types/toddData.ts";
import { safeDefer, safeInteractionError } from "../../interactionSafety.ts";
const logger =log.getLogger('switchSides');
logger.setLevel('info');

export async function handleSwitchSides(interaction: ButtonInteraction) {
  try {
    const data = parseButtonData(interaction.customId);
    logger.info(`handleSwitchSides called with data: ${JSON.stringify(data)}`);
    const seriesData = data.seriesData;
    if (interaction.user.id !== data.originalUserId && interaction.user.id !== seriesData.enemyCaptainId) {
      await interaction.reply({
        content: "Only the person who generated the original code can switch sides.",
        ephemeral: true
      });
      return;
    }

    // getTeam hits dennys twice, which can outrun Discord's 3 second deadline.
    // Acknowledge first; editReply below replaces what update() used to do.
    if (!(await safeDefer(interaction, { update: true }))) return;

    const team1:Team = await getTeam(seriesData.team1Id);
    const team2:Team = await getTeam(seriesData.team2Id);

    const seriesDataSwitched: SeriesData = {
      team1Id: team2.id,
      team2Id: team1.id,
      divisionId: seriesData.divisionId,
      enemyCaptainId: seriesData.enemyCaptainId,
      stage: seriesData.stage
    };
    const confirmButtonData = createButtonData("generate_another_confirm", data.originalUserId, seriesData);
    const confirmButton = createButton(confirmButtonData, "Confirm", ButtonStyle.Success, '✅');

    const switchButtonData = createButtonData("switch_sides", data.originalUserId, seriesDataSwitched);
    const switchButton = createButton(switchButtonData, "Switch Sides", ButtonStyle.Primary, '🔄');

    const cancelButtonData = createButtonData("cancel_flow", data.originalUserId, seriesData);
    const cancelButton = createButton(cancelButtonData, "Cancel", ButtonStyle.Danger,'❌');

    const buttonRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(confirmButton, switchButton, cancelButton);

    const content = `Please confirm the new sides:\n` +
      `# Blue Side: ${team1.name}\n` +
      `# Red Side: ${team2.name}\n\n` +
      `Click Generate to generate code with these sides`;

    // Edits the message the button is on, same as update() did before the defer.

    await interaction.editReply({
      content: content,
      components: [buttonRow],
    });
  } catch (error) {
    logger.error(error);
    // followUp() throws again on a dead token; safeInteractionError picks the
    // channel that is still valid and swallows the failure.
    await safeInteractionError(
      interaction,
      'There was an error preparing the side switch confirmation.',
    );
  }
}