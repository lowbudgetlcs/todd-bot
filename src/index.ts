import {
  Client,
  Events,
  GatewayIntentBits,
  Collection,
  MessageFlags,
  ActivityType,
} from "discord.js";
import { config } from "./config";
// import {  handleDivisionSelect, handleGenerateTournamentCode, handleTeamSelect } from "./commands/tournnament";

import { deployCommands } from "./deploy-commands";
// import { checkRole, toggleCheck } from "./commands/commandToggle";
// import { handleDivisionSelectOpgg, handleOpggCommand, handleTeamSelectOpgg } from "./commands/opgg";
import { divisions } from "./db/schema";
import { db } from "./db/db";
import * as path from 'path';
import * as fs from 'fs';

type ActionWrapper = {
  execute: (interaction) => Promise<void>
}
class DiscordClient extends Client {
  commands: Collection<string, ActionWrapper> = new Collection;
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

const divisionsMap = new Map();

client.once("ready", async () => {
  console.log("Discord bot is ready! 🤖");
  client.user?.setPresence({ status: "online" });
  await deployCommands({ guildId: guild_id! });
  let data = await db.select().from(divisions);
  for (const division of data) {
    divisionsMap.set(division.id, division.name)
  };
  console.log(divisionsMap);
});

client.commands = new Collection();

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
	const commandsPath = path.join(foldersPath, folder);
	const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		const command = require(filePath);
		// Set a new item in the Collection with the key as the command name and the value as the exported module
		if ('data' in command && 'execute' in command) {
			client.commands.set(command.data.name, command);
		} else {
			console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
		}
	}
}


const channelId = process.env.CHANNEL_ID!;

client.on(Events.InteractionCreate, async interaction => {
	if (!interaction.isChatInputCommand()) return;

	const command = client.commands.get(interaction.commandName);

	if (!command) {
		console.error(`No command matching ${interaction.commandName} was found.`);
		return;
	}

	try {
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
//     if(interaction.commandName === "team-opgg"){
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