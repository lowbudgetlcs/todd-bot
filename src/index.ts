import {
  ActionRowBuilder,
  Client,
  Events,
  GatewayIntentBits,
  ModalActionRowComponentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActivityType,
  StringSelectMenuBuilder,
} from "discord.js";
import { config } from "./config";
import { execute, getTeamsByDivision } from "./commands/tournnament";

import { deployCommands } from "./deploy-commands";
import { checkRole } from "./commands/commandToggle";
import divisionMap from "./constants/constants";

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    "Guilds",
    "GuildMessages",
    "DirectMessages",
  ],
  presence: {
    activities: [
      {
        state: "Flipping pancakes at the Dennys",
        type: ActivityType.Custom,
        name: "Flipping pancakes at the Dennys",
      },
    ],
    status: "online",
  },
});

const userState = new Map();

const guild_id = process.env.GUILD_ID;
const channel_id = process.env.CHANNEL_ID;

var commandToggle = true;

client.once("ready", async () => {
  console.log("Discord bot is ready! 🤖");
  client.user?.setPresence({ status: "online" });
  await deployCommands({ guildId: guild_id! });
});

client.on("guildCreate", async (guild) => {
  console.log("deploy commands please");
});

client.on(Events.InteractionCreate, async (interaction) => {

  if (interaction.isChatInputCommand() && interaction.commandName == "command-toggle") {
    if (await checkRole(interaction.member?.roles)) {
      await interaction.reply({ content: "Sorry, you aren't cool enough for this command." });
      return;
    }
    var reply = "Tournament Code Command Allowed: ";
    commandToggle = !commandToggle;
    await interaction.reply({ content: reply + commandToggle });
    return;
  }

  if (
    interaction.isChatInputCommand() &&
    interaction.commandName == "generate-tournament-code" &&
    interaction.channelId == channel_id &&
    commandToggle
  ) {
    const divisionDropdown = new StringSelectMenuBuilder()
      .setCustomId("division_select")
      .setPlaceholder("Select a Division")
      .addOptions(
        Array.from(divisionMap.entries()).map(([key, value]) => ({
          label: value,
          value: key.toString(),
        }))
      );
    const divisionRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(divisionDropdown);

    await interaction.reply({
      content: "Please select a division:",
      components: [divisionRow],
      ephemeral: true,
    });

    return;
  } else if (interaction.isChatInputCommand() && (interaction.channelId != channel_id || !commandToggle)) {
    var commandCheck = commandToggle
      ? ": Please do not use this command <3."
      : ": This is Turned Off <3";
    interaction.reply({
      content: "Beep Boop, Beep Bop" + commandCheck,
      ephemeral: true,
    });
  }

  if (interaction.isStringSelectMenu()) {
    const { customId, values, user } = interaction;

    if (customId === "division_select") {
      const divisionKey = parseInt(values[0]);
      const divisionName = divisionMap.get(divisionKey);
      const teams = await getTeamsByDivision(divisionKey) || [];

      if (!(await teams).length) {
        await interaction.update({
          content: "No teams found for the selected division.",
          components: [],
        });
        return;
      }

      const team1Dropdown = new StringSelectMenuBuilder()
        .setCustomId("team1_select")
        .setPlaceholder("Select Team 1")
        .addOptions(teams.map((team) => ({ label: team.name, value: team.name })));

      const team2Dropdown = new StringSelectMenuBuilder()
        .setCustomId("team2_select")
        .setPlaceholder("Select Team 2")
        .addOptions(teams.map((team) => ({ label: team.name, value: team.name})));

      const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(team1Dropdown);
      const row2 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(team2Dropdown);

      // Store the state with teams and dropdowns
      userState.set(user.id, { divisionName, teams, team1: null, team2: null, row1, row2 });

      await interaction.update({
        content: `You selected the **${divisionName}** division. Now select your teams:`,
        components: [row1, row2],
      });
    } else if (customId === "team1_select" || customId === "team2_select") {
      const selectedTeam = values[0];
      const isTeam1 = customId === "team1_select";

      // Retrieve the saved state for this user
      const state = userState.get(user.id);
      if (!state) {
        await interaction.update({
          content: "Error: Unable to retrieve state. Please restart the interaction.",
          components: [],
        });
        return;
      }

      // Update the user's state with the selected team
      if (isTeam1) {
        state.team1 = selectedTeam;
      } else {
        state.team2 = selectedTeam;
      }

      const team1Dropdown = new StringSelectMenuBuilder()
        .setCustomId("team1_select")
        .setPlaceholder("Select Team 1")
        .addOptions(
          state.teams.map((team: { name: any; }) => ({
            label: team.name,
            value: team.name,
            default: state.team1 === team.name // Mark selected team as default
          }))
        );

      const team2Dropdown = new StringSelectMenuBuilder()
        .setCustomId("team2_select")
        .setPlaceholder("Select Team 2")
        .addOptions(
          state.teams.map((team: { name: any; }) => ({
            label: team.name,
            value: team.name,
            default: state.team2 === team.name // Mark selected team as default
          }))
        );

      const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(team1Dropdown);
      const row2 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(team2Dropdown);

      // Update message content without changing the dropdown components
      if(!(state.team1 && state.team2)){
        const content = `You selected **${state.team1 || "Team 1 not selected"}** for Team 1 and **${state.team2 || "Team 2 not selected"}** for Team 2.`;
        await interaction.update({
          content,
          components: [row1, row2], // Keep the dropdowns intact
        });
      }

      // If both teams are selected, call the execute function
      if (state.team1 && state.team2) {
        try {
          const tournamentCode = await execute(state.team1, state.team2, interaction);
          // Notify the user with the final selection and tournament code
          const response = tournamentCode.error.length>0? tournamentCode.error : tournamentCode.discordResponse;
          if (tournamentCode.error.length > 0) {
            // If there's an error, update the interaction with an ephemeral response
            await interaction.update({
              content: response,
              components: [], // Remove dropdowns 
            });
          } else {
            // If no error, defer the reply if not already done
            if (!interaction.replied && !interaction.deferred) {
              await interaction.deferReply(); // Defer the reply if not already done
            }
      
            // Send a non-ephemeral follow-up with the successful response
            await interaction.followUp({
              content: response,
              ephemeral: false, // This is the new, non-ephemeral message
            });
          }
          userState.delete(user.id);
        } catch (error) {
          console.error(error);
          await interaction.update({
            content: "An error occurred while generating the tournament code. Please try again later.",
            components: [],
          });
        }
      }
    }
  }
});




client.login(config.DISCORD_TOKEN);

function useState(arg0: boolean): {
  commandToggle: any;
  setCommandToggle: any;
} {
  throw new Error("Function not implemented.");
}
// function useState(arg0: boolean): { commandToggle: any; setCommandToggle: any; } {
// 	throw new Error('Function not implemented.');
// }
