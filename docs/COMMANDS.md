# Commands and interactions

A reference for every user-facing surface: slash commands, buttons, select
menus, and modals.

## Slash commands

All commands are registered to a single guild (`GUILD_ID`) and re-registered on
every boot.

| Command | Options | What it does |
| --- | --- | --- |
| `/start-series` | `opposing_captain` (user, **required**) | The main flow. Walks you through division → teams → stage, creates the game in Dennys, and posts the tournament code with a thread and draft links. |
| `/set-current-event` | — | Lists event groups from Dennys and sets the one `/start-series` scopes to. Persisted across restarts. |
| `/player_point_calculator` | — | Opens a modal that estimates a player's LBLCS point value from their rank. |
| `/coinflip` | — | Heads or tails. Also the quickest way to check the bot is alive and commands registered. |
| `/team-opgg` | — | **Not implemented.** Throws `'Not Implemented'`. |

None of these are gated **in code** — there is no `setDefaultMemberPermissions`
on any command. Access is restricted two other ways instead: per-interaction
checks inside the button handlers, and Discord's **server-side command
permissions** (Server Settings → Integrations), configured per guild. That is how
`/set-current-event` is limited to staff today.

Those server-side restrictions are keyed to each command's ID. The bot
re-registers commands on every boot, but does so with a single bulk `PUT` that
updates commands in place and **preserves their IDs**
([deploy-commands.ts](../src/deploy-commands.ts)), so an Integrations-level
restriction survives redeploys. (It did not always: an earlier version cleared
the guild's commands to `[]` first, which minted new IDs on every boot and wiped
these restrictions — set one before that fix and you'd have to re-apply it after
each deploy.)

---

### `/start-series`

**File:** [src/commands/tournament.ts](../src/commands/tournament.ts)

The captain who runs it must name the opposing captain up front, because both of
them get to drive the series buttons afterward.

**Steps the user sees:**

1. Ephemeral: *"Please select a division:"* with a dropdown of divisions in the
   current event group.
2. Ephemeral: three dropdowns — **Select Blue Side**, **Select Red Side**,
   **Select Stage**. They can be filled in any order; the message re-renders
   after each pick with the current selections shown as defaults. Until all three
   are set, the message shows a summary with `Not Selected!` for the missing ones.
3. Ephemeral: a confirmation showing blue side, red side, and stage, with
   **✅ Confirm**, **🔄 Switch Sides**, **❌ Cancel**.
4. On confirm the ephemeral message is deleted and a **public** message is posted:

   ```
   ## <Division> - <Stage>
   **__<Blue Team>__ v.s. __<Red Team>__**

   Series Created By: @user
   ```

5. A thread is opened on that message named `<Blue> vs <Red> - YYYY-MM-DD`
   (auto-archive 60 minutes), containing:
   - the four fearless draft links (blue, red, spectator, stream) and a ping for
     the enemy captain;
   - the game code message with the tournament code, who generated it, and the
     enemy captain;
   - once the series is decided, a **post-game form** message — the form is what
     records the match in the standings, and the winning captain fills it in;
   - a **control message**, always last, carrying the series status and the
     buttons. It is deleted and re-posted after every code so it stays at the
     bottom, which means exactly one set of buttons is ever live.

**Failure messages and what they mean:**

| Message | Cause |
| --- | --- |
| *"Event group ID is not set. Please create a dev ticket."* | `currentEventGroupId` is null. `/set-current-event` is restricted to staff via Discord's server-side command permissions (not in code), so regular users can't fix it themselves and are told to escalate. Common after a redeploy — see [TROUBLESHOOTING.md](TROUBLESHOOTING.md). |
| *"No divisions found."* | The event group has no events in Dennys. |
| *"No stages found for the selected division."* | The division has an empty `eventStages`. |
| *"No teams found for the selected division."* | The division has no teams in Dennys. |
| *"This is not One For All. No picking the same champs/teams"* | Blue and red are the same team. |
| *"Failed to find a matching series for these teams."* | Dennys has no scheduled series for that pairing in that stage, or the only one is already complete — the lookup sends `completed=false`. |
| *"Riot is not answering right now..."* | Riot returned 503. The thread is opened anyway with **Try again** and **Go play a custom game**. |
| *"Riot refused to create a code for this game."* | Riot returned 502, which will not succeed on a retry, so only the custom path is offered. |
| *"This game has already been issued 2 tournament code(s)…"* | Dennys 409: this game has spent its code allowance. The message is Dennys's own with the series id taken out, posted once in the thread with **Verify Game N Stats** and **Go play a custom game**. No retry is offered — the allowance clears when a result is written. |
| *"This series has been issued too many tournament codes and is locked."* | Todd's own ceiling: 10 codes on one series. Every button in that thread stops, including reporting, and the dev team is pinged. No thread is opened. See [the lifetime code cap](ARCHITECTURE.md#the-lifetime-code-cap). |
| *"Error generating draft links! Please do so manually :)"* | The draft backend failed. **The tournament code was still created** — only the draft links are missing. |

**Timeouts:** the dropdown collectors live for 5 minutes. After that the menus go
dead silently and the user has to re-run the command.

---

### `/set-current-event`

**File:** [src/commands/setEventGroup.ts](../src/commands/setEventGroup.ts)

Shows an ephemeral dropdown of every event group from Dennys. Picking one sets
`currentEventGroupId` and writes it to `data/state.json`, then confirms with the
group's name and ID.

This must be run before `/start-series` will work at all, and again after any
redeploy that recreates the container.

