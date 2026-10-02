import type { ActivityItem, ActivityKind, ActivityPage, Routes } from '@rowboat/spaces-protocol';
import type { z } from 'zod';
import { HarborError } from '../errors.js';
import type { Feed } from './feed.js';
import { Kernel, type ActorCtx } from './kernel.js';
import type { Spaces } from './spaces.js';

// Per-member cursors the org owns (read marks, follows), the unread snapshot,
// Activity, and mark-everything-read (the read-state arc, 2026-09-09).

export type MarkReadInput = z.infer<Routes['markRead']['request']>;

export type UnreadSnapshot = z.infer<Routes['unread']['response']>;

const DEFAULT_ACTIVITY_PAGE = 30;

// The activity cursor: the last item's instant and id, joined on a character
// neither contains (ISO instants and item ids are both `~`-free).
function encodeActivityCursor(row: { at: string; id: string }): string {
  return `${row.at}~${row.id}`;
}

function decodeActivityCursor(cursor: string): { at: string; id: string } {
  const i = cursor.indexOf('~');
  if (i <= 0 || i === cursor.length - 1) throw new HarborError('invalid_request', 'malformed activity cursor');
  return { at: cursor.slice(0, i), id: cursor.slice(i + 1) };
}

export class ReadState {
  constructor(
    private readonly k: Kernel,
    private readonly spaces: Spaces,
    private readonly feed: Feed,
  ) {}

  // --- read state ------------------------------------------------------------
  // Per-member cursors the org owns (read state, 2026-09-09) so every device
  // agrees. Offsets, never timestamps. Never on the log: a mark is private
  // member state, not a space fact — the member's other connections learn by
  // an ephemeral read_mark frame, and a reconnecting client refetches unread().

  /**
   * Advance the stream mark, or a thread's mark. Monotone; past head refuses.
   * A thread mark is recorded whether or not the member follows the thread
   * (2026-09-11): reading is what clears an Activity row, and @here in a
   * thread, a DM thread you never replied in, or a thread you unfollowed can
   * all put one there — following only governs badges and notifications.
   */
  async markRead(ctx: ActorCtx, spaceId: string, input: MarkReadInput): Promise<{ readOffset: number }> {
    await this.k.requireMember(ctx, spaceId);
    const head = await this.k.store.head(spaceId);
    if (input.offset > head) {
      throw new HarborError('invalid_request', `offset ${input.offset} is past the space's head (${head})`);
    }
    const at = this.k.now();
    let threadRootId: string | undefined;
    let readOffset: number;
    if (input.threadRootId !== undefined) {
      const root = await this.feed.resolveRoot(spaceId, input.threadRootId);
      threadRootId = root.id;
      readOffset = await this.k.store.advanceThreadReadMark(spaceId, root.id, ctx.memberId, input.offset, at);
    } else {
      readOffset = await this.k.store.advanceStreamReadMark(spaceId, ctx.memberId, input.offset, at);
    }
    this.k.hub.publishToMember(ctx.memberId, {
      kind: 'read_mark',
      spaceId,
      ...(threadRootId !== undefined ? { threadRootId } : {}),
      offset: readOffset,
      at,
    });
    return { readOffset };
  }

  /** Follow or unfollow a thread; the mark survives an unfollow. */
  async followThread(
    ctx: ActorCtx,
    spaceId: string,
    rootMessageId: string,
    following: boolean,
  ): Promise<{ following: boolean; readOffset: number }> {
    await this.k.requireMember(ctx, spaceId);
    const root = await this.feed.resolveRoot(spaceId, rootMessageId);
    const mark = await this.k.store.setThreadFollowing(spaceId, root.id, ctx.memberId, following, this.k.now());
    return { following: mark.following, readOffset: mark.readOffset };
  }

  // --- activity (2026-09-10) -------------------------------------------------
  // The member's feed is a query over facts the org already keeps (stamps,
  // follow rows, DM kind, reactions), never a second table: edits, deletes
  // and the backfill stay consistent for free, and unread is the read marks'
  // answer. Cursor = the last item's (at, id), opaque on the wire.

