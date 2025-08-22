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
} from 'discord.js';
import { config } from './config';

import { deployCommands } from './deploy-commands';

import * as path from 'path';
import * as fs from 'fs';
import { parseButtonData } from "./buttons/button";
import { getButtonHandler } from "./buttons/handlers/handlers";
import log from 'loglevel';

const logger =log.getLogger('index.ts');
logger.setLevel('info');

type ActionWrapper = {
  execute: (interaction: Interaction) => Promise<void>;
};
class DiscordClient extends Client {
  commands: Collection<string, ActionWrapper> = new Collection();
}

type CommandFileExport = {
  data: SlashCommandBuilder;
  execute: (interaction: Interaction) => Promise<void>;
};

// Create a new client instance
const client = new DiscordClient({
  intents: [GatewayIntentBits.Guilds, 'Guilds', 'GuildMessages', 'DirectMessages'],
  presence: {
    activities: [
      {
        state: 'Flipping pancakes at the Dennys',
        type: ActivityType.Custom,
        name: 'Flipping pancakes at the Dennys',
      },
    ],
    status: 'online',
  },
});

const guild_id = process.env.GUILD_ID;

// For sending to discord to register commands I don't know how to make this not look like garbo
const commands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [];

// Populate commands property of the Client, currently only works for commands/ and not subfolders cuz not needed
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter(file => file.endsWith('.js'));


for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);

  const imported = require(filePath);
  const command = imported?.default ?? imported;
  if ('data' in command && 'execute' in command) {
    logger.info(`Loading command from ${filePath}`);
  commands.push(command.data.toJSON());
    client.commands.set(command.data.name, command);
  } else {
    logger.error(`Failed command: ${JSON.stringify(command)}`);
  }
}

client.once('ready', async () => {
  logger.info('Discord bot is ready! 🤖');
  client.user?.setPresence({ status: 'online' });
  deployCommands({ guildId: guild_id! }, commands);

  // We should grab events from API HERE :D
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isButton()) {
    logger.info(`Button interaction received with customId: ${interaction.customId}`);
    const data = parseButtonData(interaction.customId);
    const handler = getButtonHandler(data.tag);
    if (handler != null && handler != undefined) await handler(interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    logger.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }
  // Base command / single command
  try {
    await command.execute(interaction);
  } catch (error) {
    logger.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: 'There was an error while executing this command!',
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.reply({
        content: 'There was an error while executing this command!',
        flags: MessageFlags.Ephemeral,
      });
    }
  }
});

client.login(config.DISCORD_TOKEN);
