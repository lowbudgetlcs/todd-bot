import dotenv from "dotenv";
import { RiotAPI, RiotAPITypes, PlatformId } from "@fightmegg/riot-api";
import { randomBytes } from "crypto";


dotenv.config();

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, GUILD_ID, SUPABASE_URL, SUPABASE_KEY, RIOT_KEY} = process.env;

const riotConfig: RiotAPITypes.Config = {
  debug: false,
};
 const rAPI = new RiotAPI(String(RIOT_KEY), riotConfig);
 console.log(rAPI.account);

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !GUILD_ID || !SUPABASE_URL || ! SUPABASE_KEY) {
  throw new Error("Missing environment variables");
}

export const config = {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  GUILD_ID, 
  SUPABASE_URL, 
  SUPABASE_KEY,
  rAPI
};