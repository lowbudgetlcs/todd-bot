import { GuildMemberRoleManager, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { db } from "../db/db";
import { commandRolePermissions } from "../db/schema";
import { eq } from "drizzle-orm";
import { config } from "../config"

// TODO: this should probably be dynamic, whatever
const tourneyCodeCommand = "generate-tournament-code"

module.exports = {
  data: new SlashCommandBuilder()
  .setName("command-toggle")
  .setDescription("Switches Tournament Code Off")
  // TODO: Confirm base level of permission 
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    let data = await db.select().from(commandRolePermissions).where(eq(commandRolePermissions.name, tourneyCodeCommand));
    var enabledForCaptains = data.length > config.ADMIN_ROLE_IDS.length
    console.log(`Detected that ${tourneyCodeCommand} is ${enabledForCaptains ? "enabled for captains" : "admins only"}`);
    // If the row exists, then the command is enabled
    if (enabledForCaptains)
    {
      try{
        await db.transaction(async (tx) =>
          {
            await tx.delete(commandRolePermissions).where(eq(commandRolePermissions.name, tourneyCodeCommand));
            config.ADMIN_ROLE_IDS.forEach(async (role) =>
              {
                await tx.insert(commandRolePermissions).values({name: tourneyCodeCommand, roleId: +role})
              })
          })
        
      } catch (error) {
        await interaction.reply({
          content: "There was an error configuring this command. Please contact @Dev Team",
          flags: "Ephemeral"
        });
        return;
      }
      
    }else {
      try {
        db.insert(commandRolePermissions).values( {name: tourneyCodeCommand, roleId: +config.CAPTAIN_ROLE_ID })
      } catch (error) {
        await interaction.reply({
          content: "There was an error configuring this command. Please contact @Dev Team",
          flags: "Ephemeral"
        });
        return;
      }
    }
    const reply = "Tournament Code Command Allowed: " + !enabledForCaptains;
    await interaction.reply({
      content: reply,
      flags: "Ephemeral",// Prevent spamming the channel with toggle updates
    });
  }
}