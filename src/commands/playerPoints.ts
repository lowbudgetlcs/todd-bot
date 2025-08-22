import { ActionRowBuilder, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import log from 'loglevel';

const logger =log.getLogger('playerPoints');
logger.setLevel('info');

module.exports = {
  data: new SlashCommandBuilder().setName('player_point_calculator').setDescription('Calculate player point value'),
  async execute(interaction: {
      showModal(modal: ModalBuilder): unknown; reply: (arg0: { content: string }) => any 
}) {
    const modal = new ModalBuilder()
    .setCustomId("rankModal")
    .setTitle("Rank Calculator - S2025");

  const gamesInput = new TextInputBuilder()
    .setCustomId("games")
    .setLabel("Solo/Duo Ranked Games in S2025")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g., 150")
    .setRequired(true);

  const peakS2025Input = new TextInputBuilder()
    .setCustomId("peak2025")
    .setLabel("Peak Rank in S2025")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g., G3, M32")
    .setRequired(true);

  const peakSince2024Input = new TextInputBuilder()
    .setCustomId("peakSince2024")
    .setLabel("Peak Rank Since S2024")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g., P2, M153")
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(gamesInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(peakS2025Input),
    new ActionRowBuilder<TextInputBuilder>().addComponents(peakSince2024Input)
  );

  await interaction.showModal(modal);
  },
};
