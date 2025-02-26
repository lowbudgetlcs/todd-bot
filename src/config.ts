import dotenv from "dotenv";
import { RiotAPI, RiotAPITypes } from "@fightmegg/riot-api";

dotenv.config();

const {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  GUILD_ID,
  DATABASE_URL,
  RIOT_API_TOKEN,
  CHANNEL_ID,
  CAPTAIN_ROLE_ID,
  ADMIN_ROLES: adminRoles,
  ADMIN_ROLE_IDS: adminRoleIds,
  ADMIN_CHANNEL_IDS: adminChannelIds
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
  !CHANNEL_ID && "CHANNEL_ID",
  !adminRoles && "adminRoles",
  !adminRoleIds && "adminRoleIds",
  !adminChannelIds && "adminChannelIds",
  !CAPTAIN_ROLE_ID && "CAPTAIN_ROLE_ID",
].filter(Boolean);

if (missingEnvs.length > 0) {
  throw new Error(`Missing environment variables: ${missingEnvs.join(", ")}`);
}

const ADMIN_ROLES = (adminRoles ?? "").split(",");
const ADMIN_ROLE_IDS = (adminRoleIds ?? "").split(",");
const ADMIN_CHANNEL_IDS = (adminChannelIds ?? "").split(",");

export const config = {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  GUILD_ID,
  DATABASE_URL,
  rAPI,
  CHANNEL_ID,
  ADMIN_ROLES,
  ADMIN_ROLE_IDS,
  ADMIN_CHANNEL_IDS,
  CAPTAIN_ROLE_ID
};
