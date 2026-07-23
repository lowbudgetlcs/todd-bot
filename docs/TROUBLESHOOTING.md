# Troubleshooting

Things that go wrong, why, and what to do. Roughly ordered by how often they come
up.

## "Event group ID is not set. Please create a dev ticket."

Every `/start-series` stops immediately with this message.

**Cause:** `currentEventGroupId` is null. Almost always because the container was
recreated — `data/state.json` lives on the container filesystem, so `docker
compose down`/`up` (i.e. every deploy) wipes it.

**Fix:** run `/set-current-event` and pick the event group.

**After a deploy this is normal**, not a bug — re-selecting is part of the
[post-deploy checklist](DEPLOYMENT.md#post-deploy-checklist).

**If it happened *without* a deploy, that is a real bug.** The state file is on
disk specifically so a crash or a pm2 restart can't reset it. Check
`docker logs todd-bot` for `Failed to read state file` or `Failed to persist
state` — both are logged and deliberately non-fatal, so a broken state directory
degrades silently into exactly this symptom.

The message deliberately says "create a dev ticket" rather than "run
`/set-current-event`" — regular users can't meaningfully act on the latter, and
telling them to try it just produces confusion.

## The bot went offline / restarted on its own

**Check first:** `docker logs --tail 200 todd-bot`.

`index.ts` installs `unhandledRejection` and `uncaughtException` handlers that
log and keep running, so an unhandled promise should no longer kill the process.
If it died anyway, the log will contain either `Missing environment variables:`
(bad `.env` — see below) or a real crash worth reporting.

Historically this was caused by a slow Dennys call letting the interaction token
expire; the resulting `10062` rejection was unhandled and killed the process.
If you write a new handler, **await it inside `runGuarded`** — a floating promise
in a collector callback is exactly how that used to happen.

## `Missing environment variables: X, Y`

The container exits at boot. `src/config.ts` validates required variables and
throws with the list of missing ones.

**Fix:** add them to `/lblcs/docker/todd-bot/.env` on the server (or your local
`.env`) and restart. Every variable in `.env.example` marked required must be
present, even `RIOT_API_TOKEN`, which nothing on the current code path actually
calls.

## Slash commands are missing or duplicated in Discord

**Cause:** `deployCommands` runs on every boot and is destructive — it deletes all
global commands, clears the guild's commands, then re-registers the current set.

Two common versions of this:

- **Commands vanished from production.** Someone started a dev instance with
  `GUILD_ID` pointed at the live guild; their boot wiped and replaced
  production's command set. Restart production to restore.
- **A renamed/deleted command still shows up.** Discord's client caches commands
  aggressively. Restart the Discord client (Ctrl+R) before assuming registration
  failed.

**Prevention:** always point a dev `.env` at your own test server.

## "This interaction failed" in Discord

Discord gives 3 seconds to acknowledge an interaction. Past that the token is
dead and every subsequent call fails with `10062`.

**Cause:** a handler did network work before acknowledging.

**Fix:** call `safeDefer` first, and bail if it returns false:

```ts
if (!(await safeDefer(interaction, { ephemeral: true }))) return;
// ...slow work here...
await interaction.editReply({ content: '...' });
```

Use `{ update: true }` for component interactions (buttons, select menus) so it
edits the existing message instead of posting a new reply.

In the logs, expired interactions show up as
`interaction expired before we could respond` at warn level — that is
`runGuarded` correctly recognising a dead token rather than treating it as an
error.

## "Failed to find a matching series for these teams."

**Cause:** Dennys has no scheduled series for that pair of teams in that stage.
Todd never creates a series; it only creates *games inside an existing series*.

**Fix:** the schedule has to be entered in the backend first. Check that the
teams, the stage name, and the division all match what's in Dennys — a stage
mismatch is the usual culprit, since the lookup filters on it.

## "Error generating draft links! Please do so manually :)"

**Cause:** the `POST` to `LOWBUDGETLCS_BACKEND_URL/createFearlessDraft` failed.

**Impact:** limited. The tournament code was still created and posted — only the
fearless draft links are missing. Teams can create a draft manually and play the
game normally.

**Check:** the log line `createFearlessDraft [<status>]: <body>` gives the status
and response body. Verify `LOWBUDGETLCS_BACKEND_URL` is reachable from the
container.

## Team names show up as garbage (`â€™`, `Ã©`)

**Cause:** UTF-8 bytes decoded as Latin-1 somewhere upstream of Todd.

This is already handled: `normalizeApiStrings` repairs it on every parsed
response (`src/encoding.ts`). If you still see mojibake:

- Confirm the response actually goes through `apiGet` / `parseJsonResponseUtf8`
  rather than a bare `fetch(...).json()`.
- The repair is intentionally conservative — a name that is legitimately Latin-1
  encoded (`Café` as raw bytes) is left alone rather than corrupted. If a
  genuinely new encoding case appears, extend `repairMisdecodedUtf8` rather than
  patching call sites.

## Thread creation fails / "Invalid Form Body"

**Cause:** Discord caps thread names at 100 characters.

`buildThreadName` handles this by trimming the team names (never the date) and
truncating by code point so a surrogate pair is never split. If you see this
error, something built a thread name without going through that helper.

## Buttons stop responding mid-series

**Two different causes:**

- **The dropdowns went dead.** The message component collectors in
  `/start-series` have a 5-minute lifetime. After that the menus silently do
  nothing and the user must re-run the command. This is expected.
- **"Only the person who generated the original code can ..."** Only the user who
  started the flow and the named `opposing_captain` may click. Anyone else,
  including staff, is refused.

## A `custom_id` parses wrong / a button does nothing

The `custom_id` format is
`tag:originalUserId:enemyCaptainId:divisionId:team1Id:team2Id:stage`, split on
`:`. Two ways to break it:

- **A colon in a stage name.** Stage names go into the id verbatim, so a stage
  called `Week 1: Opener` shifts every field after it.
- **Exceeding 100 characters.** Discord's cap on `custom_id`. Two snowflakes
  alone are ~38 characters, so a long stage name is the realistic way to blow the
  budget.

The logs print the raw `custom_id` on every button and select interaction — start
there.

## Requests to Dennys time out

Default per-attempt timeout is 20 seconds (`API_TIMEOUT_MS`), with 2 retries on
GET only, backing off 500ms then 1s.

- Errors look like `<label>: attempt N failed (TimeoutError)` followed by
  `<label> failed after N attempt(s)`.
- **Non-GET calls are not retried on purpose.** `createGame` is not idempotent —
  a replay would double-book a game. Do not "fix" this by adding retries to it.
- If Dennys is genuinely slow rather than down, raising `API_TIMEOUT_MS` is safe:
  every slow path defers first, so the interaction budget is ~15 minutes, not 3
  seconds.

## `npm run build` leaves `dist/commands` empty on Windows

**Cause:** `npm run build` is `tsup src/* --minify`, and glob expansion is done by
the shell. On Windows (`cmd.exe`) the glob is not expanded the way it is under
sh, so subdirectories like `src/commands/` don't get emitted.

**This is a local-only artifact — the Docker build is correct**, because it runs
under Alpine's shell. Don't "fix" the build script to work around it.

**For local work, use `npm run dev`** (`tsx watch`), which doesn't build at all
and reads `src/` directly. If you specifically need a local build, run it from
Git Bash or WSL, or use `npm run build-ws`.

## Getting more detail out of the logs

Every module has its own `loglevel` logger pinned to `info`:

```ts
const logger = log.getLogger('yourModule');
logger.setLevel('info');
```

To dig into a specific area temporarily, change that module's level to `'debug'`
and rebuild. There is no global log-level environment variable.
