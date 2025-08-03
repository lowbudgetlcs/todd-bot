import { SlashCommandBuilder } from "discord.js";
// import { DatabaseUtil } from '../util';
module.exports = {
  data: new SlashCommandBuilder()
  .setName("division-reset")
  .setDescription("Grabs Updated Division Information"),
  async execute(interaction) {
    // await DatabaseUtil.Instance.populateDivisonsMap();
    await interaction.reply({
            content: "Divisions Have Been Updated"
    })
  }
}
