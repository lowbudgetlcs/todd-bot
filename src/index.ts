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
import { getButtonHandler } from "./buttons/buttonHandler";

import { deployCommands } from "./deploy-commands";

import * as path from 'path';
import * as fs from 'fs';
import { command as tournamentCommand } from "./commands/tournament";
import { parseButtonData } from "./buttons/button";

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
const commands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = []

// Populate commands property of the Client, currently only works for commands/ and not subfolders cuz not needed
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.ts') || file.endsWith('js'));
let command: CommandFileExport;

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  let command: CommandFileExport; 
  if(file=="tournament.ts") {
    command = tournamentCommand as CommandFileExport;
  } else {
    command = require(filePath) as CommandFileExport;
  }
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
  deployCommands({ guildId: guild_id! }, commands);

  // We should grab events from API HERE :D
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isButton()) {
    const data = parseButtonData(interaction.customId);
    const handler = getButtonHandler(data.tag);
    if (handler != null && handler != undefined) await handler(interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }
  // Base command / single command
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

client.login(config.DISCORD_TOKEN);
