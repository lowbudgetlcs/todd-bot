import * as fs from 'fs';
import * as path from 'path';
import log from 'loglevel';

const logger = log.getLogger('state');
logger.setLevel('info');

/**
 * Small write-through store for bot state that has to outlive a process restart.
 *
 * The event group used to live only in a module-level variable in index.ts, so
 * any crash reset it to null and /start-series started telling everyone to file
 * a dev ticket. Reads still come from memory; the file is only touched on write
 * and once at boot.
 *
 * Note: this lives on the container filesystem, so it survives pm2 restarting
 * the process but NOT a redeploy (docker compose down/up recreates the
 * container). Add a volume for /app/data if you want it to survive deploys too.
 */
const STATE_DIR = process.env.STATE_DIR || path.join(process.cwd(), 'data');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

type BotState = {
  currentEventGroupId: number | null;
};

const defaultState: BotState = { currentEventGroupId: null };

let state: BotState = { ...defaultState };

function readStateFile(): BotState {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      logger.info(`No state file at ${STATE_FILE}, starting fresh`);
      return { ...defaultState };
    }
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as Partial<BotState>;
    const id =
      typeof parsed.currentEventGroupId === 'number' ? parsed.currentEventGroupId : null;
    logger.info(`Loaded state from ${STATE_FILE}: currentEventGroupId=${id}`);
    return { currentEventGroupId: id };
  } catch (error) {
    // A corrupt state file must never stop the bot from booting.
    logger.error(`Failed to read state file ${STATE_FILE}, using defaults:`, error);
    return { ...defaultState };
  }
}

function writeStateFile(): void {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    // Write then rename so a crash mid-write can't leave a truncated file.
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
    logger.info(`Persisted state: ${JSON.stringify(state)}`);
  } catch (error) {
    // Persistence is best effort - failing to save must not break the command.
    logger.error(`Failed to persist state to ${STATE_FILE}:`, error);
  }
}

/** Loads persisted state into memory. Call once at startup. */
export function loadState(): void {
  state = readStateFile();
}

export function getCurrentEventGroupId(): number | null {
  return state.currentEventGroupId;
}

/** Updates the event group live and persists it for the next restart. */
export function setCurrentEventGroupId(id: number | null): void {
  state.currentEventGroupId = id;
  writeStateFile();
}
