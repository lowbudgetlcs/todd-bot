import {
  Client,
  Events,
  GatewayIntentBits,
  Collection,
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
import { getButtonHandler } from "./buttons/handlers.ts";
import log from 'loglevel';
import { handleModal } from "./modals/playerPoint.ts";
import { handleEventGroupSelect } from './commands/setEventGroup.ts';
import { getCurrentEventGroupId, loadState, setCurrentEventGroupId } from './state.ts';
import { runGuarded } from './interactionSafety.ts';

const logger =log.getLogger('index.ts');
logger.setLevel('info');

// Persisted to disk so a restart doesn't wipe the selected event group.
// /set-current-event still updates it live; this only changes where it survives.
loadState();

/**
 * A slow dennys call used to expire the Discord interaction token, and the
 * resulting Unknown interaction (10062) rejection killed the process. Keep the
 * bot alive and log instead - pm2 restarting is what lost the event group.
 */
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection (bot staying up):', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception (bot staying up):', error);
});

type ActionWrapper = {
  execute: (interaction: Interaction, currentEventGroupId: number | null) => Promise<void>;
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

  // TODO: We should make command for this, ticket already made
  deployCommands({ guildId: guild_id! }, commands);
});

client.on(Events.InteractionCreate, async interaction => {
  logger.info(`Current event group id: ${getCurrentEventGroupId()}`);

  if (interaction.isButton()) {
    logger.info(`Button interaction received with customId: ${interaction.customId}`);
    const data = parseButtonData(interaction.customId);
    const handler = getButtonHandler(data.tag);
    if (handler) {
      await runGuarded(interaction, `button:${data.tag}`, () => handler(interaction));
    }
    return;
  }

  if (interaction.isModalSubmit()) {
    logger.info(`Modal interaction received with customId: ${interaction.customId}`);
    await runGuarded(interaction, 'modal', () => handleModal(interaction));
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'select_event_group') {
    await runGuarded(interaction, 'select_event_group', async () => {
      await handleEventGroupSelect(interaction, { setCurrentEventGroupId });
      logger.info(`Current Event Group ID set to: ${getCurrentEventGroupId()}`);
    });
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    logger.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  await runGuarded(
    interaction,
    `command:${interaction.commandName}`,
    () => command.execute(interaction, getCurrentEventGroupId()),
    'There was an error while executing this command!',
  );
});

client.login(config.DISCORD_TOKEN);
