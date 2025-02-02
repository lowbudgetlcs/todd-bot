import { db } from "./db/db";
import { divisions } from "./db/schema";

type DivisionsMap = Map<number, string>

// //https://stackoverflow.com/questions/42761189/implementing-lazyt-in-typescript
// function lazy<T>(factory: () => NonNullable<T>) {
//   let value: T | undefined;
//   return () => value ?? (value = factory());
// }

export class DatabaseUtil {
  private static _instance : DatabaseUtil;
/**
 * Cached version of the divison map
 * @returns Divions map of the id and the division name
 */
  public divisionsMap!: DivisionsMap;

  private constructor()
  {
    this.populateDivisonsMap();
  }

  public static get Instance()
  {
      // Do you need arguments? Make it a regular static method instead.
      return this._instance || (this._instance = new this());
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
