import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, CacheType, Interaction, Channel, Role  } from "discord.js";
import { db } from "../db/db";
import { commandChannelPermissions, commandRolePermissions } from "../db/schema";
import { and, eq } from "drizzle-orm";


const genericErrorMessage = "Something went wrong with the database operation! Please contact the dev team with any context.";
module.exports = {
  data: new SlashCommandBuilder()
  .setName("command-config")
  .setDescription("Configure a command's role and channel permissions")
  // TODO: add autocomplete for the string options
  // https://discordjs.guide/slash-commands/autocomplete.html#responding-to-autocomplete-interactions
  .addStringOption(option =>
    option.setName("command")
    .setDescription("The command to configure")
    .setRequired(true)
    .addChoices(
      // TODO: make this dynamic, I CBA doing this right now. Sorry!
      { name: "command-config", value: "config"},
      { name: "coinflip", value: "coinflip"},
      { name: "command-toggle", value: "toggle"},
      { name: "generate-tournament-code", value: "tournament"},
      { name: "opgg", value: "opgg"},
    )
  )
  // TODO: get feedback of how this is actually used, might want to rethink this setup
  // TODO: could use a subcommand
  // https://discordjs.guide/slash-commands/advanced-creation.html#localizations
  .addChannelOption(option =>
    option.setName("channel")
    .setDescription("A discord channel for the command to be enabled or disabled for")
    .setRequired(false)
  )
  .addRoleOption(option =>
    option.setName("role")
    .setDescription("A discord role for the command to be enabled or disabled for")
    .setRequired(false)
  )
  .addBooleanOption(option =>
    option.setName("restrict")
    .setDescription("Restrict the command to not be available in selected channel and/or the selected role.")
  )
  .addBooleanOption(option =>
    option.setName("unrestrict")
    .setDescription("Unrestrict the command to be available in selected channel and/or the selected role.")
  )
  // We have our own permission system but we probably don't want to show this to the average user
  // TODO: Confirm base level of permission 
  // .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setContexts(InteractionContextType.Guild),
  async execute(interaction) {
    const command : string = interaction.options.getString('command');
    const channel : Channel | null = interaction.options.getChannel('channel');
    const role : Role | null = interaction.options.getRole('role');
    const restrict : boolean = interaction.options.getBoolean('enable') ?? false;
    const unrestrict : boolean = interaction.options.getBoolean('disable') ?? false;
    let reply = `Permissions for ${command} has been updated!`;
    if (restrict && unrestrict)
    {
      await interaction.reply({
        content: "This does not make sense! Please retry with a valid command that does not enable and disable"
      })
    } else if (restrict)
    {
      try {
        await db.transaction(async (tx) => {
          if (channel != null)
          {
            await tx.delete(commandChannelPermissions).where(
              and(
                eq(commandChannelPermissions.name, command),
                eq(commandChannelPermissions.channelId, +channel.id)));
          }
          if (role != null)
          {
            await tx.delete(commandRolePermissions).where(
              and(
                eq(commandRolePermissions.name, role.name),
                eq(commandRolePermissions.roleId, +role.id)));
          }
        });
      } catch (error: any) {
        // TODO: this is where we should log this out in an audit channel or log collector
        // if we are chill like that
        await interaction.reply({
          content: genericErrorMessage
      });
      return;
      }
    } else if (unrestrict)
    {
      try {
        await db.transaction(async (tx) => {
          if (channel != null)
          {
            await tx.insert(commandChannelPermissions).values({
              name: command, channelId: +channel.id
            });
          }
          if (role != null)
          {
            await tx.insert(commandRolePermissions).values({
              name: command, roleId: +role.id
            });
          }
        });
      } catch (error: any) {
        // TODO: this is where we should log this out in an audit channel or log collector
        // if we are chill like that
        await interaction.reply({
          content: genericErrorMessage
        })
        return;
      }
    }
    else
    {
      reply = "Please make sure to either restrict or unrestrict something :)"
    }

    await interaction.reply({
        content: reply
    })
  }
}