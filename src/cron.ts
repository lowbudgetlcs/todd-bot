import { Cron } from 'croner';
import { config } from './config';
import { db } from './db/db';
import { games } from './db/schema';
import { and, eq, sql } from 'drizzle-orm';

type Game = {
  id: number;
  short_code: string;
  winner_id: number | null;
  loser_id: number | null;
  series_id: number;
  result_id: number | null;
  game_num: number;
  processed: boolean;
  created_at: string | null;
}

// Code pruning job
const job = Cron("45 23 * * *", async () => {
  console.info("Begininng pruning...")
  const unprocessedCodes = await db.select().from(games).where(
    and(
      eq(games.processed, false),
      sql`${games.created_at} < current_timestamp - interval '12 hours'`
    )
  );
  console.info(`Fetched ${unprocessedCodes.length} codes.`)

  const markGame = async (game: Game) => {
    const shortCode = game.short_code;
    try {
      await config.rAPI.tournamentV5.getTournamentGameDetailsByTournamentCode({ tournamentCode: shortCode });
    } catch (e: any) {
      if (e.status === 404) {
        return shortCode;
      }
    }
    return ""
  }
  const markedPromises = unprocessedCodes.map(markGame);
  const markedCodes = (await Promise.all(markedPromises)).filter(val => val.length > 0);
  console.info(`Marked ${markedCodes.length} codes for deletion.`)

  const deleteCode = async (code: string) => {
    try {
      await db.delete(games).where(eq(games.short_code, code));
      return 1
    } catch (e) {
      console.error(e)
    }
  }
  const deletedPromises = markedCodes.map(deleteCode);
  const deletedCodes = await Promise.all(deletedPromises);
  const count = deletedCodes.filter(val => typeof val != "undefined").length
  console.info(`Pruning complete! Deleted ${count} codes.`)
});