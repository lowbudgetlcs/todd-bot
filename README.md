<a id="readme-top"></a>

# Todd Bot 🤖

Bot companion for the [Low Budget LCS](https://lowbudgetlcs.com) Discord.

Todd is a Discord bot that runs LBLCS match logistics. Its main job is
`/start-series`: a captain picks a division, the two teams, and a stage, and Todd
creates the game in the league backend, posts the Riot tournament code, opens a
thread for the series, and drops in fearless-draft links for both teams. It also
handles a few smaller utilities (player point estimates, coin flips).

## Documentation

| Doc | What's in it |
| --- | --- |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local setup, env vars, npm scripts, code conventions |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the bot is wired together, and what happens end to end when someone runs `/start-series` |
| [docs/COMMANDS.md](docs/COMMANDS.md) | Every slash command, button, select menu, and modal |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Docker, CI/CD, production, and how to operate it |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Things that break and what to do about them |

If you are brand new to this repo, read
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) then
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), in that order.

## Quick start

You need [Node.js 22+](https://nodejs.org) and a `.env` file. Docker Desktop is
optional but is the closest thing to how the bot runs in production.

```sh
git clone https://github.com/lowbudgetlcs/todd-bot.git
cd todd-bot
npm install
cp .env.example .env   # then fill it in - see docs/DEVELOPMENT.md
npm run dev            # hot-reloading dev server
```

To run it the way production does:

```sh
docker compose build
docker compose up
# ctrl-c, then:
docker compose down
```

The bot registers its slash commands against the guild in `GUILD_ID` every time
it starts, so point a dev instance at a test server, not the live LBLCS one.

## What Todd talks to

| Service | Env var | Purpose |
| --- | --- | --- |
| Discord | `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `GUILD_ID` | The bot itself |
| [Dennys](https://github.com/lowbudgetlcs/dennys) (LBLCS backend) | `API_URL`, `DENNYS_TOKEN` | Event groups, divisions, teams, series, and game/tournament-code creation |
| LBLCS draft backend | `LOWBUDGETLCS_BACKEND_URL`, `LOWBUDGETLCS_DRAFT_URL` | Fearless draft lobbies and their share links |
| Riot | `RIOT_API_TOKEN` | Client is constructed at boot; see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) |

## License

MIT.

<p align="right">(<a href="#readme-top">back to top</a>)</p>
