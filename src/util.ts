import { eq } from "drizzle-orm/sql";
import { db } from "./db/db";
import { commandChannelPermissions, commandRolePermissions, divisions, teams } from "./db/schema";
import { CacheType, GuildMember, Interaction } from "discord.js";
import { channel } from "diagnostics_channel";

type DivisionsMap = Map<number, string>

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
  private static _instance : DatabaseUtil = new DatabaseUtil();
/**
 * Cached version of the division map
 * @returns Divions map of the id and the division name
 */
  public divisionsMap!: DivisionsMap;

  private constructor()
  {
    if (DatabaseUtil._instance)
    {
      throw new Error("Use DatabaseUtil.instance instead of new.");
    }
    DatabaseUtil._instance = this;
    this.populateDivisonsMap();
  }

  public static get Instance()
  {
      return DatabaseUtil._instance ?? (DatabaseUtil._instance = new DatabaseUtil());
  }

  private async populateDivisonsMap()
  {
    this.divisionsMap = new Map();
    let data = await db.select().from(divisions)
    for (const division of data) {
      this.divisionsMap.set(division.id, division.name)
    };
  }
  
}

export async function getTeamsByDivision(division: number) {
  let data = await db.select().from(teams).where((eq(teams.divisionId, division)));
  return data;
}

/**
 * Parses an interaction to get the user roles.
 * @returns collection of role ids.
 */
function getUserRoles(interaction : Interaction<CacheType>)
{
  // THIS IS NOT THE RIGHT THING TO DO PROBABLY
  // I DON'T UNDERSTAND WHY THE COMPILER REFUSES TO THINK
  // THAT BECAUSE THIS TYPE IS A UNION OF OTHER TYPES
  // THAT GUILDMEMBER PROPERTIES AREN'T AVAILABLE TO USE ????
  // TODO: understand how to code
  let member :GuildMember = interaction.member;
  // member.roles.cache.each(x => {
  //   console.log(`Role name=${x.name}, role id=${x.id}`);
  // });
  return member.roles.cache.map(role => role.id);
}


/**
 * Calls the db to check if the command is good to execute.
 * By default if there are no rows in the role / channel permissions, commands are good to go.
 * Checks both role + channel perms, must need both to execute.
 * @returns command is good to execute
 */
export async function checkDbForPermissions(interaction : Interaction<CacheType>, commandName : string)
{
  let roleAllowed = true;
  let channelAllowed = true;
  // i don't know how joins work so we will live with 2 queries
  // TODO: cache these results, maybe like every 5 minutes?
  // excluding some commands maybe api dependant ones so we don't get abusers?
  let rolesToCheck = await db.select().from(commandRolePermissions).where(eq(commandRolePermissions.name, commandName));
  let channelsToCheck = await db.select().from(commandChannelPermissions).where(eq(commandChannelPermissions.name, commandName));

  if (rolesToCheck.length > 0)
  {
    roleAllowed = false;
    let permissionRoles = rolesToCheck.map(x => x.roleId);
    var userRoles = getUserRoles(interaction).map(x => +x);

    permissionRoles.forEach(role => {
      // console.log(`Hello this is a log message: permission ${role}`)
      // console.log(`Hello this is a log message. userRole has the role ${userRoles.some(userRole => role == +userRole)}`);

      // console.log(`Hello this is a log message. userRoles: ${userRoles.join(',')}`);
      // console.log(`Hello this is a log message. permissionRoles: ${permissionRoles.join(',')}`);
      if(userRoles.some(userRole => role == +userRole))
      {
        roleAllowed = true;
      }
    })
  }
  
  if (channelsToCheck.length > 0)
  {
    channelAllowed = false;
    let channels = channelsToCheck.map(x => x.channelId);
    var messageChannel = +interaction.channelId!
    if (channels.includes(messageChannel))
    {
      channelAllowed = true;
    }
  }
  if (!roleAllowed && !channelAllowed)
  {
    await interaction.reply({
      content: "Sorry, you can't run this command with your roles and in this channel!",
      flags: "Ephemeral"
    });
  } else if (!roleAllowed)
  {
    await interaction.reply({
      content: "Sorry, you aren't cool enough for this command.",
      flags: "Ephemeral"
    });
  } else if(!channelAllowed)
  {
    await interaction.reply({
      content: "Sorry, you can't run that in this channel!",
      flags: "Ephemeral"
    });
  }

  return roleAllowed && channelAllowed;
}