  async activity(
    ctx: ActorCtx,
    q: { kinds?: ActivityKind[]; spaceId?: string; unread?: boolean; cursor?: string; limit?: number },
  ): Promise<ActivityPage> {
    let spaces = await this.k.store.listSpacesFor(ctx.memberId, { includeDirect: true });
    if (q.spaceId !== undefined) {
      await this.k.requireMember(ctx, q.spaceId);
      spaces = spaces.filter((s) => s.id === q.spaceId);
    }
    const byId = new Map(spaces.map((s) => [s.id, s]));
    const limit = q.limit ?? DEFAULT_ACTIVITY_PAGE;
    const rows = await this.k.store.listActivity(ctx.memberId, {
      spaceIds: spaces.map((s) => s.id),
      ...(q.kinds ? { kinds: new Set(q.kinds) } : {}),
      ...(q.cursor !== undefined ? { before: decodeActivityCursor(q.cursor) } : {}),
      limit: limit + 1,
      unreadOnly: q.unread === true,
    });
    const page = rows.slice(0, limit);
    const items: ActivityItem[] = page.map((r) => {
      const space = byId.get(r.spaceId)!;
      return {
        id: r.id,
        kind: r.kind,
        spaceId: r.spaceId,
        spaceKind: space.kind,
        spaceName: space.name,
        ...(r.message.threadRoot !== undefined ? { threadRootId: r.message.threadRoot } : {}),
        message: r.message,
        actors: r.actors,
        ...(r.emoji !== undefined ? { emoji: r.emoji } : {}),
        at: r.at,
        unread: r.unread,
      };
    });
    const last = page[page.length - 1];
    // Names for everyone on the page, from the roster the caller may see —
    // actors and mention labels alike, so no client walks spaces for names.
    const wanted = new Set<string>();
    for (const item of items) {
      for (const actor of item.actors) wanted.add(actor.memberId);
      wanted.add(item.message.author.memberId);
      for (const id of item.message.mentions) wanted.add(id);
    }
    const names: Record<string, string> = {};
    if (wanted.size > 0) {
      for (const m of await this.spaces.listOrgMembers(ctx)) if (wanted.has(m.id)) names[m.id] = m.displayName;
    }
    return {
      items,
      ...(rows.length > limit && last ? { nextCursor: encodeActivityCursor(last) } : {}),
      seenAt: (await this.k.store.getActivitySeenAt(ctx.memberId)) ?? null,
      names,
    };
  }

  /**
   * Reactions through `at` read as seen. Monotone. The one instant a client
   * supplies is re-serialized first: marks are compared as text, which is
   * chronological only in the 24-character form the org itself writes.
   */
  async markActivitySeen(ctx: ActorCtx, at: string): Promise<{ seenAt: string }> {
    return { seenAt: await this.k.store.advanceActivitySeenAt(ctx.memberId, new Date(at).toISOString()) };
  }

  /**
   * "Mark everything read" (2026-09-11): every space the member is in (or the
   * one named) reads through its head, every thread holding an Activity row
   * for them reads through its newest reply, and reactions read as seen — so
   * Activity, the rail and every other device agree. Cheap: one stream mark
   * per space plus one statement for the threads. Marks only advance, so the
   * call is idempotent; each mark that moved echoes to the member's other
   * connections as a `read_mark` frame, the way single marks do.
   */
  async readAll(ctx: ActorCtx, input: { spaceId?: string }): Promise<{ spaces: Array<{ spaceId: string; readOffset: number }>; threads: number; seenAt: string }> {
    let spaces = await this.k.store.listSpacesFor(ctx.memberId, { includeDirect: true });
    if (input.spaceId !== undefined) {
      await this.k.requireMember(ctx, input.spaceId);
      spaces = spaces.filter((s) => s.id === input.spaceId);
    }
    const at = this.k.now();
    const out: Array<{ spaceId: string; readOffset: number }> = [];
    for (const space of spaces) {
      const head = await this.k.store.head(space.id);
      const before = await this.k.store.getStreamReadMark(space.id, ctx.memberId);
      const readOffset = head > before ? await this.k.store.advanceStreamReadMark(space.id, ctx.memberId, head, at) : before;
      out.push({ spaceId: space.id, readOffset });
      if (readOffset > before) this.k.hub.publishToMember(ctx.memberId, { kind: 'read_mark', spaceId: space.id, offset: readOffset, at });
    }
    const threads = await this.k.store.readAllThreads(ctx.memberId, spaces.map((s) => s.id), at);
    for (const t of threads) {
      this.k.hub.publishToMember(ctx.memberId, { kind: 'read_mark', spaceId: t.spaceId, threadRootId: t.rootMessageId, offset: t.readOffset, at });
    }
    const seenAt = await this.k.store.advanceActivitySeenAt(ctx.memberId, at);
    return { spaces: out, threads: threads.length, seenAt };
  }

  /** Every space the member is in (DMs included): cursor, unread roots, unread followed threads. */
  async unread(ctx: ActorCtx): Promise<UnreadSnapshot> {
    const spaces = await this.k.store.listSpacesFor(ctx.memberId, { includeDirect: true });
    const out: UnreadSnapshot['spaces'] = [];
    for (const space of spaces) {
      const head = await this.k.store.head(space.id);
      const readOffset = await this.k.store.getStreamReadMark(space.id, ctx.memberId);
      const threads = await this.k.store.listUnreadFollowedThreads(space.id, ctx.memberId);
      out.push({
        spaceId: space.id,
        head,
        readOffset,
        unreadRoots: await this.k.store.countUnreadRoots(space.id, ctx.memberId, readOffset),
        // The number on the space: mentions in unread roots plus mentions in the unread replies of followed threads.
        unreadMentions:
          (await this.k.store.countUnreadRootMentions(space.id, ctx.memberId, readOffset)) +
          threads.reduce((sum, t) => sum + t.unreadMentions, 0),
        threads,
      });
    }
    return { spaces: out };
  }
}
