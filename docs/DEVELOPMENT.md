# Development

Everything you need to get Todd running on your machine and make a change to it.

## Prerequisites

- **Node.js 20+** — and note this is only for the host-side checks (`npm test`,
  `npm run lint`, `npm run typecheck`). The bot itself always runs on
  `node:22-alpine` inside the container, locally and in production, so your host
  version never has to match it. 22 is fine too; 20 is the floor because the test
  suite pins `vitest@^3` (see [Tests](#tests)).
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
docker compose up --build
```

**This is the only supported way to run Todd**, locally or in production — the
same `Dockerfile` and the same `compose.yaml` the deploy uses. `npm install` is
there for the checks that run on the host (`npm test`, `npm run lint`,
`npm run typecheck`), not for running the bot.

There is deliberately no hot-reload dev server. The command loader reads the
*built* output (`dist/commands/*.js`), so anything that runs `src/` directly
loads zero commands and — because the bot deletes its registered commands before
re-registering — used to unregister every slash command in the guild on boot.
Rebuild the image instead; `--build` on the line above does it in one step.

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
| `API_URL` | Base URL of [Dennys](https://github.com/lowbudgetlcs/dennys), **including the `/api/v1` path prefix** — e.g. `https://dennys.lowbudgetlcs.com/api/v1`, not the bare host. No trailing slash | Ask an LBLCS dev |
| `DENNYS_TOKEN` | Bearer token sent on every Dennys request | Ask an LBLCS dev |
| `LOWBUDGETLCS_BACKEND_URL` | Base URL of the draft backend. Todd `POST`s `/createFearlessDraft` here | Ask an LBLCS dev |
| `LOWBUDGETLCS_DRAFT_URL` | Public base URL of the draft site. Only used to build the links shown to users | Ask an LBLCS dev |
| `RIOT_API_TOKEN` | Riot API key | [developer.riotgames.com](https://developer.riotgames.com) |

**`API_URL` carries the whole prefix, because Todd adds none.** `apiGet` builds
every request as `` `${API_URL}${path}` `` ([src/dennys.ts](../src/dennys.ts))
with `path` being a bare `/eventGroup`, `/event/{id}`, `/series/{id}/game` and so
on — the paths in [the Dennys contract](ARCHITECTURE.md#the-dennys-contract) are
written relative to `API_URL` for exactly this reason. Whatever the API is served
under has to be in the variable. A bare host gives you a 404 on every call.

`RIOT_API_TOKEN` is required by `config.ts`, which constructs a
`RiotAPI` client (`config.rAPI`) at boot. Nothing calls that client on the
current code path — tournament codes come from Dennys, not from Riot directly —
but the variable must still be set or the bot refuses to start. A dummy value is
fine for local development.

### Optional

| Variable | Default | Effect |
| --- | --- | --- |
| `STATE_DIR` | `<cwd>/data` | Directory holding `state.json`, where the selected event group is persisted |
| `API_TIMEOUT_MS` | `20000` | Per-attempt timeout on every outbound HTTP call. Must be positive — `AbortSignal.timeout` has no "no timeout" value, so `0` is treated as a mistake, not as "disabled" |
| `API_RETRIES` | `2` | Retry budget for **GET** requests only. Non-GET calls never retry unless a call site opts in. **`0` is honored** — it's the setting to reach for when retries are making an incident worse |

Both are parsed in [src/config.ts](../src/config.ts), not at the point of use.
Unset and blank mean "use the default"; anything unparseable, negative, or (for
the timeout) zero logs a warning and falls back rather than throwing — a typo in
an optional knob shouldn't stop the bot from booting the way a missing required
variable does.

`.env` is gitignored. Never commit real tokens; `.env.example` is the file that
gets updated when a new variable is added.

## npm scripts

| Script | What it does |
| --- | --- |
| `npm test` | `vitest run` — the unit suite in `test/`, one pass |
| `npm run test:watch` | `vitest` — re-runs affected tests on save |
| `npm run lint` | `eslint .` |
| `npm run typecheck` | `tsc --noEmit` over `src`, then again over `test` via `tsconfig.test.json` |
| `npm run format` | Prettier over the whole repo |
| `npm run build` | `tsup src/* --minify` — compiles to `dist/` |
| `npm run build-ws` | Same, with a recursive glob (`src/**/*`) |
| `npm start` | `pm2-runtime ./dist/index.js` — runs the already-built output the way the container does |
| `npm run go` | Build then start |

The first four are what CI runs (see below). `build`/`start`/`go` exist because
the container uses them — you normally reach them through `docker compose up
--build` rather than calling them directly, and on Windows a direct `npm run
build` hits the glob quirk below.

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

The loader scans `dist/commands/*.js` — the built output, **not** `src/`, and
**not** subfolders. Keep command files flat, and rebuild (`docker compose up
--build`) after adding one.

If the loader finds no commands it logs an error and skips the deploy rather
than registering an empty set, because `deployCommands` deletes every existing
command before re-registering.

## Adding a button

1. Write the handler in `src/buttons/handlers/yourHandler.ts`, exporting an
   `async function (interaction: ButtonInteraction)`.
2. Register its tag in the `switch` in `src/buttons/handlers.ts`, **and in
   `TAG_CODES` in `src/buttons/button.ts`** with a short wire code. An
   unregistered tag still routes, but it spends its full name out of the
   `custom_id` budget and can overflow a series that would otherwise fit. Never
   change a code that is already shipped — buttons in existing Discord messages
   are routed by it.
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

### Unit tests

`npm test` runs the [Vitest](https://vitest.dev) suite under `test/`. Discord and
dennys are mocked at the module boundary, so the flow-level tests run without a
gateway connection or a live backend:

| File | What it pins down |
| --- | --- |
| `encoding.test.ts` | Mojibake repair, the conservative "leave real Latin-1 / real Unicode alone" rule, nested `normalizeApiStrings`, BOM stripping |
| `http.test.ts` | GET retries on 408/429/5xx, 4xx is not retried, and **non-GET never retries** (the anti-double-book invariant) |
| `config.test.ts` | Optional numeric env vars: `API_RETRIES=0` is honored, blank/unset/garbage fall back to defaults without throwing |
| `toddData.test.ts` / `button.test.ts` | `custom_id` encode/decode round-trip, field order, base36 (incl. snowflakes past `MAX_SAFE_INTEGER`), tag wire codes, the 100-char budget, legacy decimal ids, colons in stage names |
| `util.test.ts` | `buildThreadName` staying under 100 chars without splitting a surrogate pair; draft-link best-effort fallback |
| `state.test.ts` | Atomic write, reload survival, and corrupt-file fallback to defaults |
| `interactionSafety.test.ts` | 10062 vs 40060 (dead token vs. our own double ack), defer/error channel selection, `runGuarded` |
| `ackBeforeSlowWork.test.ts` | The 3-second rule: every button handler acks *before* its first dennys call |
| `dennys.test.ts` | The backend contract: URL/auth on every call, **every write passes `retries: 0`**, the `completed=false` series filter, the client-side re-check that a series matches on *both* teams and the stage, game numbering following games rather than codes, `DennysSchemaError` on a changed shape vs. tolerance for unread and added fields, mojibake repair reaching real call sites, `HttpError` carrying status + body |
| `tournament.test.ts` | The main flow: `handleBothTeamSubmission` and `handleTeamSelect` ack before their first dennys call, the game number tracks games played rather than codes issued, the series resolves once by id for both the number and the Bo, and an oversized stage is refused **before** the code is issued rather than stranding a real series behind an unusable button |

Tests are written against the contracts in
[ARCHITECTURE.md](ARCHITECTURE.md) and [TROUBLESHOOTING.md](TROUBLESHOOTING.md),
not just the current implementation. `test/setup.ts` seeds dummy env vars so
`config.ts` doesn't throw at import; no real `.env` or network is used.

> Note on Node: the suite pins `vitest@^3` because Vitest 4 requires Node
> 20.19+/22.12+, which is above the Node 20 floor in
> [Prerequisites](#prerequisites). CI runs the same suite on Node 22 to match the
> container. Raise the floor before unpinning Vitest.

### CI

[`.github/workflows/ci.yaml`](../.github/workflows/ci.yaml) runs on every pull
request and every push to `main`:

```sh
npm ci
npm run typecheck   # src, then test/ via tsconfig.test.json
npx eslint .        # npm run lint
npm test
npm run build       # then asserts dist/commands/*.js is non-empty
```

Run those four locally before opening a PR — they are the same commands, so a
green local run is a green CI run. The build step is there because `tsup`'s entry
glob is the one thing the unit tests can't see: a build that emits no commands
type-checks and tests clean but ships a bot with no slash commands.

`eslint .` currently reports warnings (`no-explicit-any` in `interfaces.ts` and
the Dennys types, plus a few unused symbols). Those are pre-existing debt and do
not fail the build; **errors do**. Don't add new ones.

### Manual verification

The full interaction flow still has to be exercised by hand in a test guild:

- `/coinflip` — proves the bot is up and commands registered.
- `/player_point_calculator` — proves modals work; no backend needed.
- `/set-current-event` then `/start-series` — the full path; needs a working Dennys.

Watch the container logs while you click through — `docker compose up` streams
them, or `docker compose logs -f todd-bot` if you started detached. Every step of
the series flow logs its `custom_id` and the parsed series data.

If `/coinflip` doesn't appear in the guild's command list at all, check the boot
logs for `Loading command from ...` — one line per command. No lines means the
build emitted nothing into `dist/commands`.
