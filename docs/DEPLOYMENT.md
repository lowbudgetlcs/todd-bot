# Deployment and operations

How Todd gets from a merged PR to running in the LBLCS Discord, and how to
operate it once it's there.

## The pipeline

```
push to main
   │
   ▼
GitHub Actions: .github/workflows/deploy.yaml
   │
   ├─ build job   (ubuntu-24.04-arm)
   │    docker build -f Dockerfile
   │    docker push lblcs/todd-bot:latest
   │
   └─ deploy job  (needs: build)
        ssh into the prod server
        cd /lblcs/docker/todd-bot
        docker compose down
        docker compose pull
        docker compose up -d
```

**Merging to `main` deploys to production.** There is no staging environment and
no manual approval step. The workflow skips only doc-ish changes
(`.gitignore`, `**/*.md`, `**/*.txt`, `shell.nix`, `Makefile`, `compose.yaml`) —
the `**/` glob is deliberate so markdown under `docs/` is skipped too, not just
root-level files.

The image is published to Docker Hub as `lblcs/todd-bot:latest`. Only `latest` is
pushed — there are no version tags, so rolling back means re-running an older
commit's workflow or building and pushing by hand.

### Required GitHub secrets

| Secret | Used for |
| --- | --- |
| `DOCKER_USERNAME`, `DOCKER_PAT` | Docker Hub login and push |
| `SSH_HOST`, `SSH_PORT`, `SSH_USERNAME`, `SSH_KEY` | SSH to the production server |

### On the production server

The compose project lives at `/lblcs/docker/todd-bot`. Its `.env` file lives
there too and is **not** in this repo — it is managed by hand on the server. When
you add a required environment variable, update the server's `.env` **before**
merging, or the next deploy will crash-loop at `config.ts`.

## The image

`Dockerfile` is a two-stage build:

```dockerfile
FROM node:22-alpine AS builder     # npm ci (full), npm run build, npm prune --omit=dev
FROM node:22-alpine AS runner      # pm2 + dist/ + prod-only node_modules
CMD [ "npm", "run", "start" ]      # pm2-runtime ./dist/index.js
```

The builder installs **all** dependencies on purpose — `tsup`, the bundler behind
`npm run build`, is a devDependency, so `npm ci --omit=dev` in the builder would
break the build. Dev deps are dropped *after* the build with `npm prune
--omit=dev`, so the runner copies a production-only `node_modules`.

`pm2-runtime` runs pm2 in the foreground so Docker owns the process lifecycle.
pm2 restarts the app if it exits; the container restarts only if Docker is told
to. That restart is load-bearing: on an `uncaughtException` the app logs and
exits 1 deliberately, and pm2 is what brings it back — see
[ARCHITECTURE.md](ARCHITECTURE.md#why-rejections-are-survivable-and-exceptions-are-not).

`compose.yaml` is deliberately minimal: it builds the image, names the container
`todd-bot`, and loads `.env`. No ports are published — the bot makes an outbound
gateway connection and serves nothing.

## Running the production image locally

```sh
docker compose build
docker compose up      # ctrl-c to stop
docker compose down    # tear down before rebuilding
```

With Docker Desktop on Windows, WSL2 must be running first.

Point your local `.env` at a **test** guild before doing this. The bot deletes
and re-registers all slash commands for `GUILD_ID` on boot, so starting a second
instance against the live guild will interfere with production.

## Operations

### Logs

Logs go to stdout and are captured by Docker.

```sh
docker logs -f todd-bot
docker logs --tail 200 todd-bot
```

Everything is logged via `loglevel` at `info`, tagged with the module name
(`index.ts`, `dennys`, `tournament`, `http`, ...). The interaction handlers log
each `custom_id` and the decoded series data, which is usually enough to
reconstruct exactly what a user clicked.

### Restarting

```sh
cd /lblcs/docker/todd-bot
docker compose restart          # quick bounce, keeps the container
docker compose down && docker compose up -d   # full recreate
```

**A full recreate loses the selected event group, and that's expected.**
`data/state.json` lives on the container filesystem, so `down`/`up` wipes it and
`/start-series` replies *"Event group ID is not set. Please create a dev
ticket."* until someone runs `/set-current-event` again. Keep that on your
deploy checklist below.

What must **not** happen is losing it on a crash or a pm2 restart — the container
filesystem survives both, which is exactly why the state is on disk instead of in
a variable. If you ever see the event group reset without a deploy, that's a real
bug; see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

(The state directory can be relocated with `STATE_DIR` if you ever do want to
mount it somewhere persistent.)

### Post-deploy checklist

1. `docker logs --tail 50 todd-bot` — look for `Discord bot is ready! 🤖` and
   `Successfully reloaded application (/) commands.`
2. `/coinflip` in the guild — confirms commands registered.
3. `/set-current-event` — re-select the event group if the container was
   recreated.
4. `/start-series` — confirm the division list is populated.

### Rotating a token

1. Update the value in `/lblcs/docker/todd-bot/.env` on the server.
2. `docker compose down && docker compose up -d`.
3. Re-run `/set-current-event`.

Environment variables are read once at boot; a restart is always required.

## Failure modes to expect

| Symptom | Likely cause |
| --- | --- |
| Container exits immediately, log says `Missing environment variables: ...` | The server's `.env` is missing a variable the new build requires. |
| Bot online, no slash commands visible | `deployCommands` failed — check the log for a REST error, and confirm `DISCORD_CLIENT_ID` and `GUILD_ID` match the bot and guild. |
| Every `/start-series` fails at the division step | Dennys is down or `DENNYS_TOKEN` is stale. `dennys` logger will show the status code. |
| *"Event group ID is not set"* | Container was recreated; run `/set-current-event`. |
| Slash commands vanished from the live guild | Someone booted a dev instance pointed at `GUILD_ID` of production. Restart production to re-register. |

More detail in [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Versioning

`VERSION` (currently `1.1.0`) and `package.json`'s `version` (`0.0.4`) are both
tracked but neither is wired into the build or the image tag. Deployments are
identified by commit, not version.
