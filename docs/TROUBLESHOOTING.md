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

`index.ts` handles the two failure modes differently, and the log tells you
which one you hit:

- `Unhandled promise rejection (bot staying up):` — logged, process survives. An
  unhandled promise should no longer kill the bot.
- `Uncaught exception - exiting so pm2 can restart cleanly:` — the process
  exited **on purpose**, because its state could no longer be trusted, and pm2
  restarted it. The stack trace on that line is the bug; treat it as a real
  crash worth reporting rather than as noise.
- `Missing environment variables:` — bad `.env`, see below. This one crash-loops
  until it is fixed, because every restart fails the same way.

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

## Every Dennys call 404s

The bot boots fine — `config.ts` only checks that the variables are *present* —
and then every command fails. `/set-current-event` shows no event groups,
`/start-series` can't find a division.

**Cause:** `API_URL` is missing the `/api/v1` prefix. Todd concatenates bare
paths onto it (`` `${API_URL}${path}` `` in `src/dennys.ts`, with `path` being
`/eventGroup`, `/event/{id}`, ...), so the prefix has to be part of the variable.
`https://dennys.lowbudgetlcs.com` requests `/eventGroup`;
`https://dennys.lowbudgetlcs.com/api/v1` requests `/api/v1/eventGroup`.

**Check it:** the logs print the full URL on the event fetch — `Fetching event 1
from ...`. A trailing slash on `API_URL` is the other way to break this, giving
you a double slash.

## Slash commands are missing or duplicated in Discord

**Cause:** `deployCommands` runs on every boot — it deletes all global commands,
then bulk-overwrites the guild's commands with the current set (a single `PUT`
that adds, updates, and removes to match). It no longer clears the guild to `[]`
first, so command IDs — and the server-side permission overrides keyed to them —
are preserved across redeploys.

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
`runGuarded` correctly recognising a dead token (`10062`) rather than treating
it as an error.

Do not confuse that with `40060 already acknowledged`, which is logged at
**error** level. That one means the token was still good and we replied twice —
two code paths handling the same interaction, or a handler that acknowledges and
then falls through to a second reply. It is a bug in the handler, not a slow
backend, and the fix is to find the second acknowledgement rather than to widen
any timeout.

## "Failed to find a matching series for these teams."

**Cause:** Dennys has no scheduled series for that pair of teams in that stage.
Todd never creates a series; it only creates *games inside an existing series*.

**Fix:** the schedule has to be entered in the backend first. Check that the
teams, the stage name, and the division all match what's in Dennys — a stage
mismatch is the usual culprit, since the lookup filters on it.

**Also check whether the series is already complete.** The lookup sends
`completed=false`, so a series Dennys has closed is invisible to it. Dennys closes
a series automatically once enough results have been written, so this is the
expected message after a Bo3 finishes. If it closed early — a result recorded
against the wrong series, say — reopening it in Dennys makes it findable again.

## "unexpected response shape from dennys"

**Cause:** `DennysSchemaError`. Dennys returned a payload that does not match the
contract Todd was built against — a renamed field, a changed type, a removed one.
Todd targets Dennys **1.4.0**; running against an older deployment does this.

**Fix:** this is a code change here, not a config problem. The log line names the
call, the offending path, and the payload that arrived:

```
getSeries(756): totalGames: Invalid input: expected number, received string - got {...}
```

Compare against the Kotlin DTO — not the OpenAPI file, which has known drift —
and update `src/dennysSchemas.ts`. Fields Todd does not read never cause this;
only the ones it depends on do.

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
`tag:v1:originalUserId:enemyCaptainId:divisionId:team1Id:team2Id:stage`, split on
`:`, with every id in base36. A real one looks like
`gc:v1:9do1sj396nf9:9do1sj396nf9:7pr:7pr:7pr:PROMOTION_RELEGATION`.

The leading `gc` is a wire code, not a corrupted tag — the full table is
`TAG_CODES` in [src/buttons/button.ts](../src/buttons/button.ts):

| Code | Tag | Code | Tag |
| --- | --- | --- | --- |
| `d` | `division_select` | `x` | `cancel` |
| `1` | `team1_select` | `xf` | `cancel_flow` |
| `2` | `team2_select` | `xw` | `cancel_switch` |
| `s` | `stage_select` | `g` | `generate_another` |
| `c` | `confirm` | `gc` | `generate_another_confirm` |
| `w` | `switch` | `e` | `end_series` |
| `ws` | `switch_sides` | | |

Everything past `parseButtonData` — handler dispatch, the `button:` label in the
guard logs — uses the readable name, so a code only ever appears in a raw id.

Things to check:

- **Is the `v1` marker there?** Without it the id predates base36 and is read
  with the old decimal decoder, and its tag is a full name rather than a code.
  That path still works; a *mixed* id (marker present, decimal ids) would not,
  and means something hand-built an id instead of going through
  `createButtonData`.
- **A colon in a stage name is fine now.** The stage is the last field and
  absorbs the rest of the split, so `Week 1: Opener` round-trips. Nothing ahead
  of it can contain a `:`.
- **Exceeding 100 characters.** Discord's cap on `custom_id`. Base36 ids and tag
  codes put the realistic worst case at 68, leaving 50 characters for the stage
  name — the one field dennys hands us as a free-form string. Past that you get
  `CustomIdTooLongError` in the logs and *"The stage **X** has too long a name for
  Todd to track this series"* in Discord, raised at stage selection before
  anything is created in dennys.

The logs print the raw `custom_id` on every button and select interaction — start
there.

## Requests to Dennys time out

Default per-attempt timeout is 20 seconds (`API_TIMEOUT_MS`), with 2 retries on
GET only, backing off 500ms then 1s.

- Errors look like `<label>: attempt N failed (TimeoutError)` followed by
  `<label> failed after N attempt(s)`.
- **Non-GET calls are not retried on purpose.** None of the writes are idempotent
  — a replay would issue a second tournament code or record a second result. Do
  not "fix" this by adding retries to them.
- If Dennys is genuinely slow rather than down, raising `API_TIMEOUT_MS` is safe:
  every slow path defers first, so the interaction budget is ~15 minutes, not 3
  seconds.
- If retries are making things worse — Dennys is overloaded and each attempt is
  adding to the pile — `API_RETRIES=0` turns them off. Setting it to `0` used to
  silently leave you with the default 2; it is honored now.

## `npm run build` leaves `dist/commands` empty on Windows

**Cause:** `npm run build` is `tsup src/* --minify`, and glob expansion is done by
the shell. On Windows (`cmd.exe`) the glob is not expanded the way it is under
sh, so subdirectories like `src/commands/` don't get emitted.

**This is a local-only artifact — the Docker build is correct**, because it runs
under Alpine's shell. Don't "fix" the build script to work around it.

**For local work, use `docker compose up --build`**, which builds inside Alpine
and is unaffected. If you specifically need a build on the host, run it from Git
Bash or WSL, or use `npm run build-ws`.

If you do end up with an empty `dist/commands`, the bot logs
`No commands loaded from ... - skipping deploy` and leaves the guild's existing
registrations alone instead of wiping them.

## Getting more detail out of the logs

Every module has its own `loglevel` logger pinned to `info`:

```ts
const logger = log.getLogger('yourModule');
logger.setLevel('info');
```

To dig into a specific area temporarily, change that module's level to `'debug'`
and rebuild. There is no global log-level environment variable.
