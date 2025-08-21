import { CacheType, GuildMember, Interaction } from 'discord.js';
import { config } from './config';

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
  // TODO: fearless?
  return 'https://example.com'; // Placeholder for actual URL generation logic
  const endpoint = '/createDraft';
  const url = config.LOWBUDGETLCS_BACKEND_URL + endpoint;
  const errorString = 'Error generating draft links! Please do so manually :)';
  const payload = {
    blueName: blueTeamName,
    redName: redTeamName,
    tournamentId: tournamentCode,
  };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      // TODO: log
      return errorString;
    }

    const data = await response.json();
    const { lobbyCode, blueCode, redCode } = data.draft;

    /// QUICK MARKDOWN EXPLANATION!
    /// HYPERLINK EXAMPLE: [a](b) | a will be displayed, b will be the link TO
    /// NO EMBED EXAMPLE: <a> | a is a link, will not show embeds in Discord.
    /// COMBINED we get a hyperlink with no embed! [a](<b>)
    return (
      `[Blue Team Draft Link](<${config.LOWBUDGETLCS_DRAFT_URL}/${lobbyCode}/${blueCode}>)\n` +
      `[Red Team Draft Link](<${config.LOWBUDGETLCS_DRAFT_URL}/${lobbyCode}/${redCode}>)\n` +
      `[Spectator Draft Link](<${config.LOWBUDGETLCS_DRAFT_URL}/${lobbyCode}>)`
    );
  } catch (error) {
    console.error('Error hitting URL:', error);
    return errorString;
  }
}
