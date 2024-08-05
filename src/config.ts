import dotenv from "dotenv";
import { RiotAPI, RiotAPITypes, PlatformId } from "@fightmegg/riot-api";
import { randomBytes } from "crypto";


dotenv.config();

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, GUILD_ID, SUPABASE_URL, RIOT_KEY, CHANNEL_ID} = process.env;

const riotConfig: RiotAPITypes.Config = {
  debug: false,
};
 const rAPI = new RiotAPI(String(RIOT_KEY), riotConfig);

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !GUILD_ID || !SUPABASE_URL ||  !CHANNEL_ID) {
  throw new Error("Missing environment variables");
}

export const config = {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  GUILD_ID, 
  SUPABASE_URL, 
  rAPI,
  CHANNEL_ID
};