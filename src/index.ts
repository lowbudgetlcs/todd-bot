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
  GuildMember,
  RoleFlagsBitField,
} from "discord.js";
import { config } from "./config";

import { deployCommands } from "./deploy-commands";
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
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.ts'));

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
  await deployCommands({ guildId: guild_id! }, commands );
  let divisionsMap = dbUtil.divisionsMap;
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
    if (!await checkDbForPermissions(interaction, interaction.commandName))
    {
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

client.login(config.DISCORD_TOKEN);
