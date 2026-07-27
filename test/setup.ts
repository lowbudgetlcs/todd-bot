/**
 * Test bootstrap. `src/config.ts` throws at import time if any required env var
 * is missing (DEVELOPMENT.md#environment-variables), and several modules under
 * test import it transitively (util.ts -> config.ts). Seed dummy values so the
 * config gate is satisfied without a real .env. dotenv.config() does not
 * override already-set vars, so these win and stay hermetic.
 */
const defaults: Record<string, string> = {
  DISCORD_TOKEN: 'test-discord-token',
  DISCORD_CLIENT_ID: 'test-client-id',
  GUILD_ID: 'test-guild-id',
  RIOT_API_TOKEN: 'test-riot-token',
  LOWBUDGETLCS_BACKEND_URL: 'https://backend.test',
  LOWBUDGETLCS_DRAFT_URL: 'https://draft.test',
  API_URL: 'https://dennys.test',
  DENNYS_TOKEN: 'test-dennys-token',
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = value;
}
