import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { notifyIfEnabled } from '../application/notification/notifier.js';
import { WorkDir } from '../config/config.js';
import { mentionExcerpt, mentionLink } from './mention-watch.js';
import { getClient } from './orgs.js';

// Scheduled sends and reminders — one main-side queue, persisted, fired by a
// slow tick (a 20s scan beats juggling long setTimeouts across sleep/resume).
// A scheduled MESSAGE posts to its topic as the member, silently, like
// Slack's "send later". A REMINDER notifies the member (always — the user
// set an alarm; do-not-disturb does not swallow explicit alarms) and clicking
// it lands in the topic. Failures retry on later ticks; a message that keeps
// failing surfaces as a notification instead of vanishing.

export interface ScheduledItem {
  id: string;
  kind: 'message' | 'reminder';
  orgId: string;
  spaceId: string;
  topicId: string;
  body: string;
  /** ISO instant to fire at. */
  at: string;
  createdAt: string;
  attempts?: number;
}

const FILE = path.join(WorkDir, 'config', 'spaces_scheduled.json');
const TICK_MS = 20_000;
const MAX_ATTEMPTS = 5;

interface ScheduleFile {
  version: 1;
  items: ScheduledItem[];
}

let items: ScheduledItem[] | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let firing = false;

function load(): ScheduledItem[] {
  if (items) return items;
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8')) as ScheduleFile;
    items = parsed.items ?? [];
  } catch {
    items = [];
  }
  return items;
}

function persist(): void {
  try {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ version: 1, items: load() } satisfies ScheduleFile, null, 2));
  } catch (err) {
    console.error('[spaces:scheduler] failed to persist:', err);
  }
}

async function fire(item: ScheduledItem): Promise<void> {
  if (item.kind === 'reminder') {
    void notifyIfEnabled('space_mention', {
      title: 'Reminder',
      message: mentionExcerpt(item.body),
      link: mentionLink(item.orgId, item.spaceId, item.topicId),
    });
    return;
  }
  await getClient(item.orgId).postMessage(item.spaceId, {
    topicId: item.topicId,
    body: item.body,
    actingMode: 'direct',
  });
}

async function tick(): Promise<void> {
  if (firing) return;
  firing = true;
  try {
    const now = Date.now();
    const due = load().filter((item) => new Date(item.at).getTime() <= now);
    for (const item of due) {
      try {
        await fire(item);
        items = load().filter((x) => x.id !== item.id);
        persist();
      } catch {
        item.attempts = (item.attempts ?? 0) + 1;
        if (item.attempts >= MAX_ATTEMPTS) {
          items = load().filter((x) => x.id !== item.id);
          persist();
          void notifyIfEnabled('space_mention', {
            title: 'Scheduled message failed',
            message: mentionExcerpt(item.body),
            link: mentionLink(item.orgId, item.spaceId, item.topicId),
          });
        } else {
          persist();
        }
      }
    }
  } finally {
    firing = false;
  }
}

export function startSpacesScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
  void tick();
}

export function stopSpacesScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export function scheduleItem(input: Omit<ScheduledItem, 'id' | 'createdAt' | 'attempts'>): ScheduledItem {
  const item: ScheduledItem = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  load().push(item);
  persist();
  return item;
}

export function listScheduled(orgId: string, spaceId: string): ScheduledItem[] {
  return load()
    .filter((item) => item.orgId === orgId && item.spaceId === spaceId)
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function cancelScheduled(id: string): boolean {
  const before = load().length;
  items = load().filter((item) => item.id !== id);
  persist();
  return items.length < before;
}
