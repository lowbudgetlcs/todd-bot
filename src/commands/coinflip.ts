import { SlashCommandBuilder } from "discord.js";

module.exports = {
  data: new SlashCommandBuilder()
  .setName("coinflip")
  .setDescription("Flip a coin"),
  async execute(interaction) {
    const reply = "Landed on " + (Math.random() >= 0.5 ? "heads!" : "tails!");
    await interaction.reply({
        content: reply
    })
  }
}