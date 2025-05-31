import { eq } from "drizzle-orm/sql";
import { db } from "./db/db";
import {
  commandChannelPermissions,
  commandRolePermissions,
  divisions,
  teams,
} from "./db/schema";
import { CacheType, GuildMember, Interaction } from "discord.js";
import { channel } from "diagnostics_channel";
import { config } from "./config";

type DivisionsMap = Map<number, string>;

// //https://stackoverflow.com/questions/42761189/implementing-lazyt-in-typescript
// function lazy<T>(factory: () => NonNullable<T>) {
//   let value: T | undefined;
//   return () => value ?? (value = factory());
// }

/**
 * Class for some database queries that should be shared between classes.
 *
 */
export class DatabaseUtil {
  private static _instance: DatabaseUtil = new DatabaseUtil();
  /**
   * Cached version of the division map
   * @returns Divions map of the id and the division name
   */
  public divisionsMap!: DivisionsMap;

  private constructor() {
    if (DatabaseUtil._instance) {
      throw new Error("Use DatabaseUtil.instance instead of new.");
    }
    DatabaseUtil._instance = this;
    this.populateDivisonsMap();
  }

  public static get Instance() {
    return (
      DatabaseUtil._instance ?? (DatabaseUtil._instance = new DatabaseUtil())
    );
  }

  public async populateDivisonsMap() {
    this.divisionsMap = new Map();
    let data = await db.select().from(divisions);
    for (const division of data) {
      this.divisionsMap.set(division.id, division.name);
    }
  }
}

export async function getTeamsByDivision(division: number) {
  let data = await db
    .select()
    .from(teams)
    .where(eq(teams.divisionId, division));
  return data;
}

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
  return member.roles.cache.map((role) => role.id);
}

/**
 * Calls the db to check if the command is good to execute.
 * By default if there are no rows in the role / channel permissions, commands are good to go.
 * Checks both role + channel perms, must need both to execute.
 * @returns command is good to execute
 */
export async function checkDbForPermissions(
  interaction: Interaction,
  commandName: string
) {
  let roleAllowed = false;
  let channelAllowed = false;
  // i don't know how joins work so we will live with 2 queries
  // TODO: cache these results, maybe like every 5 minutes?
  // excluding some commands maybe api dependant ones so we don't get abusers?
  let rolesToCheck = await db
    .select()
    .from(commandRolePermissions)
    .where(eq(commandRolePermissions.name, commandName));
  let channelsToCheck = await db
    .select()
    .from(commandChannelPermissions)
    .where(eq(commandChannelPermissions.name, commandName));

  if (rolesToCheck.length > 0) {
    let roleIds = rolesToCheck.map((x) => x.roleId);
    const member = interaction.member as GuildMember;
    roleAllowed = member.roles.cache.some((role) => roleIds.includes(role.id));
  } else {
    roleAllowed = true;
  }

  if (channelsToCheck.length > 0) {
    let channelIds = channelsToCheck.map((x) => x.channelId);
    const messageChannel = interaction.channelId ?? "";
    if (channelIds.includes(messageChannel)) {
      channelAllowed = true;
    }
  } else {
    channelAllowed = true;
  }
  if (!roleAllowed && !channelAllowed) {
    await interaction.reply({
      content:
        "Sorry, you can't run this command with your roles and in this channel!",
      flags: "Ephemeral",
    });
  } else if (!roleAllowed) {
    await interaction.reply({
      content: "Sorry, you aren't cool enough for this command.",
      flags: "Ephemeral",
    });
  } else if (!channelAllowed) {
    await interaction.reply({
      content: "Sorry, you can't run that in this channel!",
      flags: "Ephemeral",
    });
  }

  return roleAllowed && channelAllowed;
}

/**
 * Calls LowBudgetLCS backend to create draft links in a markdown string.
 *
 * @returns markdown string with the links OR a string indicating an error has occurred.
 */
export async function getDraftLinksMarkdown(blueTeamName: string, redTeamName: string, tournamentCode: string, ): Promise<string>
{
  // TODO: fearless?
  const endpoint = "/createDraft"
  const url = config.LOWBUDGETLCS_BACKEND_URL + endpoint;
  const errorString = "Error generating draft links! Please do so manually :)";
  const payload = {
    blueName: blueTeamName,
    redName: redTeamName,
    tournamentId: tournamentCode
  };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
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
    return `[Blue Team Draft Link](<${config.LOWBUDGETLCS_DRAFT_URL}/${lobbyCode}/${blueCode}>)\n` +
    `[Red Team Draft Link](<${config.LOWBUDGETLCS_DRAFT_URL}/${lobbyCode}/${redCode}>)\n` +
    `[Spectator Draft Link](<${config.LOWBUDGETLCS_DRAFT_URL}/${lobbyCode}>)`;
  } catch (error) {
    console.error('Error hitting URL:', error);
    return errorString;
  }
}