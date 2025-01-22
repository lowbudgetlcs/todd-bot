import { GuildMemberRoleManager, SlashCommandBuilder } from "discord.js";
import { config } from "../config";

export const data = new SlashCommandBuilder()
  .setName("command-toggle")
  .setDescription("Switches Tournament Code Off");


export async function checkRole(roles: any) {
  for (var i = 0; i < config.ADMIN_ROLES.length; i++) {
    for (var j = 0; j < roles.length; j++) {
      if (config.ADMIN_ROLES[i] === roles[j].name) return true;
    }
  }
  return false;
}

export async function toggleCheck(interaction: any, commandToggle: boolean) {
  if (await checkRole(interaction.member?.roles)) {
          await interaction.reply({
            content: "Sorry, you aren't cool enough for this command.",
            ephemeral: true, // Ensure the response is only visible to the user
          });
          return false;
        }
        const reply = "Tournament Code Command Allowed: ";
        await interaction.reply({
          content: reply + !commandToggle,
          ephemeral: true, // Prevent spamming the channel with toggle updates
        });
        return true;
}
