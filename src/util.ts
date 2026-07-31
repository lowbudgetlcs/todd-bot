import { CacheType, GuildMember, Interaction } from 'discord.js';
import { config } from './config.ts';
import { fetchWithRetry } from './http.ts';
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
  const member: GuildMember = interaction.member as GuildMember;
  // member.roles.cache.each(x => {
  //   console.log(`Role name=${x.name}, role id=${x.id}`);
  // });
  return member.roles.cache.map(role => role.id);
}

// Discord rejects thread names longer than this with Invalid Form Body.
const THREAD_NAME_MAX = 100;

/**
 * Truncates by code point so we never slice a surrogate pair in half and leave
 * a lone surrogate in the name.
 */
function truncateChars(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  return chars.slice(0, Math.max(0, max - 1)).join('').trimEnd() + '…';
}

/**
 * Builds the series thread name, trimming the team names (never the date) so the
 * result always fits Discord's 100 character limit.
 *
 * Without this a pair of long team names throws Invalid Form Body from
 * startThread(), after the public message has already been posted.
 */
export function buildThreadName(
  blueTeamName: string,
  redTeamName: string,
  dateString: string,
): string {
  const suffix = ` - ${dateString}`;
  const full = `${blueTeamName} vs ${redTeamName}${suffix}`;
  if (Array.from(full).length <= THREAD_NAME_MAX) return full;

  // Split whatever is left after " vs " and the date evenly between the teams.
  const budget = THREAD_NAME_MAX - Array.from(suffix).length - ' vs '.length;
  const perTeam = Math.floor(budget / 2);
  const blue = truncateChars(blueTeamName, perTeam);
  const red = truncateChars(redTeamName, budget - Array.from(blue).length);
  return `${blue} vs ${red}${suffix}`;
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
  totalGames: number
): Promise<string> {

  const endpoint = '/createFearlessDraft';
  const url = config.LOWBUDGETLCS_BACKEND_URL + endpoint;
  const errorString = 'Error generating draft links! Please do so manually :)';
  const payload = {
    team1Name: blueTeamName,
    team2Name: redTeamName,
    tournamentID: tournamentCode,
    draftCount: totalGames
  };
  try {
    logger.info(`Hitting URL: ${url} with payload: ${JSON.stringify(payload)}`);
    const response = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
      { label: 'createFearlessDraft', retries: 0 },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => '(unreadable)');
      logger.error(`createFearlessDraft [${response.status}]: ${body}`);
      return errorString;
    }

    const data = await response.json();
    const { fearlessCode, team1Code, team2Code } = data;

    return (
      `[${blueTeamName} Link](${config.LOWBUDGETLCS_DRAFT_URL}/fearless/${fearlessCode}/${team1Code})\n` +
      `\`\`\`${config.LOWBUDGETLCS_DRAFT_URL}/fearless/${fearlessCode}/${team1Code}\`\`\`\n`+
      `[${redTeamName} Link](${config.LOWBUDGETLCS_DRAFT_URL}/fearless/${fearlessCode}/${team2Code})\n` +
      `\`\`\`${config.LOWBUDGETLCS_DRAFT_URL}/fearless/${fearlessCode}/${team2Code}\`\`\`\n`+
      `[Spectator Link](${config.LOWBUDGETLCS_DRAFT_URL}/fearless/${fearlessCode}/spectator)\n` +
      `\`\`\`${config.LOWBUDGETLCS_DRAFT_URL}/fearless/${fearlessCode}/spectator\`\`\`\n`+
      `[Stream Link](${config.LOWBUDGETLCS_DRAFT_URL}/fearless/${fearlessCode}/stream})\n` +
      `\`\`\`${config.LOWBUDGETLCS_DRAFT_URL}/fearless/${fearlessCode}/stream\`\`\``);
  } catch (error) {
    console.error('Error hitting URL:', error);
    return errorString;
  }
}
