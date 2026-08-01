import { REST, Routes, RESTPostAPIChatInputApplicationCommandsJSONBody, APIApplication, APIApplicationCommand } from 'discord.js';
import { config } from './config.ts';
import log from 'loglevel';

const logger =log.getLogger('deploy-commands');
logger.setLevel('info');

const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN!);

type DeployCommandsProps = {
  guildId: string;
};

export async function deployCommands(
  { guildId }: DeployCommandsProps,
  commands: RESTPostAPIChatInputApplicationCommandsJSONBody[],
) {
  try {
    // This bot is guild-scoped only; delete any lingering GLOBAL commands so
    // they don't shadow the guild set.
    const oldGlobals = (await rest.get(
      Routes.applicationCommands(config.DISCORD_CLIENT_ID!),
    )) as APIApplicationCommand[];
    for (const cmd of oldGlobals) {
      await rest.delete(Routes.applicationCommand(config.DISCORD_CLIENT_ID!, cmd.id));
    }

    logger.info('Refreshing guild (/) commands.');
    // A single bulk overwrite. Discord matches by name: existing commands are
    // updated in place and KEEP their command ID, missing ones are removed, new
    // ones created. Preserving the IDs is what keeps server-side command
    // permissions (Server Settings -> Integrations, e.g. the staff-only gate on
    // /set-current-event) alive across redeploys. Do NOT clear the guild set to
    // [] first: that deletes the IDs and silently wipes those permissions on
    // every boot.
    await rest.put(Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID!, guildId), {
      body: commands,
    });
    logger.info('Successfully reloaded guild (/) commands.');
  } catch (error) {
    console.error(error);
  }
}
