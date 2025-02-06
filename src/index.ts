import {
  Client,
  Events,
  GatewayIntentBits,
  Collection,
  MessageFlags,
  ActivityType,
  Interaction,
  SlashCommandBuilder,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import { config } from "./config";
// import {  handleDivisionSelect, handleGenerateTournamentCode, handleTeamSelect } from "./commands/tournnament";

import { deployCommands } from "./deploy-commands";
// import { checkRole, toggleCheck } from "./commands/commandToggle";
// import { handleDivisionSelectOpgg, handleOpggCommand, handleTeamSelectOpgg } from "./commands/opgg";
// import { divisions } from "./db/schema";
// import { db } from "./db/db";
import { DatabaseUtil, checkDbForPermissions } from "./util";
import * as path from 'path';
import * as fs from 'fs';

// We'll just do this first to initialize it since we'll need it around ;p
let dbUtil = DatabaseUtil.Instance;

type ActionWrapper = {
  execute: (interaction: Interaction) => Promise<void>
}
class DiscordClient extends Client {
  commands: Collection<string, ActionWrapper> = new Collection;
}

type CommandFileExport = {
  data: SlashCommandBuilder,
  execute: (interaction: Interaction) => Promise<void>
}

// Create a new client instance
const client = new DiscordClient({
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

// For sending to discord to register commands I don't know how to make this not look like garbo
const commands : RESTPostAPIChatInputApplicationCommandsJSONBody[] = []

// Populate commands property of the Client, currently only works for commands/ and not subfolders cuz not needed
const commandsPath = path.join(__dirname, 'commands');
console.log(commandsPath)
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command : CommandFileExport =  require(filePath);
  // Set a new item in the Collection with the key as the command name and the value as the exported module
  if ('data' in command && 'execute' in command) {
    commands.push(command.data.toJSON())
    client.commands.set(command.data.name, command);
  } else {
    console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
  }
}

client.once("ready", async () => {
  console.log("Discord bot is ready! 🤖");
  client.user?.setPresence({ status: "online" });
  // await deployCommands({ guildId: guild_id! }, commands );
  let divisionsMap = dbUtil.divisionsMap;
  console.log(divisionsMap);
});

const channelId = process.env.CHANNEL_ID!;

client.on(Events.InteractionCreate, async interaction => {
	if (!interaction.isChatInputCommand()) return;

	const command = client.commands.get(interaction.commandName);

	if (!command) {
		console.error(`No command matching ${interaction.commandName} was found.`);
		return;
	}
  // Base command / single command
	try {
    // TODO: actually need to test this lol
    if (!await checkDbForPermissions(interaction, interaction.commandName))
    {
      await interaction.reply({
        content: "Sorry, you aren't cool enough for this command.",
        ephemeral: true,
      });
      return;
    }
		await command.execute(interaction);
	} catch (error) {
		console.error(error);
		if (interaction.replied || interaction.deferred) {
			await interaction.followUp({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
		} else {
			await interaction.reply({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
		}
	}
});


// client.on(Events.InteractionCreate, async (interaction) => {


//   console.log(interaction);
//   if (interaction.isChatInputCommand()) {
//     if(interaction.commandName === "generate-tournament-code"){
//       await handleGenerateTournamentCode(interaction, channelId, commandToggle, divisionsMap);
//     }
//     if (interaction.isChatInputCommand() && interaction.commandName === "command-toggle") {
//       if(await toggleCheck(interaction, commandToggle)) {
//         commandToggle = !commandToggle;
//       }
//     }
//     if(interactioninteraction.commandName === "team-opgg"){
//       await handleOpggCommand(interaction, channelId, commandToggle, divisionsMap);
//     }
//   }
//   if (interaction.isStringSelectMenu()) {
//     if (interaction.customId === "division_select") {
//       await handleDivisionSelect(interaction, divisionsMap);
//     } else if (["team1_select", "team2_select"].includes(interaction.customId)) {
//       await handleTeamSelect(interaction, divisionsMap);
//     } else if (interaction.customId === "division_select_opgg") {
//       await handleDivisionSelectOpgg(interaction, divisionsMap);
//     } else if (interaction.customId === "team_select_opgg") {
//       await handleTeamSelectOpgg(interaction);
//     }
//   }
// });

client.login(config.DISCORD_TOKEN);