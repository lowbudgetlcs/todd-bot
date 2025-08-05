import dotenv from "dotenv";
import { RiotAPI, RiotAPITypes } from "@fightmegg/riot-api";

dotenv.config();

const {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  GUILD_ID,
  DATABASE_URL,
  RIOT_API_TOKEN,
  LOWBUDGETLCS_BACKEND_URL,
  LOWBUDGETLCS_DRAFT_URL
} = process.env;

const riotConfig: RiotAPITypes.Config = {
  debug: false,
};
const rAPI = new RiotAPI(String(RIOT_API_TOKEN), riotConfig);

const missingEnvs = [
  !DISCORD_TOKEN && "DISCORD_TOKEN",
  !DISCORD_CLIENT_ID && "DISCORD_CLIENT_ID",
  !GUILD_ID && "GUILD_ID",
  !DATABASE_URL && "DATABASE_URL",
  !RIOT_API_TOKEN && "RIOT_API_TOKEN",
  !LOWBUDGETLCS_BACKEND_URL && "LOWBUDGETLCS_BACKEND_URL",
  !LOWBUDGETLCS_DRAFT_URL && "LOWBUDGETLCS_DRAFT_URL"
].filter(Boolean);

if (missingEnvs.length > 0) {
  throw new Error(`Missing environment variables: ${missingEnvs.join(", ")}`);
}


export const config = {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  GUILD_ID,
  DATABASE_URL,
  rAPI,
  LOWBUDGETLCS_BACKEND_URL,
  LOWBUDGETLCS_DRAFT_URL
};
