import fs from 'node:fs';
import path from 'node:path';
import { containsHereAddress, mentionsMember, resolveMentions, type MentionIdentity } from '@x/shared/dist/spaces.js';
import type { Member, ServerFrame } from '@rowboat/spaces-protocol';
import { notifyIfEnabled } from '../application/notification/notifier.js';
import type { NotifyInput } from '../application/notification/service.js';
import { WorkDir } from '../config/config.js';
import { dndActive, notifyLevelFor } from './notify-prefs.js';
import { getClient, getLive, listOrgs } from './orgs.js';

// Space mention notifications: main-side watcher that subscribes to EVERY
// space of every org (independent of what's on screen), scans incoming
// messages for a mention of me — by display name (what the composer types;
// member ids are opaque IdP subjects), by id (agent-written, older
// messages), or via @here (everyone online, Slack-style) — and notifies,
// suppressed while the app is focused (onlyWhenBackground) and gated by the
// 'space_mention' category.
//
// Offsets are persisted per space so a relaunch replays what arrived while
// the app was closed: fresh mentions notify individually, older ones fold
// into one "while you were away" summary per space.

const OFFSETS_FILE = path.join(WorkDir, 'config', 'spaces_mention_offsets.json');

/** Older than this at arrival = it happened while we weren't watching. */
const MISSED_THRESHOLD_MS = 90_000;
/** At most one individual notification per thread per window; extras stay in-app unread. */
const THREAD_COOLDOWN_MS = 45_000;
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
  /** The conversation the mention lives in: the message's thread root (its own id when it IS a root). */
  threadRootId: string;
  authorName: string;
  body: string;
  /**
   * 'you' = addressed me by name/id; 'here' = @here, addressed everyone
   * online; 'message' = no mention — sent only when the destination's notify
   * level is 'all'.
   */
  kind: 'you' | 'here' | 'message';
}

export function isMissedArrival(postedAt: string, now: number = Date.now()): boolean {
  const t = new Date(postedAt).getTime();
  return Number.isFinite(t) && now - t > MISSED_THRESHOLD_MS;
}

export function mentionLink(orgId: string, spaceId: string, threadRootId?: string): string {
  const thread = threadRootId ? `&threadRootId=${encodeURIComponent(threadRootId)}` : '';
  return `rowboat://open?type=spaces&orgId=${encodeURIComponent(orgId)}&spaceId=${encodeURIComponent(spaceId)}${thread}`;
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
  const title =
    hit.kind === 'message'
      ? `${hit.authorName} · ${hit.spaceName}`
      : `${hit.authorName} ${hit.kind === 'here' ? 'mentioned everyone' : 'mentioned you'} · ${hit.spaceName}`;
  return {
    title,
    message: mentionExcerpt(hit.body),
    link: mentionLink(hit.orgId, hit.spaceId, hit.threadRootId),
    onlyWhenBackground: true,
  };
}

export function buildMissedSummaryNotify(input: {
  orgId: string;
  spaceId: string;
  spaceName: string;
  /** Missed mentions that addressed me by name/id. */
  youCount: number;
  /** Missed @here mentions — surfaced on coming back online. */
  hereCount: number;
  /** When every missed mention sits in one thread, click lands there. */
  soleThreadRootId?: string;
}): NotifyInput {
  const parts: string[] = [];
  if (input.youCount > 0) parts.push(`${input.youCount} ${input.youCount === 1 ? 'mention' : 'mentions'} of you`);
  if (input.hereCount > 0) parts.push(`${input.hereCount} @here`);
  return {
    title: `While you were away · ${input.spaceName}`,
    message: parts.join(' · '),
    link: mentionLink(input.orgId, input.spaceId, input.soleThreadRootId),
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
  youCount: number;
  hereCount: number;
  threadRootIds: Set<string>;
  spaceName: string;
  timer: ReturnType<typeof setTimeout>;
}

const subs = new Map<string, SpaceSub>();
const memberNames = new Map<string, Map<string, string>>();
const threadCooldown = new Map<string, number>();
const missed = new Map<string, MissedBucket>();
const offsets = readOffsets();
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

function queueMissed(k: string, orgId: string, spaceId: string, spaceName: string, threadRootId: string, kind: MentionHit['kind']): void {
  const existing = missed.get(k);
  if (existing) {
    existing[kind === 'here' ? 'hereCount' : 'youCount'] += 1;
    existing.threadRootIds.add(threadRootId);
    existing.timer.refresh();
    return;
  }
  const bucket: MissedBucket = {
    youCount: kind === 'here' ? 0 : 1,
    hereCount: kind === 'here' ? 1 : 0,
    threadRootIds: new Set([threadRootId]),
    spaceName,
    timer: setTimeout(() => {
      missed.delete(k);
      void notifyIfEnabled('space_mention', buildMissedSummaryNotify({
        orgId,
        spaceId,
        spaceName: bucket.spaceName,
        youCount: bucket.youCount,
        hereCount: bucket.hereCount,
        ...(bucket.threadRootIds.size === 1 ? { soleThreadRootId: [...bucket.threadRootIds][0] } : {}),
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
    // Do-not-disturb drops everything, mentions included — and nothing is
    // summarised after it lifts (Slack's posture: DND is silence, not a queue).
    if (dndActive()) return;
    // The per-destination level: 'mute' silences even direct mentions; 'all'
    // notifies on plain messages too (fresh ones — replayed history never
    // floods, only real mentions fold into the away summary).
    // The thread this message belongs to — a root stands for its own thread.
    const threadRootId = message.threadRoot ?? message.id;
    const level = notifyLevelFor(orgId, spaceId, threadRootId);
    if (level === 'mute') return;
    // People type the NAME (ids are opaque); agent-written mentions may carry
    // the id. A direct mention outranks @here when both appear.
    const kind: MentionHit['kind'] | null = mentionsMember(message.body, me)
      ? 'you'
      : containsHereAddress(message.body)
        ? 'here'
        : level === 'all'
          ? 'message'
          : null;
    if (!kind) return;

    if (isMissedArrival(message.postedAt)) {
      if (kind !== 'message') queueMissed(k, orgId, spaceId, spaceName, threadRootId, kind);
      return;
    }
    const cooldownKey = `${k}/${threadRootId}`;
    const last = threadCooldown.get(cooldownKey) ?? 0;
    if (Date.now() - last < THREAD_COOLDOWN_MS) return;
    threadCooldown.set(cooldownKey, Date.now());
    void notifyIfEnabled('space_mention', buildMentionNotify({
      orgId,
      spaceId,
      spaceName,
      threadRootId,
      authorName: authorName(k, message.author.memberId),
      // The wire carries "@<memberId>" addresses — show people, not ids.
      body: resolveMentions(message.body, memberNames.get(k) ?? new Map()),
      kind,
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
      // Concurrent per space: the boot sync used to await listMembers one
      // space at a time, serializing N round trips right when the renderer
      // is loading the same org.
      await Promise.all(spaces.map(async (space) => {
        const k = key(org.id, space.id);
        wanted.add(k);
        const existing = subs.get(k);
        if (existing && existing.memberId === org.auth.memberId) return;
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
      }));
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
