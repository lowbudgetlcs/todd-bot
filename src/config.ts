import dotenv from "dotenv";
import { RiotAPI, RiotAPITypes, PlatformId } from "@fightmegg/riot-api";
import { randomBytes } from "crypto";

dotenv.config();

const {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  GUILD_ID,
  SUPABASE_URL,
  RIOT_KEY,
  CHANNEL_ID,
} = process.env;

const riotConfig: RiotAPITypes.Config = {
  debug: false,
};
const rAPI = new RiotAPI(String(RIOT_KEY), riotConfig);
const ADMIN_ROLES = process.env.ADMIN_ROLES!.split(",");
const ADMIN_ROLE_IDS = process.env.ADMIN_ROLE_IDS!.split(",");
const ADMIN_CHANNEL_IDS = process.env.ADMIN_CHANNEL_IDS!.split(",");
if (
  !DISCORD_TOKEN ||
  !DISCORD_CLIENT_ID ||
  !GUILD_ID ||
  !SUPABASE_URL ||
  !RIOT_KEY ||
  !CHANNEL_ID ||
  !ADMIN_ROLES ||
  !ADMIN_ROLE_IDS ||
  !ADMIN_CHANNEL_IDS
) {
  throw new Error("Missing environment variables");
}

export const config = {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  GUILD_ID,
  SUPABASE_URL,
  rAPI,
  CHANNEL_ID,
  ADMIN_ROLES,
  ADMIN_ROLE_IDS,
  ADMIN_CHANNEL_IDS,
};
