import { eq } from "drizzle-orm/sql";
import { db } from "./db/db";
import { commandChannelPermissions, commandRolePermissions, divisions, teams } from "./db/schema";
import { CacheType, Interaction } from "discord.js";

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

export async function getUserRoles(interaction : Interaction<CacheType>, role: string)
{
  let x = interaction.member?.roles
  return 
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

  if (rolesToCheck)
  {
    roleAllowed = false;
    let permissionRoles = rolesToCheck.map(x => x.roleId);
  
    permissionRoles.forEach(role => {
      if(role in interaction.member?.roles!)
      {
        roleAllowed = true;
      }
    })
  }
  
  if (channelsToCheck)
  {
    channelAllowed = false;
    let channels = channelsToCheck.map(x => x.channelId);
    if (interaction.channelId! in channels)
    {
      channelAllowed = true;
    }
  }
  return roleAllowed && channelAllowed;
}