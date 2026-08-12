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
3. **Process-level error handlers** are installed for `unhandledRejection` (logs
   and keeps going) and `uncaughtException` (logs and exits 1) — see
   [why rejections are survivable and exceptions are not](#why-rejections-are-survivable-and-exceptions-are-not).
4. **The command loader** reads every `.js` in `dist/commands/`, requires it, and
   registers anything exporting both `data` and `execute` into
   `client.commands`. Subfolders are not scanned.
5. **Login**, and on `ready`, `deployCommands()` pushes the collected command
   definitions to Discord for `GUILD_ID`.

### Command registration on every boot

`src/deploy-commands.ts` does this, in order:

1. Deletes **every global command** on the application. This bot is guild-scoped
   only, so a stray global command would just double up.
2. Bulk `PUT`s the current command set to the guild in **one** call. Discord
   treats this as an overwrite matched by name: existing commands are updated in
   place and keep their command ID, missing ones are removed, new ones created.

Preserving the command IDs matters. Discord's per-command permission overrides
(Server Settings → Integrations — e.g. the staff-only restriction on
`/set-current-event`) are keyed to the command ID, so a single bulk `PUT` keeps
them alive across redeploys. An earlier version cleared the guild's commands to
`[]` first, which minted new IDs on every boot and silently wiped those
restrictions — don't reintroduce that step.

A dev instance must still never point at the live guild: booting it overwrites
production's command set with whatever your branch has.

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
them (with a 5-minute window), not by the global router. A new dropdown in that
flow has to be added to the collector's filter list as well as to `TAG_CODES`,
or it will never fire.

Every dispatch goes through `runGuarded(interaction, label, fn)`, which catches
whatever the handler throws, distinguishes "the interaction is already dead" from
a real error, and reports real errors back to the user without ever throwing
again.

### Choosing between repeat series

Two teams can meet more than once inside a stage — a double round-robin, or a
lower-bracket match and a grand-final rematch, both of which land under the same
`EventStage`. Nothing on the series distinguishes them but the Bo count, and
that is deliberate: two same-shape open series are interchangeable to a
code-issuing service.

`handleTeamSelect` resolves this once teams and stage are chosen, before
anything exists in Dennys:

| Open series for the pair | Behaviour |
| --- | --- |
| 0 | *"Failed to find a matching series for these teams."* |
| 1 | used silently |
| >1, same `totalGames` | lowest id, no prompt |
| >1, different `totalGames` | a fourth dropdown labelled by Bo; Confirm is withheld until one is chosen |

Changing a team or the stage clears a series already chosen against the old
selection, so the prompt reappears rather than carrying a stale id forward.

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

The two Discord error codes involved look similar and mean opposite things, so
they are handled separately:

| Code | Meaning | Handling |
| --- | --- | --- |
| `10062` unknown interaction | The token is dead, usually because we missed the 3s deadline. Nothing can reach the user. | `isExpiredInteraction`. Logged at **warn** and dropped — there is nobody left to apologise to. |
| `40060` already acknowledged | The token is **alive**; we acknowledged it twice. | `isAlreadyAcknowledged`. Logged at **error** and reported to the user like any other bug. |

`40060` was originally folded into `isExpiredInteraction`, which hid bugs: a
handler replying twice produced exactly the same silent warn as a user whose
interaction had expired. The one place it is *not* an error is inside
`safeDefer`, whose postcondition is "this interaction is acknowledged" — 40060
says it already is, so `safeDefer` returns `true` and lets the caller continue
rather than abandoning a live interaction.

Once you have deferred, **`update()` and `reply()` are no longer available** —
answer with `editReply()` instead. That is the usual reason a handler drifts back
off the rule: reaching for `update()` is what forces the dennys call to happen
before the acknowledgement.

The rule is enforced by `test/ackBeforeSlowWork.test.ts`, which stubs the dennys
calls and asserts the *ordering* — every backend call must land after the ack.
It was written after three button handlers had already drifted past the rule
while it was documentation only.

## Why rejections are survivable and exceptions are not

`index.ts` installs both handlers, but they deliberately do opposite things.

**`unhandledRejection` logs and keeps going.** This is not general
defensiveness — it is a fix for a specific outage. A slow Dennys call let the
interaction token expire. The resulting `10062` rejection was unhandled, which
killed the process. pm2 restarted it, and because the selected event group only
lived in a module-level variable at the time, the restart wiped it — so
`/start-series` started telling every captain to file a dev ticket. Two fixes
came out of that: this handler, and `state.ts`.

A stray rejection is a bounded failure: one `await` chain gave up, and the
interaction it belonged to is already lost. Nothing else in the process is
affected, so staying up costs nothing and keeps the other captains served.

**`uncaughtException` logs and exits 1.** An exception that reaches the process
means a *synchronous* call stack was abandoned partway through — a handler that
mutated half its state, a lock never released. Unlike a rejection, the damage
isn't scoped to one interaction, and nothing can tell you what didn't finish.
Continuing from there is guesswork, and a bot that keeps serving from corrupt
state is worse than one that is briefly absent.

Exiting is cheap now, which it wasn't originally: `pm2-runtime` restarts the app
within seconds, and `state.ts` carries the event group across the restart. The
reason this handler once swallowed everything — that restarting is what lost the
event group — no longer holds.

The handler waits ~100ms before calling `process.exit(1)`. Under Docker, stderr
is a pipe and Node writes to it asynchronously, so exiting on the same tick can
truncate the stack trace that explains the crash.

**If you see repeated `Uncaught exception` lines in the logs, that is a bug to
fix, not a handler to soften.**

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
tag : v1 : originalUserId : enemyCaptainId : divisionId : team1Id : team2Id : seriesId : stage
```

- `tag` selects the handler in `src/buttons/handlers.ts`. On the wire it is a
  one- or two-character code (`gc`, not `generate_another_confirm`) from
  `TAG_CODES` in `src/buttons/button.ts` — the tag was the largest field in the
  id, 24 characters spent on a value with thirteen possibilities.
  `parseButtonData` maps it back, so handlers, collector filters and logs only
  ever see the readable name. **Never repurpose a code**: buttons already
  sitting in Discord channels are routed by it.
- `v1` marks the encoding. Ids minted before it put a decimal snowflake in this
  position, which is digits only, so `parseButtonData` tells the two apart and
  still reads the old layout — buttons live in Discord messages, not in Todd, and
  keep arriving after a redeploy.
- `originalUserId` is who started the flow. Handlers allow only that user or the
  enemy captain to act.
- The remaining six fields are `SeriesData`, encoded by `encodeSeriesData` and
  read back by `decodeSeriesData`.
- `seriesId` is the series every later button acts on, pinned the first time it
  is resolved and `0` until then. Without it each press re-resolves from the team
  pair, so the moment Dennys closes one series the next code lands in the other
  one for the same pair. Legacy ids predate it and decode as `0`, which falls
  back to resolving by team pair.

**The 100-character budget.** Discord caps `custom_id` at 100, and in the
original encoding that budget was already spent: the longest tag
(`generate_another_confirm`), two 19-digit snowflakes, three decimal ids and a
stage name the length of `PROMOTION_RELEGATION` came to exactly 100. The next
team id to cross four digits would have pushed a live series over.

Two changes bought it back. Base36 on every id takes a snowflake from 19
characters to 13; wire codes take the tag from 24 to 2.

| | Worst case | Room for the stage name |
| --- | --- | --- |
| Original | 100 | 20 |
| Base36 ids | 86 | 34 |
| ...plus tag codes | 64 | 56 |
| ...plus `seriesId` | **68** | **50** |

That still leaves 32 characters spare, so another id fits without revisiting
this. `test/button.test.ts` pins both the boundary and the remaining headroom, so
the next field can be judged against a measurement rather than an estimate.

`parseButtonData` splits on `:`. Two consequences worth knowing:

- **The stage may contain colons; nothing before it may.** The stage is last so
  that it absorbs the remainder of the split, so `Week 1: Opener` round-trips.
  The fields ahead of it are base36 or a tag, none of which can contain a `:`.
- **The stage is still the field that can overflow.** Dennys returns
  `eventStages` as free-form strings, so its length is not ours to control. 50
  characters fit. Past that, `seriesDataFits` refuses the series at stage
  selection — sized against the *longest* tag code, not the current one, because
  tags grow as a series advances (`s` is 1 character, `gc` is 2) and the late
  failure would land on the button built after the game already exists in
  dennys. `createButtonData(...).serialize()` backstops it by throwing
  `CustomIdTooLongError` rather than letting discord.js answer with a bare
  "Invalid Form Body".

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
  ├─ thread.send: the game code block
  └─ postSeriesControl: status + buttons, always last
```

### The control message

The thread is append-only, so the only way to keep the buttons reachable is to
keep re-posting them last. `src/seriesControl.ts` does that:

1. post the code message (content only);
2. post the control message — status line plus the button row — and keep its id;
3. only then scan the thread and delete every *other* control message.

**The replacement is posted before the old one is removed.** Deleting first would
leave the thread with no working buttons whenever the post then failed, stranding
the captains. Two control messages for a moment is recoverable; none is not.

Cleanup is best-effort and never fails the flow. Because the rule is "delete
every control message except the newest", a skipped delete is corrected on the
next post rather than accumulating — which is also what resolves the race when
both captains generate at once and the loser's delete finds the message already
gone (`10008`).

**A control message is identified by `CONTROL_MARKER` at the start of its
content**, never by "authored by the bot and carries components". Threads created
before this existed carry the old Generate Next Game row on their *draft-links*
message, and a components-only test would delete the draft links. Nothing else
Todd posts may start with that marker.

Code blocks and draft links are permanent. The control message is safe to delete
precisely because everything on it is regenerated from `getSeries` on the next
post.

### Reporting a result

Dennys pulls a played game from Riot whenever a code is issued, so a lost
callback repairs itself on the next press and no one has to report anything. The
Report button exists for the case Riot has no record — always true of a custom
game, since Match-V5 cannot fetch customs on a product API key.

Two rules make it safe, and both are easy to get wrong:

- **It is offered only once the newest code has gone unanswered** (`isCodeStale`,
  10 minutes). Filing sooner is not merely redundant: Dennys finds no game on the
  code yet, records the claim against no code at all, and inserts a *second* row
  for the same match once Riot catches up.
- **The request carries a winner and nothing else.** Todd knows the shortcode it
  issued and must not send it — with two codes outstanding it cannot know which
  the lobby used, and naming the wrong one records a duplicate game. Dennys asks
  Riot instead and falls back to the captain's claim only when Riot has nothing.

A winner is mandatory; Dennys answers 422 to a report without one. The click is
logged with the user id, because a captain can report a winner Riot does not
corroborate and staff need the audit trail.

### When Riot will not give out a code

A code that generates but is dead, and a code that never generates, are different
failures with the same consequence: the captains cannot play. Both reach the same
two exits, because gating the custom path behind "Riot is down" strands anyone
whose code technically works but is unusable.

`isRiotGatewayError` separates this from a lookup failure, and
`isRetryableRiotGatewayError` decides whether pressing again is worth offering:
**503** is Riot unreachable, **502** is a refusal that a retry will not fix.

**A failed code still opens the thread.** Without one, a series played entirely
on customs has nowhere to live and nowhere to report from, so the public header
and thread are posted anyway with the recovery buttons in place of a code.

Replacing a dead code goes through the ordinary issue path rather than a separate
one — a code nobody played produces no game, so reissuing does not advance the
number, which makes a replacement the same operation as the next game.

The custom path confirms before committing, since a custom costs the captains
their stats, and the confirmation is where the scoreboard-screenshot reminder
lives. Confirming posts a *We finished the custom game* button into the thread,
tagged `report_result` so it rejoins the normal flow. That message is deliberately
**not** a control message: the custom is played over the next half hour and the
button has to survive however many codes are issued meanwhile.

### When Dennys will not issue another code

Dennys 1.4.1 caps tournament codes at **two per game, counted since the most
recent recorded game**, and answers `409` with `{ code, message }` past that. The
cap exists because nothing else stops a series burning Riot codes: a code that is
never played leaves no game behind, so a captain pressing Generate could go round
forever.

`isCodeLimitError` classifies it and `dennysErrorMessage` pulls the message out
of the body. **The message is shown as Dennys wrote it, minus the series id** —
the count it names is more use than anything Todd could write in its place, but
the id is not: captains know their series by the two teams in it, and a bare
number in a failure message reads as something they are supposed to act on.
`withoutSeriesId` rewrites Dennys's leading `Series '756' …` to `This game …` and
strips a `for series 756` named mid-sentence; a message that never named one is
passed through untouched. `dennysErrorMessage` returns null for a body that is
not that shape, leaving the caller on its own wording.

The refusal is said **once**, in the thread. Both captains need to see it and
either may act on the buttons, so the handler posts there and deletes its
ephemeral "Generating…" placeholder rather than rewriting it into a second copy
of the same text. The thread send goes first: if it fails, the ephemeral is still
standing to carry the news, and the fallback path uses it when there is no thread
to post to at all.

Two things follow from the cap only lifting when a result is written:

- **Never retried, and no Try again button.** Unlike a 503 there is no moment at
  which the same press starts working, so `buildCodeLimitRow` offers only the two
  things that clear it: **Verify Game N Stats**, which credits a result to the code
  still outstanding (`outstandingCodeId`), and **Go play a custom game**, which
  rejoins the ordinary custom flow. The row is posted with `RECOVERY_MARKER`, so
  the first result to land retires both buttons.
- **A refusal at game 1 still opens the thread**, for the same reason a Riot
  outage does: the series has to be played out somewhere.

Todd counts the allowance itself so it can explain the refusal before the 409
arrives. `remainingCodeAllowance` counts codes whose `createdAt` is after
`lastGameAt` — the same rule Dennys applies — against `TOURNAMENT_CODE_LIMIT`,
and the status line speaks at zero. It returns **null when the count cannot be
worked out**, and null means say nothing: a guess that reads low would announce a
limit Dennys is not applying, and Dennys is the authority either way.

That count is only meaningful because of the rule in
[One game at a time](#one-game-at-a-time). Dennys counts codes since the last
*result*, not per game number, so a series that got a code for game 1 and a code
for game 2 with nothing reported has "2 codes used" — and calling that "no more
codes **for this game**" mis-attributes a series-wide condition to the game a
captain is looking at (todd-bot#129). With generation locked to one game at a
time, every code counted since the last result genuinely belongs to the game in
progress, and the line means what it says. **Zero can only be reached through
Code not working? → Generate a new one**, which is exactly the button it explains
the absence of.

`TOURNAMENT_CODE_LIMIT` is Todd's copy of a server-side rule, so the two can
drift. Setting it *below* what Dennys enforces is safe — the replacement button
disappears early and the 409 path never fires — but setting it above means the
status line promises a code Dennys will refuse. Dennys's own message is always
shown, so the captain reads the real count either way.

### One game at a time

**Generate Next Game is greyed out while a game is in progress**, and reporting
that game is what frees it. `buildControlRow` gates it on `hasOutstandingCode` —
the same predicate that shows **Code not working?** — so the row always carries
exactly one live button, never two and never none.

"Reported" here means any of the three ways a game can land, because
`hasOutstandingCode` reads the series rather than the clicks: the captain pressing
Report, Riot's callback recording the game with nobody pressing anything, or a
custom being reported (which records a game with no code on it, so only the
timestamp ordering shows it). Todd catches up whenever the thread is next
touched, and the sweeps that retire buttons run in the same pass as the control
message being rebuilt — so a retired Report button and a greyed Generate can
never be the final state.

Two things fall out of it, and both were bugs before:

- **The code allowance becomes countable**, as above.
- **A replacement code has exactly one door.** "Code not working?" is the only
  route to a second code for the same game, which is what makes a spent allowance
  mean a captain actually regenerated rather than merely played two games without
  reporting.

A disabled button explains nothing on its own, so the status line carries *"Report
the game in progress to unlock the next one — use the Report button on its code
message above"* whenever it is greyed. Without it, "not yet" and "Todd is broken"
look identical.

That null is why `tournamentCode.createdAt` is wrapped in `advisory()` rather
than being required — see [Validation at the boundary](#validation-at-the-boundary).

### `getTournamentCode`

The one function that talks to everything. Sequentially:

1. `getEvent(divisionId)` — resolves the division name and, if no stage was
   chosen, falls back to its first stage.
2. Rejects `team1 === team2` (*"This is not One For All"*).
3. `getTeam(team1)`, `getTeam(team2)` — resolves display names.
4. `getSeriesId(...)` — only when the series is not already pinned, which is the
   case for a series resolved before the picker existed. **If no such series
   exists in Dennys, the flow stops here** with *"Failed to find a matching
   series for these teams."* Todd never invents a series; the schedule has to
   already be in the backend.
5. `getSeries(seriesId)` — one lookup by id supplying both the Bo count
   (`totalGames`, which decides how many drafts to create) and the game number
   via `nextGameNumber`. These used to be two independent lookups by team pair,
   which could disagree.
6. `issueTournamentCode(seriesId, blue, red)` — `POST /series/{id}/game`. This is
   what mints the Riot tournament code (`shortcode`). **Not idempotent, and
   deliberately never retried** — a replayed request would issue a second code.
   It comes *after* the lookup deliberately: a code is a real Riot artifact, so
   anything that can fail cheaply fails first.
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

Everything Todd needs from the backend, against **Dennys 1.4.1**. All requests
carry `Authorization: Bearer ${DENNYS_TOKEN}`. Calls live in `src/dennys.ts`,
response shapes in `src/dennysSchemas.ts`.

**Paths below are relative to `API_URL`**, which includes the `/api/v1` prefix —
`apiGet` concatenates them on unchanged, so `/eventGroup` here is
`/api/v1/eventGroup` on the wire.

| Method | Path | Used for | Returns |
| --- | --- | --- | --- |
| GET | `/eventGroup` | `/set-current-event` list | `EventGroup[]` |
| GET | `/eventGroup/{id}/events` | Divisions in the active event group | `EventGroupWithEvents` |
| GET | `/event/{id}` | Division name + `eventStages` | `Event` |
| GET | `/event/{id}/teams` | Teams in a division | `EventWithTeams` |
| GET | `/team/{id}` | Team display name | `Team` |
| GET | `/event/{id}/series?teamIds={a}&teamIds={b}&stage={s}&completed=false` | Find the scheduled series | `EventWithSeries` |
| GET | `/series/{id}` | Game number, Bo count, codes and games so far | `SeriesWithGames` |
| POST | `/series/{id}/game` | Issue a Riot tournament code | `TournamentCode` |
| POST | `/series/{id}/results` | Record who won a game | `Game` |
| POST | `/series/{id}/complete` | Close a series by hand | `Series` |
| DELETE | `/series/{id}/complete` | Reopen a closed series | `Series` |

Bodies: `{ blueTeamId, redTeamId }` for the code, `{ winnerTeamId?, loserTeamId?,
tournamentCodeId?, shortcode? }` for a result, `{ winnerTeamId?, loserTeamId? }`
for a completion. **None of the writes are retried** — a replay would issue a
second code, and a result naming no code records a second game.

Failures worth telling apart, all on the code issue: **502** is Riot refusing,
**503** is Riot unreachable, and **409** is Dennys refusing because the game has
used its two-code allowance (1.4.1). Error bodies are `{ code, message }`. See
[When Riot will not give out a code](#when-riot-will-not-give-out-a-code) and
[When Dennys will not issue another code](#when-dennys-will-not-issue-another-code).

A result naming a code is the exception, and Todd depends on it. Dennys returns
the game it already holds for that code with a 200 instead of inserting a second
one, and attributes the result to that game even while other codes are
outstanding. A result naming *no* code gets neither: `SeriesService.reportResult`
pulls from Riot first and hands back whatever that pull turned up, so a custom
game reported alongside a live code can come back as the coded game with the
captain's result dropped. Every report Todd can attribute carries its code; only
customs, which have none, take the codeless path.

Game numbers come from write order regardless — `GameRepository.insert` takes
`max(number) + 1` for the series under an advisory lock, so naming the code does
not influence numbering. Todd shows the number from the thread rather than the
one dennys assigns; see `encodeReportTarget` in `seriesControl.ts`.

Of these, the `/start-series` flow uses only the reads and the code issue. Todd
never completes, reopens or forfeits a series — Dennys closes one automatically
once enough results have been written. `reportSeriesResult`, `completeSeries` and
`reopenSeries` are there for the recovery paths in todd-bot#97.

### Codes and games are different things

This is the change that broke the old client, and the thing to understand before
touching the series flow. Dennys 1.4.0 split what used to be one `games` table:

- A **tournament code** is created the moment it is requested. It has no number.
- A **game** is created when a *result* is written, and carries the number.

So a code that is issued and never played produces no game and consumes no
number. Reissuing a code for game 1 still reads as "Game 1" — under the old
model it announced "Game 2". `nextGameNumber` derives the display number as the
highest game number so far plus one, matching how Dennys assigns it, so a deleted
game leaves a gap rather than colliding.

The practical consequence: **`POST /series/{id}/game` cannot tell you which game
you are on.** That requires `GET /series/{id}`.

`completed=false` on the series lookup matters for the same reason. Once a series
closes automatically, leaving it out of the filter would let the next code for the
same pair land in the series the teams already played.

**All three query params are real server-side filters**, not decoration:
`?teamIds=a&teamIds=b` narrows to series involving exactly that pair (three or
more ids always returns nothing), `?stage=` narrows to that stage, and an
unrecognised stage is rejected with `400 Malformed request body`.
`getSeriesForTeams` still re-checks teams and stage on the returned rows. That is
belt and braces, not a workaround — the series id it produces goes straight to
`issueTournamentCode`, so an exact match is worth confirming locally before
booking a code against the wrong series.

### Validation at the boundary

Every response is parsed through a zod schema in `apiGet`/`apiSend`, after
mojibake repair so the validated strings are the repaired ones. Two rules:

- **Fields Todd reads are strictly required.** A rename or a type change raises
  `DennysSchemaError` at the seam instead of surfacing as `undefined` in a
  Discord message. That is how `logoName`, and later `Game.number`, went
  unnoticed under an unchecked cast.
- **Everything else is wrapped in `unread()`** and degrades to null, so a change
  in a corner Todd ignores cannot take a flow down. Objects are non-strict, so
  unknown keys are stripped and an additive Dennys release is a no-op.

`advisory()` is the deliberate exception to rule one, and currently has exactly
one user: `TournamentCodeDto.createdAt`, which feeds the remaining-code count.
Its consumer treats null as "unknown" and goes quiet, so a rename costs a line of
status text — whereas requiring it would raise `DennysSchemaError` on the code
issue itself and take the whole flow down over that line. Use it only where null
is a genuinely usable answer; everything Todd depends on stays required.

`DennysSchemaError` is deliberately separate from `HttpError`: the latter is
Dennys working and saying no, the former needs a code change here.

Enums are the exception to rule one. `eventStages` flows from the API into a
dropdown and back out as a query param, so an unknown stage is accepted rather
than rejected — see `looseEnum`.

### Where the spec and the server disagree

Ground truth is the Kotlin `@Serializable data class`, not
`src/main/resources/openapi/documentation.yaml`. The spec is hand-written, and
these were verified against the DTOs on `release/1.4.0`:

| Thing | Spec says | Server actually does |
| --- | --- | --- |
| `GET /event/{id}/teams` | array of `EventWithTeamsDto` | one `EventWithTeamsDto` |
| `GET /eventGroup/{id}/events` | array of `EventGroupWithEventsDto` | one `EventGroupWithEventsDto` |
| `TeamDto.logo` | non-nullable `string` | `String?` — usually null |
| `EventStage` | includes `PROMOTION_RELEGATION` | only `REGULAR_SEASON`, `PLAYOFFS` |
| `eventGroupId` on the wrapper DTOs | the event's group | always `null`; the mappers never set it. Only `/event/{id}` carries a real value |
| `ReportResultDto` | `tournamentCodeId` and `shortcode` mutually exclusive | enforced as of 1.4.0 — `SeriesService.reportResult` rejects a request carrying both. 1.3.x accepted both and preferred `tournamentCodeId`, which is what this row used to say |
| Nullable fields | may be absent | always present, explicitly `null` |

The hosted spec (`/swagger/documentation.yaml`) is behind auth and returns 403 to
an unauthenticated fetch, so read the DTOs from a checkout rather than trusting a
copy.

An earlier revision of this section recorded `SeriesDto` as drifting between
`teams: TeamDto[]` and `teamIds: number[]`. That is settled: it is `teamIds`, and
`eventStage` is present. Both are correct in the code.

And one endpoint on the draft backend:

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `{LOWBUDGETLCS_BACKEND_URL}/createFearlessDraft` | `{ team1Name, team2Name, tournamentID, draftCount }` | `{ fearlessCode, team1Code, team2Code }` |

Links are then built as
`{LOWBUDGETLCS_DRAFT_URL}/fearless/{fearlessCode}/{team1Code|team2Code|spectator|stream}`.
