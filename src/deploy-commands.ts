import { REST, Routes, RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
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
    logger.info('Started refreshing application (/) commands.');
    await rest.put(Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID!, guildId), {
      body: [],
    });
    logger.info('Successfully deleted guild commands');
    await rest.put(Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID!, guildId), {
      body: commands,
    });
    logger.info('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
}
