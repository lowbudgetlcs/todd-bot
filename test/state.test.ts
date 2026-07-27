import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// state.ts captures STATE_DIR at module-eval time, so the env var must be set
// before it is imported. Use a throwaway temp dir and a dynamic import.
const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'todd-state-'));
const STATE_FILE = path.join(STATE_DIR, 'state.json');
process.env.STATE_DIR = STATE_DIR;

const { loadState, getCurrentEventGroupId, setCurrentEventGroupId } = await import(
  '../src/state.ts'
);

beforeEach(() => {
  // Start each test from a clean slate on disk and in memory.
  if (fs.existsSync(STATE_FILE)) fs.rmSync(STATE_FILE);
  if (fs.existsSync(`${STATE_FILE}.tmp`)) fs.rmSync(`${STATE_FILE}.tmp`);
  loadState();
});

describe('boot with no state file', () => {
  it('falls back to a null event group instead of throwing', () => {
    expect(getCurrentEventGroupId()).toBeNull();
  });
});

describe('write-through persistence', () => {
  it('persists the selected event group to disk and survives a reload', () => {
    setCurrentEventGroupId(42);
    expect(getCurrentEventGroupId()).toBe(42);

    // Simulate a restart: re-read the file from scratch.
    expect(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).currentEventGroupId).toBe(42);
    loadState();
    expect(getCurrentEventGroupId()).toBe(42);
  });

  it('writes atomically, leaving no leftover .tmp file', () => {
    setCurrentEventGroupId(7);
    expect(fs.existsSync(`${STATE_FILE}.tmp`)).toBe(false);
    expect(fs.existsSync(STATE_FILE)).toBe(true);
  });

  it('can clear the selection back to null', () => {
    setCurrentEventGroupId(7);
    setCurrentEventGroupId(null);
    expect(getCurrentEventGroupId()).toBeNull();
    loadState();
    expect(getCurrentEventGroupId()).toBeNull();
  });
});

describe('corrupt or invalid state file must never block boot', () => {
  it('falls back to null when the file is not valid JSON', () => {
    fs.writeFileSync(STATE_FILE, '{ this is not json', 'utf8');
    loadState();
    expect(getCurrentEventGroupId()).toBeNull();
  });

  it('falls back to null when currentEventGroupId is the wrong type', () => {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ currentEventGroupId: 'nope' }), 'utf8');
    loadState();
    expect(getCurrentEventGroupId()).toBeNull();
  });
});
