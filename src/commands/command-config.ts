import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType  } from "discord.js";

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
  )
  // TODO: get feedback of how this is actually used, might want to rethink this setup
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
    option.setName("enable")
    .setDescription("Enable the command.")
  )
  .addBooleanOption(option =>
    option.setName("disable")
    .setDescription("Disable the command.")
  )
  // We have our own permission system but we probably don't want to show this to the average user
  // TODO: Confirm base level of permission 
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setContexts(InteractionContextType.Guild),
  async execute(interaction) {
    const reply = Math.random() >= 0.5 ? "Heads!" : "Tails!";
    await interaction.reply({
        content: reply
    })
  }
}