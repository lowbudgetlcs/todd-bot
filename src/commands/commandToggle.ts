import { GuildMemberRoleManager, SlashCommandBuilder } from "discord.js";

module.exports = {
  data: new SlashCommandBuilder()
  .setName("command-toggle")
  .setDescription("Switches Tournament Code Off"),
  async execute(interaction) {
    // TODO: query database for tournament code value and alter it such that the captain role is removed
    const reply = "Tournament Code Command Allowed: ";
        await interaction.reply({
          content: reply,
          ephemeral: true, // Prevent spamming the channel with toggle updates
        });
  }
}