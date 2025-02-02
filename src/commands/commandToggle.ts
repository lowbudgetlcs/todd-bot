import { GuildMemberRoleManager, SlashCommandBuilder } from "discord.js";
import { db } from "../db/db";
import { commandRolePermissions } from "../db/schema";
import { eq } from "drizzle-orm";

module.exports = {
  data: new SlashCommandBuilder()
  .setName("command-toggle")
  .setDescription("Switches Tournament Code Off"),
  async execute(interaction) {
    // TODO: need to populate this table with data
    let data = await db.select().from(commandRolePermissions).where(eq(commandRolePermissions.name, "generate-tournament-code"));
    console.log("hello", data);
    // If the row exists, then the command is enabled
    if (data)
    {
      db.delete(commandRolePermissions).where(eq(commandRolePermissions.name, "generate-tournament-code"));
    }else {
      // TODO: dynamically find the captain role or store it somewhere or something
      // TODO: alternatively we can make this interactive and just pass in the role as an option or smth
      db.insert(commandRolePermissions).values( {name: "generate-tournament-code", roleId: 123 })
    }
    // TODO: query database for tournament code value and alter it such that the captain role is removed
    const reply = "Tournament Code Command Allowed: " + data == null;
        await interaction.reply({
          content: reply,
          flags: "Ephemeral",// Prevent spamming the channel with toggle updates
        });
  }
}