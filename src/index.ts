import {
  Client,
  Events,
  GatewayIntentBits,
  ActivityType,
} from "discord.js";
import { config } from "./config";
import {  handleDivisionSelect, handleGenerateTournamentCode, handleTeamSelect } from "./commands/tournnament";

import { deployCommands } from "./deploy-commands";
import { checkRole, toggleCheck } from "./commands/commandToggle";
import { handleDivisionSelectOpgg, handleOpggCommand, handleTeamSelectOpgg } from "./commands/opgg";

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

const guild_id = process.env.GUILD_ID;

var commandToggle = true;

client.once("ready", async () => {
  console.log("Discord bot is ready! 🤖");
  client.user?.setPresence({ status: "online" });
  await deployCommands({ guildId: guild_id! });
});

client.on("guildCreate", async (guild) => {
  console.log("deploy commands please");
});

const channelId = process.env.CHANNEL_ID!;

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if(interaction.commandName === "generate-tournament-code"){
      await handleGenerateTournamentCode(interaction, channelId, commandToggle);
    }
    if (interaction.isChatInputCommand() && interaction.commandName === "command-toggle") {
      if(await toggleCheck(interaction, commandToggle)) {
        commandToggle = !commandToggle;
      }
    }
    if(interaction.commandName === "team-opgg"){
      await handleOpggCommand(interaction, channelId, commandToggle);
    }
  }
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "division_select") {
      await handleDivisionSelect(interaction);
    } else if (["team1_select", "team2_select"].includes(interaction.customId)) {
      await handleTeamSelect(interaction);
    } else if (interaction.customId === "division_select_opgg") {
      await handleDivisionSelectOpgg(interaction);
    } else if (interaction.customId === "team_select_opgg") {
      await handleTeamSelectOpgg(interaction);
    }
  }
});

client.login(config.DISCORD_TOKEN);