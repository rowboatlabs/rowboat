import fs from 'node:fs';
import path from 'node:path';
import { mentionsMember, type MentionIdentity } from '@x/shared/dist/spaces.js';
import type { Member, ServerFrame } from '@rowboat/spaces-protocol';
import { notifyIfEnabled } from '../application/notification/notifier.js';
import type { NotifyInput } from '../application/notification/service.js';
import { WorkDir } from '../config/config.js';
import { getClient, getLive, listOrgs } from './orgs.js';

// Space mention notifications: main-side watcher that subscribes to EVERY
// space of every org (independent of what's on screen), scans incoming
// messages for a mention of me — by display name (what the composer types;
// member ids are opaque IdP subjects) or by id (agent-written, older
// messages) — and notifies, suppressed while the app is focused
// (onlyWhenBackground) and gated by the 'space_mention' category.
//
// Offsets are persisted per space so a relaunch replays what arrived while
// the app was closed: fresh mentions notify individually, older ones fold
// into one "while you were away" summary per space.

const OFFSETS_FILE = path.join(WorkDir, 'config', 'spaces_mention_offsets.json');

/** Older than this at arrival = it happened while we weren't watching. */
const MISSED_THRESHOLD_MS = 90_000;
/** At most one individual notification per topic per window; extras stay in-app unread. */
const TOPIC_COOLDOWN_MS = 45_000;
/** Missed mentions are summarised after the replay settles. */
const MISSED_DEBOUNCE_MS = 3_000;
const RESYNC_INTERVAL_MS = 5 * 60_000;
/** Unforced syncs (e.g. the renderer listing spaces) coalesce into this window. */
const SOFT_SYNC_WINDOW_MS = 15_000;
/** An org that was unreachable is retried sooner than the slow loop. */
const UNREACHABLE_RETRY_MS = 30_000;

// --- pure helpers (tested) ---------------------------------------------------

export interface MentionHit {
  orgId: string;
  spaceId: string;
  spaceName: string;
  topicId: string;
  authorName: string;
  body: string;
}

export function isMissedArrival(postedAt: string, now: number = Date.now()): boolean {
  const t = new Date(postedAt).getTime();
  return Number.isFinite(t) && now - t > MISSED_THRESHOLD_MS;
}

export function mentionLink(orgId: string, spaceId: string, topicId?: string): string {
  const topic = topicId ? `&topicId=${encodeURIComponent(topicId)}` : '';
  return `rowboat://open?type=spaces&orgId=${encodeURIComponent(orgId)}&spaceId=${encodeURIComponent(spaceId)}${topic}`;
}

