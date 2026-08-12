import dotenv from 'dotenv';
import { RiotAPI, RiotAPITypes } from '@fightmegg/riot-api';
import log from 'loglevel';

dotenv.config();

const logger = log.getLogger('config');
logger.setLevel('info');

/**
 * Reads an optional numeric tunable.
 *
 * `Number(raw) || fallback` is wrong for these. Number('0') is 0, which is
 * falsy, so `API_RETRIES=0` - the setting you reach for mid-incident to stop
 * retry amplification - silently gave you the default 2 instead.
 *
 * Unset and blank both mean "use the default", because Number('') is also 0 and
 * a bare `API_RETRIES=` in .env would otherwise read as a deliberate zero.
 * Anything unparseable warns and falls back rather than throwing: a typo in an
 * optional tunable should not stop the bot from booting, unlike the required
 * variables gated below.
 */
function optionalInt(name: string, fallback: number, isValid: (n: number) => boolean): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !isValid(n)) {
    logger.warn(`${name}="${raw}" is not a usable value, falling back to ${fallback}`);
    return fallback;
  }
  return Math.trunc(n);
}

// The two knobs differ in whether zero is meaningful. Zero retries is a real
// setting. A zero timeout is not: AbortSignal.timeout(0) aborts every request
// immediately and there is no "off" value, so a non-positive number is a
// mistake rather than a way to disable the timeout. Negative retries would be
// worse than useless - fetchWithRetry's loop would never run an attempt at all.
const API_TIMEOUT_MS = optionalInt('API_TIMEOUT_MS', 20_000, n => n > 0);
const API_RETRIES = optionalInt('API_RETRIES', 2, n => n >= 0);

// The post-game form changes between seasons, so it is swappable without a
// deploy. Optional: an unset or blank value keeps the current form.
const POST_GAME_FORM_URL =
  process.env.POST_GAME_FORM_URL?.trim() || 'https://forms.gle/bxYwXpe8esVpsoix6';

const {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  GUILD_ID,
  RIOT_API_TOKEN,
  LOWBUDGETLCS_BACKEND_URL,
  LOWBUDGETLCS_DRAFT_URL,
  API_URL,
  DENNYS_TOKEN,
} = process.env;

const riotConfig: RiotAPITypes.Config = {
  debug: false,
};
const rAPI = new RiotAPI(String(RIOT_API_TOKEN), riotConfig);

const missingEnvs = [
  !DISCORD_TOKEN && 'DISCORD_TOKEN',
  !DISCORD_CLIENT_ID && 'DISCORD_CLIENT_ID',
  !GUILD_ID && 'GUILD_ID',
  !RIOT_API_TOKEN && 'RIOT_API_TOKEN',
  !LOWBUDGETLCS_BACKEND_URL && 'LOWBUDGETLCS_BACKEND_URL',
  !LOWBUDGETLCS_DRAFT_URL && 'LOWBUDGETLCS_DRAFT_URL',
  !API_URL && 'API_URL',
  !DENNYS_TOKEN && 'DENNYS_TOKEN',
].filter(Boolean);

if (missingEnvs.length > 0) {
  throw new Error(`Missing environment variables: ${missingEnvs.join(', ')}`);
}

export const config = {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  GUILD_ID,
  rAPI,
  LOWBUDGETLCS_BACKEND_URL,
  LOWBUDGETLCS_DRAFT_URL,
  API_URL,
  DENNYS_TOKEN,
  API_TIMEOUT_MS,
  API_RETRIES,
  POST_GAME_FORM_URL,
};
