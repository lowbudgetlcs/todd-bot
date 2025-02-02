import { eq } from "drizzle-orm/sql";
import { db } from "./db/db";
import { divisions, teams } from "./db/schema";

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