/** Message body → one notification-sized line (markdown scaffolding dropped). */
export function mentionExcerpt(body: string, max = 140): string {
  const flat = body
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/^[ \t]*>.*$/gm, ' ')
    .replace(/[`*_#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function buildMentionNotify(hit: MentionHit): NotifyInput {
  return {
    title: `${hit.authorName} mentioned you · ${hit.spaceName}`,
    message: mentionExcerpt(hit.body),
    link: mentionLink(hit.orgId, hit.spaceId, hit.topicId),
    onlyWhenBackground: true,
  };
}

export function buildMissedSummaryNotify(input: {
  orgId: string;
  spaceId: string;
  spaceName: string;
  count: number;
  /** When every missed mention sits in one topic, click lands there. */
  soleTopicId?: string;
}): NotifyInput {
  return {
    title: `While you were away · ${input.spaceName}`,
    message: `${input.count} ${input.count === 1 ? 'mention' : 'mentions'} of you`,
    link: mentionLink(input.orgId, input.spaceId, input.soleTopicId),
    onlyWhenBackground: true,
    // The summary IS the replay burst — never drop it to the startup grace.
  };
}

// --- offset store ------------------------------------------------------------

interface OffsetsFile {
  version: 1;
  offsets: Record<string, number>;
}

function readOffsets(): Record<string, number> {
  try {
    const parsed = JSON.parse(fs.readFileSync(OFFSETS_FILE, 'utf8')) as OffsetsFile;
    return parsed.offsets ?? {};
  } catch {
    return {};
  }
}

function writeOffsets(offsets: Record<string, number>): void {
  try {
    const dir = path.dirname(OFFSETS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(OFFSETS_FILE, JSON.stringify({ version: 1, offsets } satisfies OffsetsFile, null, 2));
  } catch (err) {
    console.error('[spaces:mentions] failed to persist offsets:', err);
  }
}

// --- the watcher ---------------------------------------------------------

interface SpaceSub {
  memberId: string;
  unsubscribe: () => void;
}

interface MissedBucket {
  count: number;
  topicIds: Set<string>;
  spaceName: string;
  timer: ReturnType<typeof setTimeout>;
}

const subs = new Map<string, SpaceSub>();
const memberNames = new Map<string, Map<string, string>>();
const topicCooldown = new Map<string, number>();
const missed = new Map<string, MissedBucket>();
let offsets = readOffsets();
let offsetsFlush: ReturnType<typeof setTimeout> | null = null;
let resyncTimer: ReturnType<typeof setInterval> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let lastSyncAt = 0;
let syncing = false;

function key(orgId: string, spaceId: string): string {
  return `${orgId}/${spaceId}`;
}

function noteOffset(k: string, offset: number): void {
  if ((offsets[k] ?? -1) >= offset) return;
  offsets[k] = offset;
  if (offsetsFlush) return;
  offsetsFlush = setTimeout(() => {
    offsetsFlush = null;
    writeOffsets(offsets);
  }, 2_000);
}

function authorName(k: string, memberId: string): string {
  return memberNames.get(k)?.get(memberId) ?? memberId;
}

function queueMissed(k: string, orgId: string, spaceId: string, spaceName: string, topicId: string): void {
  const existing = missed.get(k);
  if (existing) {
    existing.count += 1;
    existing.topicIds.add(topicId);
    existing.timer.refresh();
    return;
  }
  const bucket: MissedBucket = {
    count: 1,
    topicIds: new Set([topicId]),
    spaceName,
    timer: setTimeout(() => {
      missed.delete(k);
      void notifyIfEnabled('space_mention', buildMissedSummaryNotify({
        orgId,
        spaceId,
        spaceName: bucket.spaceName,
        count: bucket.count,
        ...(bucket.topicIds.size === 1 ? { soleTopicId: [...bucket.topicIds][0] } : {}),
      }));
    }, MISSED_DEBOUNCE_MS),
  };
  missed.set(k, bucket);
}

function makeHandler(orgId: string, spaceId: string, spaceName: string, me: MentionIdentity): (frame: ServerFrame) => void {
  const k = key(orgId, spaceId);
  return (frame) => {
    if (frame.kind !== 'event') return;
    noteOffset(k, frame.offset);
    if (frame.event.type !== 'message') return;
    const message = frame.event.message;
    if (message.author.memberId === me.id) return;
    // People type the NAME (ids are opaque); agent-written mentions may carry the id.
    if (!mentionsMember(message.body, me)) return;

    if (isMissedArrival(message.postedAt)) {
      queueMissed(k, orgId, spaceId, spaceName, message.topicId);
      return;
    }
    const cooldownKey = `${k}/${message.topicId}`;
    const last = topicCooldown.get(cooldownKey) ?? 0;
    if (Date.now() - last < TOPIC_COOLDOWN_MS) return;
    topicCooldown.set(cooldownKey, Date.now());
    void notifyIfEnabled('space_mention', buildMentionNotify({
      orgId,
      spaceId,
      spaceName,
      topicId: message.topicId,
      authorName: authorName(k, message.author.memberId),
      body: message.body,
    }));
  };
}

/**
 * Bring subscriptions in line with the org registry: subscribe every space of
 * every org, drop subscriptions to spaces that vanished, re-subscribe when the
 * org's identity changed. Safe to call often; concurrent calls coalesce, and
 * unforced calls (the renderer listing spaces) collapse into a short window.
 *
 * An org that is unreachable — down at boot, restarted, or just reconnected —
 * keeps its existing subscriptions and is retried on a short timer, so a space
 * that appears while we were away still gets watched without waiting out the
 * slow loop.
 */
export async function syncSpaceMentionWatch(opts?: { force?: boolean }): Promise<void> {
  if (syncing) return;
  if (!opts?.force && Date.now() - lastSyncAt < SOFT_SYNC_WINDOW_MS) return;
  syncing = true;
  let unreachable = false;
  try {
    const wanted = new Set<string>();
    for (const org of listOrgs()) {
      let spaces;
      try {
        spaces = await getClient(org.id).listSpaces();
      } catch {
        // Org unreachable right now — keep its subscriptions and try again soon.
        unreachable = true;
        for (const k of subs.keys()) if (k.startsWith(`${org.id}/`)) wanted.add(k);
        continue;
      }
      for (const space of spaces) {
        const k = key(org.id, space.id);
        wanted.add(k);
        const existing = subs.get(k);
        if (existing && existing.memberId === org.auth.memberId) continue;
        existing?.unsubscribe();

        // Member names: notification titles, and my own display name — the form
        // teammates actually type when they mention me.
        try {
          const members: Member[] = await getClient(org.id).listMembers(space.id);
          memberNames.set(k, new Map(members.map((m) => [m.id, m.displayName])));
        } catch {
          // ids stand in for names
        }

        const myName = memberNames.get(k)?.get(org.auth.memberId);
        const handler = makeHandler(org.id, space.id, space.name, {
          id: org.auth.memberId,
          ...(myName ? { displayName: myName } : {}),
        });
        const stored = offsets[k];
        const unsubscribe = getLive(org.id).subscribe(space.id, handler, stored);
        subs.set(k, { memberId: org.auth.memberId, unsubscribe });
      }
    }
    for (const [k, sub] of subs) {
      if (!wanted.has(k)) {
        sub.unsubscribe();
        subs.delete(k);
      }
    }
  } finally {
    syncing = false;
    lastSyncAt = Date.now();
    if (unreachable && !retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void syncSpaceMentionWatch({ force: true });
      }, UNREACHABLE_RETRY_MS);
      retryTimer.unref?.();
    }
  }
}

/** Boot the watcher: initial sync + a slow re-sync loop (new spaces/orgs). */
export function startSpaceMentionWatch(): void {
  void syncSpaceMentionWatch({ force: true });
  if (!resyncTimer) {
    resyncTimer = setInterval(() => void syncSpaceMentionWatch({ force: true }), RESYNC_INTERVAL_MS);
    resyncTimer.unref?.();
  }
}

export function stopSpaceMentionWatch(): void {
  if (resyncTimer) clearInterval(resyncTimer);
  resyncTimer = null;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  for (const sub of subs.values()) sub.unsubscribe();
  subs.clear();
  for (const bucket of missed.values()) clearTimeout(bucket.timer);
  missed.clear();
  if (offsetsFlush) {
    clearTimeout(offsetsFlush);
    offsetsFlush = null;
    writeOffsets(offsets);
  }
}