**Access:** limited to staff through Discord's server-side command permissions
(Server Settings → Integrations), *not* through code. That restriction now
survives redeploys because command registration preserves command IDs — see the
note under [Slash commands](#slash-commands).

---

### `/player_point_calculator`

**Files:** [src/commands/playerPoints.ts](../src/commands/playerPoints.ts),
[src/modals/playerPoint.ts](../src/modals/playerPoint.ts),
[src/utilities/playerPointCalculator.ts](../src/utilities/playerPointCalculator.ts)

Opens a modal (`customId: rankModal`) with three required text fields:

| Field | `customId` | Example |
| --- | --- | --- |
| Solo/Duo Ranked Games in S2025 | `games` | `150` |
| Peak Rank in S2025 | `peak2025` | `G3`, `M32` |
| Peak Rank Since S2024 | `peakSince2024` | `P2`, `M153` |

**Which rank is used:** if `games < 100`, the *peak since S2024* is scored;
otherwise the *peak in S2025* is. The idea being that a low-games season isn't
representative.

**The scale** (`rankToPoints`):

| Rank | Points |
| --- | --- |
| Iron 4 – Bronze 1 | 0 |
| Silver 4 – Silver 1 | 1 |
| Gold 4 / Gold 3 | 2 |
| Gold 2 / Gold 1 | 3 |
| Plat 4 / Plat 3 | 4 |
| Plat 2 / Plat 1 | 5 |
| Emerald 4 / Emerald 3 | 6 |
| Emerald 2 / Emerald 1 | 7 |
| Diamond 4 | 8 |
| Diamond 3 | 9 |
| Diamond 2 | 10 |
| Diamond 1 | 11 |
| Masters+ | `12 + n`, where the input is `M<n>` and `n` is the 75-LP band |

Input format is a letter plus a division number — `I4`, `B1`, `S3`, `G2`, `P1`,
`E4`, `D1` — case-insensitive. Masters and above is `M` followed by the LP band,
so `M0` is 12, `M3` is 15. An unrecognised rank throws `Invalid rank: <input>`.

The reply is ephemeral and explicitly states it is an estimate that staff may
override, referencing rules section **[1.2]**.

**Note:** the modal is hardcoded to the S2025 season in both its title and field
labels. Rolling the season means editing `playerPoints.ts` and, if the point
scale changes, `rankToPoints`.

---

## Buttons

Handlers are dispatched by the `tag` — the first segment of the `custom_id`. The
lookup table is [src/buttons/handlers.ts](../src/buttons/handlers.ts).

| Tag | Label | Handler | Effect |
| --- | --- | --- | --- |
| `confirm` | ✅ Confirm | `handleBothTeamSubmission` | Creates the game and posts the series. |
| `switch` | 🔄 Switch Sides | `handleTeamSelect` | Swaps blue/red during initial setup and re-renders. |
| `cancel` | ❌ Cancel | `handleTeamSelect` | Clears both teams and the stage during setup. |
| `generate_another` | ⚔️ Generate Next Game | `handleGenerateAnotherCode` | Shows the current sides with confirm/switch/cancel. **Greyed out while a game is in progress** — reporting that game unlocks it. |
| `cancel_switch` | — | `handleGenerateAnotherCode` | Alias of the above; returns to the sides prompt. |
| `generate_another_confirm` | ✅ Confirm | `handleGenerateAnotherConfirm` | Creates the next game in the series and posts its code. |
| `switch_sides` | 🔄 Switch Sides | `handleSwitchSides` | Swaps sides for the *next* game and re-confirms. |
| `cancel_flow` | ❌ Cancel | `handleCancel` | Deletes the ephemeral confirmation. |
| `report_result` | 📝 Verify Game N Stats | `handleReportResult` | Opens the winner picker. Only on the control message, and only once the newest code has gone unanswered. |
| `report_team1_won` | 🟦 *<blue team>* won | `handleReportTeam1Won` | Records the winner and refreshes the thread. |
| `report_team2_won` | 🟥 *<red team>* won | `handleReportTeam2Won` | As above, for the other team. |
| `code_not_working` | ❓ Code not working? | `handleCodeNotWorking` | Offers a replacement code or the custom-game path. Shown exactly when Generate Next Game is greyed, and the only route to a second code for the same game. |
| `play_custom` | ⚠️ Go play a custom game | `handlePlayCustom` | Confirms first: no stats, and take a scoreboard screenshot. |
| `play_custom_confirm` | ✅ Yes, we're playing a custom | `handlePlayCustomConfirm` | Posts the *We finished the custom game* button into the thread. |
| `end_series` | — | — | Retired. No button ever used it, and Dennys now closes a series automatically when enough results are written. The wire code stays reserved so a new tag cannot inherit it. |

**Who is allowed to click:** every handler checks `interaction.user.id` against
`data.originalUserId` *or* `seriesData.enemyCaptainId`. Both captains can drive
the series; anyone else gets an ephemeral refusal such as *"Only the person who
generated the original code can generate another one."*

## Select menus

| `customId` | Where it's handled | Purpose |
| --- | --- | --- |
| `select_event_group` | Global router in `index.ts` → `handleEventGroupSelect` | Sets the current event group |
| `division_select` | Collector on the `/start-series` message | Picks a division |
| `team1_select` | Collector | Blue side |
| `team2_select` | Collector | Red side |
| `stage_select` | Collector | Stage within the division |
| `series_select` | Collector | Which series, when the pair has more than one in the stage with different Bo counts. Not shown otherwise. |

Only `select_event_group` goes through the global interaction router. The series
menus are bound to collectors with a 5-minute lifetime and a filter that pins
them to the user who ran the command, so they stop working once that window
closes.

## Modals

| `customId` | Handler | Purpose |
| --- | --- | --- |
| `rankModal` | `handleModal` | Player point calculator |

`handleModal` returns early on any other `customId`, so adding a second modal
means extending that function (or routing on `customId` before it).
