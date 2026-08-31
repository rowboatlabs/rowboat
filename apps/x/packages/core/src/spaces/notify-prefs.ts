import fs from 'node:fs';
import path from 'node:path';
import { WorkDir } from '../config/config.js';

// Notification levels for the space mention watcher (mention-watch.ts):
// 'mentions' is the default everywhere (notify on @you/@here only); 'all'
// notifies on every message; 'mute' on none. A topic override beats the
// space level beats the default. Stored main-side, next to the watcher's
// offsets — the watcher notifies with the renderer closed, so its prefs
// can't live in renderer localStorage.

export type NotifyLevel = 'all' | 'mentions' | 'mute';

interface SpacePrefs {
  level?: NotifyLevel;
  topics: Record<string, NotifyLevel>;
}

interface PrefsFile {
  version: 1;
  spaces: Record<string, SpacePrefs>;
  /** Do-not-disturb until this ISO instant (absent/past = off). */
  dnd?: string;
}

const PREFS_FILE = path.join(WorkDir, 'config', 'spaces_notify_prefs.json');

let prefs: Record<string, SpacePrefs> | null = null;
let dndUntil: string | null = null;

function key(orgId: string, spaceId: string): string {
  return `${orgId}/${spaceId}`;
}

function load(): Record<string, SpacePrefs> {
  if (prefs) return prefs;
  try {
    const parsed = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')) as PrefsFile;
    prefs = parsed.spaces ?? {};
    dndUntil = parsed.dnd ?? null;
  } catch {
    prefs = {};
  }
  return prefs;
}

function persist(): void {
  try {
    const dir = path.dirname(PREFS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      PREFS_FILE,
      JSON.stringify({ version: 1, spaces: load(), ...(dndUntil ? { dnd: dndUntil } : {}) } satisfies PrefsFile, null, 2),
    );
  } catch (err) {
    console.error('[spaces:notify-prefs] failed to persist:', err);
  }
}

export function getDndUntil(): string | null {
  load();
  if (dndUntil && new Date(dndUntil).getTime() <= Date.now()) dndUntil = null;
  return dndUntil;
}

export function setDndUntil(until: string | null): void {
  load();
  dndUntil = until;
  persist();
}

/** True while do-not-disturb holds — the watcher drops everything, mentions included. */
export function dndActive(): boolean {
  return getDndUntil() !== null;
}

export function getNotifyPrefs(orgId: string, spaceId: string): { spaceLevel: NotifyLevel | null; topics: Record<string, NotifyLevel> } {
  const space = load()[key(orgId, spaceId)];
  return { spaceLevel: space?.level ?? null, topics: { ...(space?.topics ?? {}) } };
}

export function setNotifyPref(orgId: string, spaceId: string, topicId: string | undefined, level: NotifyLevel | null): void {
  const all = load();
  const k = key(orgId, spaceId);
  const space = all[k] ?? { topics: {} };
  if (topicId) {
    if (level) space.topics[topicId] = level;
    else delete space.topics[topicId];
  } else if (level) {
    space.level = level;
  } else {
    delete space.level;
  }
  if (!space.level && Object.keys(space.topics).length === 0) delete all[k];
  else all[k] = space;
  persist();
}

/** The effective level for one message's destination: topic override → space level → 'mentions'. */
export function notifyLevelFor(orgId: string, spaceId: string, topicId: string): NotifyLevel {
  const space = load()[key(orgId, spaceId)];
  return space?.topics[topicId] ?? space?.level ?? 'mentions';
}
