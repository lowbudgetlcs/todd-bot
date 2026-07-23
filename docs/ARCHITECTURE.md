# Architecture

How Todd is put together, and what actually happens when someone runs
`/start-series`.

## The shape of the thing

Todd is a single-process Node application. It holds one gateway connection to
Discord, keeps essentially no state in memory, and does its real work by calling
two HTTP services.

```
                  ┌──────────────────────────────┐
   Discord ◄──────┤  todd-bot (this repo)        │
   gateway        │                              │
                  │  index.ts   interaction      │
                  │             router           │
                  │  dennys.ts  ─────────────────┼──► Dennys (LBLCS backend)
                  │  util.ts    ─────────────────┼──► LBLCS draft backend
                  │  state.ts   ──► data/state.json
                  └──────────────────────────────┘
```

- **Dennys** is the LBLCS backend and the source of truth for the league: event
  groups (seasons/splits), events (divisions) and their stages, teams, series,
  and games. Todd creates a game there and Dennys returns the Riot tournament
  code (`shortcode`). It has its own repository in the
  [lowbudgetlcs/dennys](https://github.com/lowbudgetlcs/dennys) repository — read
  it if you need to change the contract; everything Todd currently needs from it
  is in the [endpoint table](#the-dennys-contract) below.
- **The draft backend** creates fearless-draft lobbies. Todd `POST`s to
  `LOWBUDGETLCS_BACKEND_URL/createFearlessDraft` and turns the response into
  share links pointed at `LOWBUDGETLCS_DRAFT_URL`.

There is **no database in this repo**. Earlier versions used Drizzle and Postgres
directly; that was replaced by the Dennys API and the ORM is gone.

## Boot sequence

`src/index.ts`, top to bottom:

1. **`config.ts` is imported**, which reads `.env` and throws if a required
   variable is missing. A misconfigured bot dies here, loudly.
2. **`loadState()`** reads `data/state.json` into memory, restoring the selected
   event group.
3. **Process-level error handlers** are installed for `unhandledRejection` and
   `uncaughtException`. They log and keep the process alive — see
   [why the bot refuses to die](#why-the-bot-refuses-to-die).
4. **The command loader** reads every `.js` in `dist/commands/`, requires it, and
   registers anything exporting both `data` and `execute` into
   `client.commands`. Subfolders are not scanned.
5. **Login**, and on `ready`, `deployCommands()` pushes the collected command
   definitions to Discord for `GUILD_ID`.

### Command registration is destructive on every boot

`src/deploy-commands.ts` does this, in order:

1. Deletes **every global command** on the application.
2. `PUT`s an empty array to the guild's commands, clearing them.
3. `PUT`s the current command set to the guild.

That is why a dev instance must never point at the live guild: booting it wipes
production's commands and replaces them with whatever your branch has. The
clear-then-set dance exists so renamed or deleted commands don't linger.

## The interaction router

Everything the user does arrives as one `InteractionCreate` event. `index.ts`
dispatches on the interaction type:

| Interaction type | Routed to |
| --- | --- |
| Button | `parseButtonData(customId).tag` → `getButtonHandler(tag)` |
| Modal submit | `handleModal` in `src/modals/playerPoint.ts` |
| String select with `customId === 'select_event_group'` | `handleEventGroupSelect` |
| Chat input command | `client.commands.get(name).execute(interaction, currentEventGroupId)` |

Other string-select menus are **not** routed here. The series flow's dropdowns
are handled by message component collectors attached to the message that created
them (with a 5-minute window), not by the global router.

Every dispatch goes through `runGuarded(interaction, label, fn)`, which catches
whatever the handler throws, distinguishes "the interaction is already dead" from
a real error, and reports real errors back to the user without ever throwing
again.

## The 3-second rule

Discord gives you **3 seconds** to acknowledge an interaction. Miss it and the
token is dead; every later call with it fails with error `10062` *Unknown
interaction*.

Dennys is sometimes slower than that. So the rule in this codebase is:

> Acknowledge first, then do the slow thing.

`src/interactionSafety.ts` provides the three helpers that implement it:

- **`safeDefer(interaction, opts)`** — defers before slow work, extending the
  budget from 3 seconds to ~15 minutes. Use `{ update: true }` for component
  interactions (edits the existing message) and `{ ephemeral: true }` for
  commands. It returns `false` if the interaction was already dead, and callers
  are expected to bail immediately rather than do work they can't report.
- **`safeInteractionError(interaction, content)`** — reports an error on
  whichever channel is still valid (`editReply` / `followUp` / `reply`) and
  swallows failures. The old error path called `followUp()` unconditionally,
  which threw a second time on a dead token and took the process down.
- **`runGuarded(interaction, label, fn)`** — wraps a handler so a rejection is
  logged and reported, never unhandled.

Codes `10062` (unknown interaction) and `40060` (already acknowledged) are
treated as "the user's interaction is gone" and logged at warn level, not error.

## Why the bot refuses to die

`index.ts` installs `unhandledRejection` and `uncaughtException` handlers that
log and keep going. This is not general defensiveness — it is a fix for a
specific outage:

A slow Dennys call let the interaction token expire. The resulting `10062`
rejection was unhandled, which killed the process. pm2 restarted it, and because
the selected event group only lived in a module-level variable at the time, the
restart wiped it — so `/start-series` started telling every captain to file a dev
ticket. Two fixes came out of that: these handlers, and `state.ts`.

## State

`src/state.ts` is a small write-through store. Reads come from memory; the file
is only touched at boot and on write.

Today it holds exactly one thing: `currentEventGroupId`, the event group
(season/split) that `/start-series` scopes its division list to, set via
`/set-current-event`.

Writes go to a temp file and are then renamed, so a crash mid-write cannot leave
a truncated `state.json`. A corrupt or missing file falls back to defaults rather
than blocking boot.

**The durability boundary is deliberate.** The file lives on the container
filesystem, so it survives a crash or a pm2 restart — which is the case it exists
for — but not a redeploy, since `docker compose down`/`up` recreates the
container. Losing the selection on deploy is fine and expected: someone re-runs
`/set-current-event` afterward. Losing it on a *restart* is the bug this module
was written to fix.

## State lives in the `custom_id`

Discord gives you no session. When a user clicks a button, all you get back is
the component's `custom_id` string. Todd therefore encodes the entire series
context into that string, so every handler is stateless and any button remains
valid regardless of restarts.

The format (`src/buttons/button.ts` + `src/types/toddData.ts`):

```
tag : originalUserId : enemyCaptainId : divisionId : team1Id : team2Id : stage
```

- `tag` selects the handler in `src/buttons/handlers.ts`.
- `originalUserId` is who started the flow. Handlers allow only that user or the
  enemy captain to act.
- The remaining five fields are `SeriesData`, encoded by `encodeSeriesData` and
  read back by `decodeSeriesData`.

`parseButtonData` splits on `:` and hands back a `ButtonData`. Two consequences
worth knowing:

- **Nothing here may contain a colon.** Stage names are put into the id verbatim,
  so a stage named `Week 1: Opener` would corrupt parsing.
- **Discord caps `custom_id` at 100 characters.** Two snowflake IDs alone are
  ~38, so long stage names are the realistic thing that pushes it over.

## The `/start-series` flow, end to end

This is the core of the bot. Files: `src/commands/tournament.ts`, with button
handlers under `src/buttons/handlers/`.

```
/start-series opposing_captain:@user
  │
  ├─ safeDefer(ephemeral)
  ├─ currentEventGroupId null? → "Please create a dev ticket." STOP
  ├─ getEvents(eventGroupId)                        GET /eventGroup/{id}/events
  └─ show division dropdown  ─────────────────────► collector (5 min)
                                                      │
handleDivisionSelect                                  │
  ├─ safeDefer({ update: true })                      │
  ├─ getEvent(divisionId)      → stages          GET /event/{id}
  ├─ getEventWithTeams(divisionId) → teams       GET /event/{id}/teams
  └─ show 3 dropdowns: Blue Side, Red Side, Stage ──► collector (5 min)
                                                      │
handleTeamSelect  (runs on every dropdown change)     │
  ├─ merges the new value into SeriesData             │
  ├─ re-renders all three dropdowns with defaults set │
  └─ once all three are set → [Confirm] [Switch Sides] [Cancel]
                                                      │
handleBothTeamSubmission  (tag: confirm)              │
  ├─ safeDefer({ update: true })      ← the slowest path in the bot
  ├─ getTournamentCode(...)  (see below)
  ├─ deletes the ephemeral setup message
  ├─ followUp: public "Division - Stage / Blue vs Red" message
  ├─ startThread(buildThreadName(...))
  ├─ thread.send: draft links + [Generate Next Game]
  └─ thread.send: the game code block
```

### `getTournamentCode`

The one function that talks to everything. Sequentially:

1. `getEvent(divisionId)` — resolves the division name and, if no stage was
   chosen, falls back to its first stage.
2. Rejects `team1 === team2` (*"This is not One For All"*).
3. `getTeam(team1)`, `getTeam(team2)` — resolves display names.
4. `getSeriesId(...)` — finds the scheduled series matching both teams and the
   stage. **If no such series exists in Dennys, the flow stops here** with
   *"Failed to find a matching series for these teams."* Todd never invents a
   series; the schedule has to already be in the backend.
5. `createGame(seriesId, blue, red)` — `POST /series/{id}/game`. This is what
   mints the Riot tournament code (`shortcode`). **Not idempotent, and
   deliberately never retried** — a replayed request would double-book a game.
6. `getTotalGames(...)` — series length, used to decide how many drafts to
   create.
7. On the first game only, `getDraftLinksMarkdown(...)` — `POST
   LOWBUDGETLCS_BACKEND_URL/createFearlessDraft`, producing blue, red, spectator,
   and stream links. This one is best-effort: on failure it returns *"Error
   generating draft links! Please do so manually :)"* rather than aborting the
   series, because the tournament code is the part that matters.

It returns a result object with an `error: string | null` field. Callers check
`error` rather than catching — most failures inside are turned into a friendly
message, and only unexpected throws propagate to `runGuarded`.

### Subsequent games

The **Generate Next Game** button in the thread carries the same `SeriesData`, so
games 2..n need no re-selection:

```
generate_another  ──► "Current sides" + [Confirm] [Switch Sides] [Cancel]
                          │              │
      generate_another_confirm      switch_sides  (swaps blue/red, re-confirms)
                          │
                 getTournamentCode(first = false)   ← no new draft links
                          │
                 public message with the next code
```

`handleGenerateAnotherConfirm` also flips the "enemy captain" perspective, so
whichever of the two captains clicks is treated as the generator and the other as
the opponent.

## HTTP: `src/http.ts`

Every outbound call goes through `fetchWithRetry`, which adds:

- **A real timeout** per attempt (`AbortSignal.timeout`, default 20s). Bare
  `fetch` has none, and a hung connection would otherwise hang the handler until
  the interaction token expired.
- **Bounded retries with exponential backoff** (500ms, 1s, ...) on 408, 429, and
  5xx. 4xx is not retried — it will not get better.
- **Method-aware defaults**: GET retries twice; anything else retries zero times
  unless the call site explicitly opts in. This is what stops a flaky network
  from creating duplicate games.
- **`HttpError`**, carrying status and body, so callers can distinguish a
  backend rejection from a transport failure.

## Text encoding: `src/encoding.ts`

Team names come back from Dennys occasionally mojibake'd — UTF-8 bytes that were
decoded as Latin-1 somewhere upstream, so `'` arrives as `â€™`. Discord then
renders the garbage, and in bad cases a lone surrogate makes a thread name
invalid.

`normalizeApiStrings` walks every parsed response and repairs strings in one
place, so no call site has to think about it. The repair is conservative:

- Only strings whose code points all fit in a byte are candidates. Anything
  above `0xff` means real Unicode survived and is left alone.
- Decoding uses `fatal: true`, so a name that is *legitimately* Latin-1 — `Café`
  is `[43 61 66 E9]`, not valid UTF-8 — throws and the original is kept rather
  than corrupted.
- It runs up to three passes, because names sometimes arrive double-encoded.

`parseJsonResponseUtf8` reads the raw `arrayBuffer` and decodes it explicitly as
UTF-8, stripping a BOM if present, instead of trusting `response.json()` to have
guessed the charset correctly.

Related: `buildThreadName` in `util.ts` trims **team names, never the date** to
fit Discord's 100-character thread name cap, truncating by code point so a
surrogate pair is never cut in half. Without it, two long team names threw
*Invalid Form Body* from `startThread()` — after the public message had already
been posted, leaving a series announced with no thread.

## The Dennys contract

Everything Todd needs from the backend. All requests carry
`Authorization: Bearer ${DENNYS_TOKEN}`. Defined in `src/dennys.ts`.

| Method | Path | Used for | Returns |
| --- | --- | --- | --- |
| GET | `/eventGroup` | `/set-current-event` list | `eventGroup[]` |
| GET | `/eventGroup/{id}/events` | Divisions in the active event group | `{ events: Event[] }` |
| GET | `/event/{id}` | Division name + `eventStages` | `Event` |
| GET | `/event/{id}/teams` | Teams in a division | `EventWithTeams` |
| GET | `/team/{id}` | Team display name | `Team` |
| GET | `/event/{id}/series?teamIds={a}&teamIds={b}&stage={s}` | Find the scheduled series, and its `totalGames` | `Series[]` or `{ series: Series[] }` |
| POST | `/series/{id}/game` | Create a game; **this returns the tournament code** | `Game` (`{ id, shortcode, number, ... }`) |

Body for the POST is `{ blueTeamId, redTeamId }`.

The series lookup accepts both a bare array and a `{ series: [...] }` wrapper,
then filters client-side for an entry whose `teamIds` contains both teams — the
query parameters are treated as a hint, not a guarantee.

And one endpoint on the draft backend:

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `{LOWBUDGETLCS_BACKEND_URL}/createFearlessDraft` | `{ team1Name, team2Name, tournamentID, draftCount }` | `{ fearlessCode, team1Code, team2Code }` |

Links are then built as
`{LOWBUDGETLCS_DRAFT_URL}/fearless/{fearlessCode}/{team1Code|team2Code|spectator|stream}`.
