import { SlashCommandBuilder } from "discord.js";

module.exports = {
  data: new SlashCommandBuilder()
  .setName("coinflip")
  .setDescription("Flip a coin"),
  async execute(interaction) {
    const reply = Math.random() >= 0.5 ? "Heads!" : "Tails!";
    await interaction.reply({
        content: reply
    })
  }
}
