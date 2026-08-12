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
import { refuseIfSeriesLocked } from "./buttons/seriesLock.ts";
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

/**
 * An uncaught exception is different: it means a synchronous call stack was
 * abandoned partway through, so module state may be inconsistent and there is
 * no way to know what didn't finish. Continuing from that is guesswork, so log
 * and exit - pm2-runtime restarts us with a clean process.
 *
 * Exiting used to be what lost the selected event group, which is why this
 * handler originally swallowed everything. state.ts persists it now, so a
 * restart is cheap and that reason no longer applies.
 */
let exiting = false;
process.on('uncaughtException', error => {
  if (exiting) return;
  exiting = true;
  logger.error('Uncaught exception - exiting so pm2 can restart cleanly:', error);
  // Under Docker stderr is a pipe, so Node writes it asynchronously. Exiting on
  // this tick can truncate the very stack trace we need, so give it one beat.
  setTimeout(() => process.exit(1), 100);
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
// This reads the *built* output (dist/commands/*.js), never src/. There is no
// TypeScript runtime path - the only way to run the bot is to build it first.
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));


for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  // Deliberate: commands are discovered at runtime, so this path is not statically known.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
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

  // deployCommands deletes every existing command before re-registering, so
  // handing it an empty array unregisters the bot entirely. If the loader found
  // nothing that is a bug in this build, not an instruction to wipe the guild.
  if (commands.length === 0) {
    logger.error(
      `No commands loaded from ${commandsPath} - skipping deploy so the existing registrations survive.`,
    );
    return;
  }

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
      await runGuarded(interaction, `button:${data.tag}`, async () => {
        // Before the handler, and inside the guard: a series that has run away
        // with codes stops here rather than in each handler separately.
        if (await refuseIfSeriesLocked(interaction, data.tag, data.seriesData.seriesId)) return;
        await handler(interaction);
      });
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
