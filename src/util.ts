import { CacheType, GuildMember, Interaction } from 'discord.js';
import { config } from './config.ts';
import log from 'loglevel';

const logger =log.getLogger('utils');
logger.setLevel('info');
/**
 * Parses an interaction to get the user roles.
 * @returns collection of role ids.
 */
function getUserRoles(interaction: Interaction<CacheType>) {
  // THIS IS NOT THE RIGHT THING TO DO PROBABLY
  // I DON'T UNDERSTAND WHY THE COMPILER REFUSES TO THINK
  // THAT BECAUSE THIS TYPE IS A UNION OF OTHER TYPES
  // THAT GUILDMEMBER PROPERTIES AREN'T AVAILABLE TO USE ????
  // TODO: understand how to code
  let member: GuildMember = interaction.member as GuildMember;
  // member.roles.cache.each(x => {
  //   console.log(`Role name=${x.name}, role id=${x.id}`);
  // });
  return member.roles.cache.map(role => role.id);
}

/**
 * Calls LowBudgetLCS backend to create draft links in a markdown string.
 *
 * @returns markdown string with the links OR a string indicating an error has occurred.
 */
export async function getDraftLinksMarkdown(
  blueTeamName: string,
  redTeamName: string,
  tournamentCode: string,
): Promise<string> {

  const endpoint = '/createFearlessDraft';
  const url = config.LOWBUDGETLCS_BACKEND_URL + endpoint;
  const errorString = 'Error generating draft links! Please do so manually :)';
  const payload = {
    team1Name: blueTeamName,
    team2Name: redTeamName,
    tournamentID: tournamentCode,
    draftCount: 3
  };
  try {
    logger.info(`Hitting URL: ${url} with payload: ${JSON.stringify(payload)}`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      // TODO: log
      logger.info(`Error Reponse: ${response}`);
      return errorString;
    }

    const data = await response.json();
    const { fearlessCode, team1Code, team2Code } = data;

    return (
      `[${blueTeamName} Link](${config.LOWBUDGETLCS_DRAFT_URL}/fearless/${fearlessCode}/${team1Code})\n` +
      `\`\`\`${config.LOWBUDGETLCS_DRAFT_URL}/fearless/${fearlessCode}/${team1Code}\`\`\`\n`+
      `[${redTeamName} Link](${config.LOWBUDGETLCS_DRAFT_URL}/fearless/${fearlessCode}/${team2Code})\n` +
      `\`\`\`${config.LOWBUDGETLCS_DRAFT_URL}/fearless/${fearlessCode}/${team2Code}\`\`\`\n`+
      `[Spectator Link](${config.LOWBUDGETLCS_DRAFT_URL}/fearless/${fearlessCode}/specator)\n` +
      `\`\`\`${config.LOWBUDGETLCS_DRAFT_URL}/fearless/${fearlessCode}/spectator\`\`\`\n`+
      `[Stream Link](${config.LOWBUDGETLCS_DRAFT_URL}/fearless/${fearlessCode}/stream})\n` +
      `\`\`\`${config.LOWBUDGETLCS_DRAFT_URL}/fearless/${fearlessCode}/stream\`\`\``);
  } catch (error) {
    console.error('Error hitting URL:', error);
    return errorString;
  }
}
