# Development

Everything you need to get Todd running on your machine and make a change to it.

## Prerequisites

- **Node.js 22+** — production runs on `node:22-alpine`, so match that major version.
- **Docker Desktop** (optional) — only needed if you want to run the container image locally. On Windows this means WSL2 must be enabled.
- **A Discord test server** you own, plus your own bot application in the [Discord Developer Portal](https://discord.com/developers/applications). Do not develop against the live LBLCS guild — the bot wipes and re-registers slash commands on every boot.
- **Access to a [Dennys](https://github.com/lowbudgetlcs/dennys) instance** and a token for it. Dennys is the LBLCS backend and the source of truth for divisions, teams, series, and tournament codes. Without it `/start-series` cannot do anything; the other commands still work.

## First-time setup

```sh
git clone https://github.com/lowbudgetlcs/todd-bot.git
cd todd-bot
npm install
cp .env.example .env
```

Then fill in `.env` (see the table below) and start the bot:

```sh
npm run dev
```

`npm run dev` runs `tsx watch src/index.ts` — it type-strips and restarts on every
save, so it is what you want for day-to-day work.

## Environment variables

`src/config.ts` validates these at boot and **throws immediately if any required
one is missing**, listing the ones you forgot. That is deliberate: a bot that
starts without its backend token fails much more confusingly later.

### Required

| Variable | What it is | Where to get it |
| --- | --- | --- |
| `DISCORD_TOKEN` | Bot token used to log in to the gateway | Discord Developer Portal → your app → Bot → Reset Token |
| `DISCORD_CLIENT_ID` | Application ID, used for command registration | Developer Portal → General Information |
| `GUILD_ID` | The single guild commands are registered to | Right-click your server in Discord (with Developer Mode on) → Copy Server ID |
| `API_URL` | Base URL of [Dennys](https://github.com/lowbudgetlcs/dennys). No trailing slash — paths are concatenated directly | Ask an LBLCS dev |
| `DENNYS_TOKEN` | Bearer token sent on every Dennys request | Ask an LBLCS dev |
| `LOWBUDGETLCS_BACKEND_URL` | Base URL of the draft backend. Todd `POST`s `/createFearlessDraft` here | Ask an LBLCS dev |
| `LOWBUDGETLCS_DRAFT_URL` | Public base URL of the draft site. Only used to build the links shown to users | Ask an LBLCS dev |
| `RIOT_API_TOKEN` | Riot API key | [developer.riotgames.com](https://developer.riotgames.com) |

`RIOT_API_TOKEN` is required by `config.ts`, which constructs a
`RiotAPI` client (`config.rAPI`) at boot. Nothing calls that client on the
current code path — tournament codes come from Dennys, not from Riot directly —
but the variable must still be set or the bot refuses to start. A dummy value is
fine for local development.

### Optional

| Variable | Default | Effect |
| --- | --- | --- |
| `STATE_DIR` | `<cwd>/data` | Directory holding `state.json`, where the selected event group is persisted |
| `API_TIMEOUT_MS` | `20000` | Per-attempt timeout on every outbound HTTP call |
| `API_RETRIES` | `2` | Retry budget for **GET** requests only. Non-GET calls never retry unless a call site opts in |

`.env` is gitignored. Never commit real tokens; `.env.example` is the file that
gets updated when a new variable is added.

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | `tsx watch src/index.ts` — hot reload, no build step. **Use this for development.** |
| `npm run build` | `tsup src/* --minify` — compiles to `dist/` |
| `npm run build-ws` | Same, with a recursive glob (`src/**/*`) |
| `npm start` | `pm2-runtime ./dist/index.js` — runs the already-built output the way the container does |
| `npm run go` | Build then start |
| `npm run format` | Prettier over the whole repo |
| `npm test` | Not implemented — there is no test suite |

There is a Windows-specific quirk with the build globs; see
[TROUBLESHOOTING.md](TROUBLESHOOTING.md#npm-run-build-leaves-distcommands-empty-on-windows).

## Repository layout

```
src/
  index.ts                 entry point: client, command loader, interaction router
  config.ts                env validation, exported config object
  deploy-commands.ts       registers slash commands with Discord on boot
  state.ts                 persisted bot state (currently: selected event group)
  dennys.ts                every call to the LBLCS backend + its response types
  http.ts                  fetch wrapper: timeouts, bounded retries, HttpError
  interactionSafety.ts     defer/error/guard helpers for Discord interactions
  encoding.ts              UTF-8 mojibake repair for API strings
  util.ts                  thread-name building, draft-link markdown
  interfaces.ts            loose structural types used by the older handlers
  commands/                one file per slash command
  buttons/
    button.ts              custom_id encode/decode + ButtonBuilder helper
    handlers.ts            tag -> handler lookup table
    handlers/              one file per button handler
  modals/                  modal submit handlers
  types/toddData.ts        SeriesData and its custom_id serialization
  utilities/               pure helpers (rank -> points)
```

## Adding a slash command

1. Create `src/commands/yourCommand.ts`.
2. Export a `data` (a `SlashCommandBuilder`) and an `execute` function using
   `module.exports = { ... }`. The loader in `index.ts` checks for exactly those
   two keys and skips anything else, so the CommonJS export shape matters.
3. `execute` receives `(interaction, currentEventGroupId)`. Take the second
   argument only if your command depends on the selected event group.
4. If your command does *anything* slow — any network call — call
   `safeDefer(interaction, { ephemeral: true })` first and bail if it returns
   `false`. See [ARCHITECTURE.md](ARCHITECTURE.md#the-3-second-rule) for why.
5. Restart the bot. Commands are re-registered on every boot, so it appears in
   Discord automatically. No separate deploy step.

```ts
import { SlashCommandBuilder } from 'discord.js';
import { safeDefer } from '../interactionSafety.ts';

module.exports = {
  data: new SlashCommandBuilder().setName('example').setDescription('Does a thing'),
  async execute(interaction: any) {
    if (!(await safeDefer(interaction, { ephemeral: true }))) return;
    await interaction.editReply({ content: 'Done.' });
  },
};
```

The loader only scans `dist/commands/*.js` (or `src/commands/` under `tsx`) —
**not** subfolders. Keep command files flat.

## Adding a button

1. Write the handler in `src/buttons/handlers/yourHandler.ts`, exporting an
   `async function (interaction: ButtonInteraction)`.
2. Register its tag in the `switch` in `src/buttons/handlers.ts`.
3. Build the button with `createButtonData(tag, userId, seriesData)` and
   `createButton(...)` from `src/buttons/button.ts`. That is what encodes the
   series state into the `custom_id` — see
   [ARCHITECTURE.md](ARCHITECTURE.md#state-lives-in-the-custom_id).
4. Check permissions inside the handler. The convention is that only
   `data.originalUserId` or `seriesData.enemyCaptainId` may act; everyone else
   gets an ephemeral refusal.

## Code style and tooling

- **Prettier** (`.prettierrc`): single quotes, 100-char lines, trailing commas, semicolons, no tabs. Run `npm run format`.
- **ESLint** (`eslint.config.js`): TypeScript recommended plus Prettier-compat. Unused args prefixed `_` are ignored.
- **TypeScript** (`tsconfig.json`): `strict`, `noImplicitAny`, `noImplicitReturns`, `noEmit`. Type checking is a separate concern from the build — `tsup` uses `esbuild` and does not type-check, so run `npx tsc --noEmit` yourself before opening a PR.
- **Imports use explicit `.ts` extensions** (`allowImportingTsExtensions`). Follow the surrounding files; the mix of `.ts`-suffixed and bare imports in the existing code is historical.
- **Logging** uses `loglevel`, one named logger per module:
  ```ts
  const logger = log.getLogger('yourModule');
  logger.setLevel('info');
  ```
  Log liberally around interaction handling — in production the logs are the
  only view into what a user actually clicked.

## Testing changes

There is no automated test suite. Verify by hand in a test guild:

- `/coinflip` — proves the bot is up and commands registered.
- `/player_point_calculator` — proves modals work; no backend needed.
- `/set-current-event` then `/start-series` — the full path; needs a working Dennys.

Watch the console while you click through. Every step of the series flow logs
its `custom_id` and the parsed series data.
