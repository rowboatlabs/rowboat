import {
  parseMentions,
  stampsEqual,
  type Attribution,
  type MentionStamps,
  type Message,
  type Poll,
  type ReactionGroup,
  type Routes,
  type SearchKind,
  type SearchResults,
  type Topic,
  type TopicListing,
  type TopicRemoval,
} from '@rowboat/spaces-protocol';
import type { z } from 'zod';
import { HarborError } from '../errors.js';
import { legacyToTokens } from '../mentions-backfill.js';
import type { Notifier } from '../notify.js';
import { enforce, isAuthor } from '../policy.js';
import { parseSearchQuery } from '../search.js';
import type { MessageWindow, StoredPollVote, StoredReaction } from '../store.js';
import type { Assets } from './assets.js';
import { Kernel, type ActorCtx } from './kernel.js';

// The conversation (the annotation model, spec §7): one stream of root
// messages, flat threads, topics as annotation rows, reactions, polls, edits
// and tombstones, search, and the mention stamps every consumer reads.

/** listMessages window bounds — the default page and the per-request cap. */
const MESSAGES_PAGE_DEFAULT = 100;

const MESSAGES_PAGE_MAX = 200;

export type NewMessage = z.infer<Routes['postMessage']['request']>;

export type CreateTopicInput = z.infer<Routes['createTopic']['request']>;

/** A page request (protocol listStream / listThread query): at most one of the three offsets. */
export type PageOpts = { beforeOffset?: number; afterOffset?: number; aroundOffset?: number; limit?: number };

export type ManageTopicAction = z.infer<Routes['manageTopic']['request']>;

export type ReactInput = z.infer<Routes['reactToMessage']['request']>;

export type DeleteMessageInput = z.infer<Routes['deleteMessage']['request']>;

export type EditMessageInput = z.infer<Routes['editMessage']['request']>;

export type VotePollInput = z.infer<Routes['votePoll']['request']>;

export type EndPollInput = z.infer<Routes['endPoll']['request']>;

/** Poll duration when the create request names none — Discord's default. */
const DEFAULT_POLL_HOURS = 24;

/** The stamped addresses as they ride a Message (core.ts). */
function stampFields(stamps: MentionStamps): Pick<Message, 'mentions' | 'mentionsHere' | 'mentionsRowboat'> {
  return { mentions: [...stamps.members], mentionsHere: stamps.here, mentionsRowboat: stamps.rowboat };
}

function stampsOf(message: Message): MentionStamps {
  return { members: message.mentions, here: message.mentionsHere, rowboat: message.mentionsRowboat };
}

/** A message's thread pointer as an optional field — mirrored onto every event about the message so live clients route it without a lookup. */
function threadRootOf(message: Pick<Message, 'threadRoot'>): { threadRoot?: string } {
  return message.threadRoot !== undefined ? { threadRoot: message.threadRoot } : {};
}

export class Feed {
  constructor(
    private readonly k: Kernel,
    private readonly assets: Assets,
    /** Absent = no notifications on this org (notify.ts: frames + push). */
    private readonly notifier?: Notifier,
  ) {}

  // --- mentions (protocol mentions.ts, 2026-09-10) -----------------------------
  // The org stamps who a message addresses from its mention TOKENS alone —
  // never from names — and only ids that are members of the space. Every
  // consumer (unread, Activity, push, chips) reads the stamp.

  private async stampsFor(spaceId: string, body: string): Promise<MentionStamps> {
    const parsed = parseMentions(body);
    const members: string[] = [];
    for (const id of parsed.members) {
      if (await this.k.store.getMembership(spaceId, id)) members.push(id);
    }
    return { members, here: parsed.here, rowboat: parsed.rowboat };
  }

  /** A mention follows you into the thread (the org's rule; @here follows nobody). */
  private async followMentioned(spaceId: string, rootMessageId: string, stamps: MentionStamps, authorId: string, at: string): Promise<void> {
    for (const id of stamps.members) {
      if (id === authorId) continue;
      await this.k.store.setThreadFollowing(spaceId, rootMessageId, id, true, at);
    }
  }

  // --- feed ------------------------------------------------------------------
  // The annotation model (spec §7, 2026-09-01): one stream of root messages,
  // flat threads behind reply chips (threadRoot, write-once), topics as
  // archivable annotation rows on threads. Posting never creates a container.

  /**
   * Live reaction and poll-vote state folded in — every read path carries
   * current truth. Both fields are at-post snapshots on the stored message
   * event; only reads are authoritative. Poll votes are fetched only when the
   * page actually carries a poll, so the common all-prose page costs nothing.
   */
  private async foldPage(spaceId: string, messages: Message[]): Promise<Message[]> {
    const byMessage = new Map<string, StoredReaction[]>();
    for (const r of await this.k.store.listReactionsForMessages(spaceId, messages.map((m) => m.id))) {
      byMessage.set(r.messageId, [...(byMessage.get(r.messageId) ?? []), r]);
    }
    const pollIds = messages.filter((m) => m.poll).map((m) => m.id);
    const votesByMessage = new Map<string, StoredPollVote[]>();
    if (pollIds.length > 0) {
      for (const v of await this.k.store.listPollVotesForMessages(spaceId, pollIds)) {
        votesByMessage.set(v.messageId, [...(votesByMessage.get(v.messageId) ?? []), v]);
      }
    }
    return messages.map((m) => ({
      ...m,
      reactions: foldReactions(byMessage.get(m.id) ?? []),
      ...(m.poll ? { poll: foldPollVotes(m.poll, votesByMessage.get(m.id) ?? []) } : {}),
    }));
  }

  private pageLimit(limit?: number): number {
    return Math.min(Math.max(limit ?? MESSAGES_PAGE_DEFAULT, 1), MESSAGES_PAGE_MAX);
  }

  async listTopics(ctx: ActorCtx, spaceId: string, includeArchived = false): Promise<TopicListing[]> {
    await this.k.requireMember(ctx, spaceId);
    const topics = await this.k.store.listTopics(spaceId, includeArchived);
    // Every consumer needs the root message (reply chips, parent cards,
    // unread anchors) — always folded in; activity computes from its denorm.
    // Folded like any page read: a root's reactions and poll votes are the
    // rail's business too (a poll root card with zero votes would lie).
    const roots: Message[] = [];
    for (const t of topics) {
      const root = await this.k.store.getMessage(spaceId, t.rootMessageId);
      if (root) roots.push(root);
    }
    const folded = new Map((await this.foldPage(spaceId, roots)).map((m) => [m.id, m]));
    const listings: TopicListing[] = topics.map((t) => {
      const root = folded.get(t.rootMessageId) ?? null;
      return { ...t, rootMessage: root, lastActivityAt: activityOf(root ?? undefined, t) };
    });
    // Newest activity first. Two activities in the same millisecond (a reply
    // and a root posted back to back) tie on the stamp — the event offset,
    // which is the order they actually happened in, breaks it.
    const activityOffset = (l: TopicListing) => l.rootMessage?.lastReplyOffset ?? l.rootMessage?.offset ?? 0;
    return listings.sort(
      (a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt) || activityOffset(b) - activityOffset(a) || b.id.localeCompare(a.id),
    );
  }

  /**
   * One page of a message list (protocol listStream / listThread windows):
   * the newest `limit` rows, the rows below `beforeOffset`, the rows above
   * `afterOffset`, or — `aroundOffset` — half the limit on each side of one
   * row, the row itself included. One extra row on each fetched side answers
   * hasMore / hasMoreAfter without a count query.
   */
  private async pageOf(
    fetch: (window: MessageWindow) => Promise<Message[]>,
    opts?: PageOpts,
  ): Promise<{ rows: Message[]; hasMore: boolean; hasMoreAfter: boolean }> {
    const given = [opts?.beforeOffset, opts?.afterOffset, opts?.aroundOffset].filter((v) => v !== undefined).length;
    if (given > 1) throw new HarborError('invalid_request', 'pass at most one of beforeOffset, afterOffset, aroundOffset');
    const limit = this.pageLimit(opts?.limit);
    if (opts?.aroundOffset !== undefined) {
      // Half the window below the anchor (exclusive); the rest from the anchor
      // up (inclusive: an exclusive edge one below it) — each side fetched one
      // row over its share to answer whether more lies beyond it.
      const belowShare = Math.floor(limit / 2);
      const aboveShare = limit - belowShare;
      const below = await fetch({ beforeOffset: opts.aroundOffset, limit: belowShare + 1 });
      const above = await fetch({ afterOffset: opts.aroundOffset - 1, limit: aboveShare + 1 });
      const hasMore = below.length > belowShare;
      const hasMoreAfter = above.length > aboveShare;
      return {
        rows: [...(hasMore ? below.slice(1) : below), ...(hasMoreAfter ? above.slice(0, aboveShare) : above)],
        hasMore,
        hasMoreAfter,
      };
    }
    if (opts?.afterOffset !== undefined) {
      const above = await fetch({ afterOffset: opts.afterOffset, limit: limit + 1 });
      const hasMoreAfter = above.length > limit;
      // Paging forward says nothing about what lies below the edge the
      // caller already holds; that side is theirs to track.
      return { rows: hasMoreAfter ? above.slice(0, limit) : above, hasMore: false, hasMoreAfter };
    }
    const window = await fetch({
      ...(opts?.beforeOffset !== undefined ? { beforeOffset: opts.beforeOffset } : {}),
      limit: limit + 1,
    });
    const hasMore = window.length > limit;
    return { rows: hasMore ? window.slice(1) : window, hasMore, hasMoreAfter: false };
  }

  async listStream(
    ctx: ActorCtx,
    spaceId: string,
    opts?: PageOpts,
  ): Promise<{ messages: Message[]; topics: Topic[]; hasMore: boolean; hasMoreAfter: boolean; readOffset: number }> {
    await this.k.requireMember(ctx, spaceId);
    // Newest page by default — never the full history.
    const { rows: roots, hasMore, hasMoreAfter } = await this.pageOf((w) => this.k.store.listStream(spaceId, w), opts);
    // The page's topic badges, one batched decoration.
    const topics: Topic[] = [];
    for (const m of roots) {
      const topic = await this.k.store.getTopicByRoot(spaceId, m.id);
      if (topic) topics.push(topic);
    }
    return {
      messages: await this.foldPage(spaceId, roots),
      topics,
      hasMore,
      hasMoreAfter,
      readOffset: await this.k.store.getStreamReadMark(spaceId, ctx.memberId),
    };
  }

  /** A reply's id resolves to its root — callers always land on the thread. */
  async resolveRoot(spaceId: string, messageId: string): Promise<Message> {
    const message = await this.k.store.getMessage(spaceId, messageId);
    if (!message) throw new HarborError('not_found', 'no such message');
    if (message.threadRoot === undefined) return message;
    const root = await this.k.store.getMessage(spaceId, message.threadRoot);
    if (!root) throw new HarborError('internal', 'reply points at a missing root');
    return root;
  }

  async listThread(
    ctx: ActorCtx,
    spaceId: string,
    rootMessageId: string,
    opts?: PageOpts,
  ): Promise<{
    root: Message;
    topic: Topic | null;
    messages: Message[];
    hasMore: boolean;
    hasMoreAfter: boolean;
    readOffset: number | null;
    following: boolean;
  }> {
    await this.k.requireMember(ctx, spaceId);
    const root = await this.resolveRoot(spaceId, rootMessageId);
    const { rows: replies, hasMore, hasMoreAfter } = await this.pageOf((w) => this.k.store.listThread(spaceId, root.id, w), opts);
    const [foldedRoot] = await this.foldPage(spaceId, [root]);
    const mark = await this.k.store.getThreadReadMark(spaceId, root.id, ctx.memberId);
    return {
      root: foldedRoot!,
      topic: (await this.k.store.getTopicByRoot(spaceId, root.id)) ?? null,
      messages: await this.foldPage(spaceId, replies),
      hasMore,
      hasMoreAfter,
      // The mark, followed or not (null = the member never read or followed it).
      readOffset: mark?.readOffset ?? null,
      following: mark?.following ?? false,
    };
  }

  /** One message by id, folded — the read behind a message link. */
  async getMessage(ctx: ActorCtx, spaceId: string, messageId: string): Promise<Message> {
    await this.k.requireMember(ctx, spaceId);
    const message = await this.k.store.getMessage(spaceId, messageId);
    if (!message) throw new HarborError('not_found', 'no such message');
    return this.foldLive(spaceId, message);
  }

  /** Live folded state onto one message: reactions always, poll votes when a poll rides it. */
  private async foldLive(spaceId: string, message: Message): Promise<Message> {
    const folded: Message = {
      ...message,
      reactions: foldReactions(await this.k.store.listReactionsByMessage(spaceId, message.id)),
    };
    if (message.poll) {
      folded.poll = foldPollVotes(message.poll, await this.k.store.listPollVotesByMessage(spaceId, message.id));
    }
    return folded;
  }

  async postMessage(ctx: ActorCtx, spaceId: string, input: NewMessage): Promise<{ message: Message }> {
    const space = await this.k.requireMember(ctx, spaceId);
    this.k.guardWrite();
    const author = this.k.attributionOf(ctx, input);

    const stamps = await this.stampsFor(spaceId, input.body);
    const result = await this.k.lockedAs(ctx, spaceId, async () => {
      const at = this.k.now();
      // The org stamps the poll from its own clock: answer ids 1..n, a
      // duration in becomes an expiry out (the Discord create asymmetry).
      const poll: Poll | undefined = input.poll
        ? {
            question: input.poll.question,
            answers: input.poll.answers.map((a, i) => ({ id: i + 1, text: a.text, ...(a.emoji ? { emoji: a.emoji } : {}) })),
            allowMultiselect: input.poll.allowMultiselect ?? false,
            expiresAt: new Date(Date.parse(at) + (input.poll.durationHours ?? DEFAULT_POLL_HOURS) * 3_600_000).toISOString(),
            votes: [],
          }
        : undefined;

      if (input.threadRoot) {
        // A reply. Normalize to the root (Slack-style: replying to a reply is
        // replying to its thread) — threads stay flat by construction.
        const root = await this.resolveRoot(spaceId, input.threadRoot);
        const offset = await this.k.nextOffset(spaceId);
        const message: Message = {
          id: this.k.ulid(),
          spaceId,
          threadRoot: root.id,
          author,
          body: input.body,
          postedAt: at,
          offset,
          replyCount: 0,
          reactions: [],
          ...(poll ? { poll } : {}),
          ...stampFields(stamps),
        };
        await this.k.store.appendMessage(message);
        await this.k.store.refreshReplyStats(spaceId, root.id);
        await this.k.append(spaceId, offset, at, { type: 'message', message });
        // Read state (2026-09-09), the provisional follow rules: replying
        // follows the thread, and a root's author follows it from the first
        // reply on (lazily — a reply-less root holds no row). The replier's
        // mark advances to the reply (posting reads). Direct acts only: an
        // agent's 3am reply must not read as you having seen the thread.
        if (author.actingMode === 'direct') {
          await this.k.store.setThreadFollowing(spaceId, root.id, ctx.memberId, true, at);
          await this.k.store.advanceThreadReadMark(spaceId, root.id, ctx.memberId, offset, at);
        }
        if (root.author.memberId !== ctx.memberId && !(await this.k.store.getThreadReadMark(spaceId, root.id, root.author.memberId))) {
          await this.k.store.setThreadFollowing(spaceId, root.id, root.author.memberId, true, at);
          await this.k.store.advanceThreadReadMark(spaceId, root.id, root.author.memberId, root.offset, at);
        }
        await this.followMentioned(spaceId, root.id, stamps, ctx.memberId, at);
        // Gmail semantics: activity returns an archived topic to the rail.
        const topic = await this.k.store.getTopicByRoot(spaceId, root.id);
        if (topic?.archived) {
          const revived: Topic = { ...topic, archived: false };
          await this.k.store.putTopic(revived);
          await this.k.append(spaceId, offset + 1, at, { type: 'topic', topic: revived, action: 'unarchived', by: author });
        }
        return { message };
      }

      // A new root in the stream. Never a container — createTopic is the
      // deliberate ceremony.
      if (input.anchorChangeSetId) {
        const anchor = await this.k.store.getChangeSet(spaceId, input.anchorChangeSetId);
        if (!anchor) throw new HarborError('invalid_request', 'anchorChangeSetId does not exist in this space');
      }
      const offset = await this.k.nextOffset(spaceId);
      const message: Message = {
        id: this.k.ulid(),
        spaceId,
        author,
        body: input.body,
        postedAt: at,
        offset,
        replyCount: 0,
        ...(input.anchorChangeSetId ? { anchorChangeSetId: input.anchorChangeSetId } : {}),
        reactions: [],
        ...(poll ? { poll } : {}),
        ...stampFields(stamps),
      };
      await this.k.store.appendMessage(message);
      await this.k.append(spaceId, offset, at, { type: 'message', message });
      // Posting directly reads the stream up to your own message (read state, 2026-09-09).
      if (author.actingMode === 'direct') await this.k.store.advanceStreamReadMark(spaceId, ctx.memberId, offset, at);
      await this.followMentioned(spaceId, message.id, stamps, ctx.memberId, at);
      return { message };
    });
    // Notification decisions run OUTSIDE the lock and never block the reply
    // (notify.ts: the `notify` frame to every connection, push to phones);
    // the notifier logs its own failures.
    if (this.notifier) void this.notifier.onMessage(space, result.message);
    return result;
  }

  /**
   * The deliberate ceremony (spec §7): annotate a thread with a stated goal.
   * Promote (rootMessageId) inserts one row and cannot touch a message; from
   * scratch (body) posts the root first — nothing is born outside the stream.
   */
  async createTopic(
    ctx: ActorCtx,
    spaceId: string,
    input: CreateTopicInput,
  ): Promise<{ topic: Topic; rootMessage: Message }> {
    await this.k.requireMember(ctx, spaceId);
    this.k.guardWrite();
    const by = this.k.attributionOf(ctx, input);

    return this.k.lockedAs(ctx, spaceId, async () => {
      const at = this.k.now();

      let root: Message;
      let offset = await this.k.nextOffset(spaceId);
      if (input.rootMessageId) {
        const message = await this.k.store.getMessage(spaceId, input.rootMessageId);
        if (!message) throw new HarborError('not_found', 'no such message');
        if (message.threadRoot !== undefined) {
          throw new HarborError('invalid_request', `this is a reply — promote the thread's root (${message.threadRoot})`);
        }
        const claimed = await this.k.store.getTopicByRoot(spaceId, message.id);
        if (claimed) {
          throw new HarborError('invalid_request', `this thread already has a topic (${claimed.id})`);
        }
        root = message;
      } else {
        const stamps = await this.stampsFor(spaceId, input.body!);
        root = {
          id: this.k.ulid(),
          spaceId,
          author: by,
          body: input.body!,
          postedAt: at,
          offset,
          replyCount: 0,
          reactions: [],
          ...stampFields(stamps),
        };
        await this.k.store.appendMessage(root);
        await this.k.append(spaceId, offset, at, { type: 'message', message: root });
        if (by.actingMode === 'direct') await this.k.store.advanceStreamReadMark(spaceId, ctx.memberId, root.offset, at);
        await this.followMentioned(spaceId, root.id, stamps, ctx.memberId, at);
        offset += 1;
      }

      // The file the discussion is about, checked before anything is
      // written: a bad id refuses the whole ceremony (no half-born topic).
      const document = input.documentAssetId !== undefined ? await this.assets.requireLiveAsset(spaceId, input.documentAssetId) : undefined;

      const topic: Topic = {
        id: this.k.ulid(),
        spaceId,
        rootMessageId: root.id,
        title: input.title,
        createdBy: by,
        createdAt: at,
        archived: false,
        ...(document ? { documentAssetId: document.id } : {}),
      };
      await this.k.store.putTopic(topic);
      if (document) await this.k.store.setTopicDocument(spaceId, topic.id, document.id);
      await this.k.append(spaceId, offset, at, { type: 'topic', topic, action: 'created', by });
      return { topic, rootMessage: root };
    });
  }

  /**
   * The edit itself: row + stored event rewritten (the sanctioned in-place
   * rewrite), stamps re-derived, one message_edited event. Shared by
   * editMessage and the mentions backfill, which edits AS the author. The
   * caller holds the space lock.
   */
  private async applyEdit(
    spaceId: string,
    message: Message,
    body: string,
    stamps: MentionStamps,
    by: Attribution,
    at: string,
  ): Promise<Message> {
    await this.k.store.markMessageEdited(spaceId, message.id, body, at, stamps);
    await this.k.appendNext(spaceId, at, {
      type: 'message_edited',
      edit: {
        spaceId,
        messageId: message.id,
        ...threadRootOf(message),
        body,
        by,
        at,
        ...stampFields(stamps),
      },
    });
    return { ...message, body, editedAt: at, ...stampFields(stamps) };
  }

  /**
   * The mentions backfill (2026-09-10, a dogfood decision): the pre-token
   * spelling — "@<memberId>", bare "@here" / "@rowboat" — becomes mention
   * tokens through the ORDINARY edit path, attributed to the author, so the
   * log shows an edit by them and the "(edited)" mark appears; titles go
   * through retitle the same way. Rows that carry tokens but stale stamps
   * are restamped in place (derived data, no event). Idempotent: a second
   * run finds nothing — and a ledger row makes it run ONCE per org, so a
   * later bare "@<id>" typed as prose is never rewritten behind the author.
   * Runs at boot, per org, before the faces serve.
   */
  async migrateMentions(opts: { force?: boolean } = {}): Promise<{ messages: number; titles: number; restamped: number }> {
    const out = { messages: 0, titles: 0, restamped: 0 };
    if (!opts.force && (await this.k.store.backfillDone('017-mentions'))) return out;
    const names = new Map((await this.k.store.listAllMembers()).map((m) => [m.id, m.displayName]));
    for (const space of await this.k.store.listAllSpaces()) {
      await this.k.locked(space.id, async () => {
        for (const m of await this.k.store.listMessagesBySpace(space.id)) {
          if (m.deletedAt) continue;
          // A poll's body is its immutable fallback rendering — left alone.
          const body = m.poll ? m.body : legacyToTokens(m.body, names);
          if (body !== m.body) {
            await this.applyEdit(space.id, m, body, await this.stampsFor(space.id, body), m.author, this.k.now());
            out.messages += 1;
            continue;
          }
          const stamps = await this.stampsFor(space.id, m.body);
          if (!stampsEqual(stamps, stampsOf(m))) {
            await this.k.store.restampMessage(space.id, m.id, stamps);
            out.restamped += 1;
          }
        }
        for (const t of await this.k.store.listTopics(space.id, true)) {
          const title = legacyToTokens(t.title, names);
          if (title === t.title) continue;
          const updated: Topic = { ...t, title };
          await this.k.store.putTopic(updated);
          const at = this.k.now();
          await this.k.appendNext(space.id, at, { type: 'topic', topic: updated, action: 'retitled', by: t.createdBy });
          out.titles += 1;
        }
      });
    }
    await this.k.store.markBackfillDone('017-mentions', this.k.now());
    if (out.messages || out.titles || out.restamped) {
      console.log(`[harbor] mentions backfill: ${out.messages} messages rewritten, ${out.titles} titles, ${out.restamped} restamped`);
    }
    return out;
  }

  /**
   * Author-only tombstone (spec §4: the content plane is role-flat, so
   * deleter == author — admins moderate membership, never content). The body
   * is redacted everywhere it lives, message row and stored message event
   * alike, and a message_deleted event narrates; the row itself stays so
   * threads anchored to the message keep their parent. Re-deleting is an
   * idempotent 200 no-op with no event, like reaction toggles.
   */
  async deleteMessage(
    ctx: ActorCtx,
    spaceId: string,
    messageId: string,
    input: DeleteMessageInput,
  ): Promise<Message> {
    await this.k.requireMember(ctx, spaceId);
    this.k.guardWrite();
    const by = this.k.attributionOf(ctx, input);

    return this.k.lockedAs(ctx, spaceId, async () => {
      const message = await this.k.store.getMessage(spaceId, messageId);
      if (!message) throw new HarborError('not_found', 'no such message');
      enforce(isAuthor(ctx, message, 'delete a message'));
      if (message.deletedAt) return this.foldLive(spaceId, message);

      const at = this.k.now();
      await this.k.store.markMessageDeleted(spaceId, messageId, at);
      // The tombstone stays a row (threads anchored under it survive) but a
      // deleted reply stops counting toward its root's chip. lastReplyAt is
      // deliberately untouched — deleting must not resurface or reorder.
      if (message.threadRoot !== undefined) {
        await this.k.store.refreshReplyStats(spaceId, message.threadRoot);
      }
      await this.k.appendNext(spaceId, at, {
        type: 'message_deleted',
        deletion: {
          spaceId,
          messageId,
          ...threadRootOf(message),
          by,
          at,
        },
      });
      // A poll is content: redacted with the body (the store already dropped it). A tombstone addresses nobody.
      const { poll: _poll, ...rest } = message;
      return this.foldLive(spaceId, { ...rest, body: '', deletedAt: at, mentions: [], mentionsHere: false, mentionsRowboat: false });
    });
  }

  /**
   * Author-only body rewrite (spec §4 posture shared with deletion: the
   * content plane is role-flat, so editor == author). The body is replaced
   * everywhere it lives — message row and stored message event — and a
   * message_edited event narrates. Tombstones refuse; an identical body is
   * an idempotent 200 no-op with no event. Activity is not bumped.
   */
  async editMessage(
    ctx: ActorCtx,
    spaceId: string,
    messageId: string,
    input: EditMessageInput,
  ): Promise<Message> {
    await this.k.requireMember(ctx, spaceId);
    this.k.guardWrite();
    const by = this.k.attributionOf(ctx, input);

    const stamps = await this.stampsFor(spaceId, input.body);
    return this.k.lockedAs(ctx, spaceId, async () => {
      const message = await this.k.store.getMessage(spaceId, messageId);
      if (!message) throw new HarborError('not_found', 'no such message');
      enforce(isAuthor(ctx, message, 'edit a message'));
      if (message.deletedAt) throw new HarborError('invalid_request', 'cannot edit a deleted message');
      // The Discord posture: a poll message is immutable once posted — its
      // body is the poll's fallback rendering, and votes were cast on it.
      if (message.poll) throw new HarborError('invalid_request', 'poll messages cannot be edited');
      if (message.body === input.body) return this.foldLive(spaceId, message);

      const at = this.k.now();
      const edited = await this.applyEdit(spaceId, message, input.body, stamps, by, at);
      // A newly mentioned member follows the thread from the edit on.
      await this.followMentioned(spaceId, message.threadRoot ?? message.id, stamps, ctx.memberId, at);
      return this.foldLive(spaceId, edited);
    });
  }

  /**
   * Toggle a reaction (Slack semantics): any member, any message in the
   * space, one per (member, emoji). Re-adding what exists / removing what
   * doesn't is an idempotent no-op — no write, no event. Returns the message
   * with reactions folded so the caller can render without the live frame.
   */
  async reactToMessage(ctx: ActorCtx, spaceId: string, messageId: string, input: ReactInput): Promise<Message> {
    await this.k.requireMember(ctx, spaceId);
    this.k.guardWrite();
    const by = this.k.attributionOf(ctx, input);

    return this.k.lockedAs(ctx, spaceId, async () => {
      const message = await this.k.store.getMessage(spaceId, messageId);
      if (!message) throw new HarborError('not_found', 'no such message');
      if (message.deletedAt && input.action === 'add') {
        // Removes stay legal so people can clean up reactions left on a tombstone.
        throw new HarborError('invalid_request', 'cannot react to a deleted message');
      }
      const existing = await this.k.store.getReaction(spaceId, messageId, input.emoji, ctx.memberId);
      const at = this.k.now();

      const reaction = {
        spaceId,
        messageId,
        ...threadRootOf(message),
        emoji: input.emoji,
        by,
        at,
      };
      if (input.action === 'add' && !existing) {
        const offset = await this.k.nextOffset(spaceId);
        await this.k.store.putReaction({ spaceId, messageId, emoji: input.emoji, by, at, offset });
        await this.k.append(spaceId, offset, at, { type: 'reaction', reaction, action: 'added' });
      } else if (input.action === 'remove' && existing) {
        await this.k.store.deleteReaction(spaceId, messageId, input.emoji, ctx.memberId);
        await this.k.appendNext(spaceId, at, { type: 'reaction', reaction, action: 'removed' });
      }

      return this.foldLive(spaceId, message);
    });
  }

  /**
   * Toggle a vote on a poll answer — reaction semantics (per-(member, answer),
   * idempotent no-ops), plus the single-select rule: adding while another
   * answer holds this member's vote MOVES it (remove-then-add, two events,
   * one lock). Closed polls and tombstones refuse. Any acting mode may vote
   * (parity, 2026-09-09): a vote cast by a member's agent IS that member's
   * vote — attribution records how it happened, never who else.
   */
  async votePoll(ctx: ActorCtx, spaceId: string, messageId: string, input: VotePollInput): Promise<Message> {
    await this.k.requireMember(ctx, spaceId);
    this.k.guardWrite();
    const by = this.k.attributionOf(ctx, input);

    return this.k.lockedAs(ctx, spaceId, async () => {
      const message = await this.k.store.getMessage(spaceId, messageId);
      if (!message) throw new HarborError('not_found', 'no such message');
      const poll = message.poll;
      if (!poll || message.deletedAt) throw new HarborError('invalid_request', 'no poll on this message');
      const at = this.k.now();
      // Lazy expiry: both close states end voting; ISO-8601 UTC compares lexically.
      if (poll.endedAt || poll.expiresAt <= at) throw new HarborError('invalid_request', 'the poll has ended');
      if (!poll.answers.some((a) => a.id === input.answerId)) {
        throw new HarborError('invalid_request', 'no such answer');
      }
      const existing = await this.k.store.getPollVote(spaceId, messageId, input.answerId, ctx.memberId);

      if (input.action === 'add' && !existing) {
        if (!poll.allowMultiselect) {
          const mine = (await this.k.store.listPollVotesByMessage(spaceId, messageId)).filter(
            (v) => v.by.memberId === ctx.memberId,
          );
          for (const v of mine) {
            await this.k.store.deletePollVote(spaceId, messageId, v.answerId, ctx.memberId);
            const offset = await this.k.nextOffset(spaceId);
            await this.k.append(spaceId, offset, at, {
              type: 'poll_vote',
              vote: { spaceId, ...threadRootOf(message), messageId, answerId: v.answerId, by, at },
              action: 'removed',
            });
          }
        }
        await this.k.store.putPollVote({ spaceId, messageId, answerId: input.answerId, by, at });
        const offset = await this.k.nextOffset(spaceId);
        await this.k.append(spaceId, offset, at, {
          type: 'poll_vote',
          vote: { spaceId, ...threadRootOf(message), messageId, answerId: input.answerId, by, at },
          action: 'added',
        });
      } else if (input.action === 'remove' && existing) {
        await this.k.store.deletePollVote(spaceId, messageId, input.answerId, ctx.memberId);
        await this.k.appendNext(spaceId, at, {
          type: 'poll_vote',
          vote: { spaceId, ...threadRootOf(message), messageId, answerId: input.answerId, by, at },
          action: 'removed',
        });
      }

      return this.foldLive(spaceId, message);
    });
  }

  /**
   * End a poll early — author-only, deletion's posture (any acting mode:
   * the author's agent counts as the author). Ending an already-
   * closed poll (early-ended or naturally expired) is an idempotent no-op
   * with no event; natural expiry itself never calls this.
   */
  async endPoll(ctx: ActorCtx, spaceId: string, messageId: string, input: EndPollInput): Promise<Message> {
    await this.k.requireMember(ctx, spaceId);
    this.k.guardWrite();
    // Same line as voting (parity, 2026-09-09): the author's agent counts as
    // the author — the author-only check below is on memberId, not mode.
    const by = this.k.attributionOf(ctx, input);

    return this.k.lockedAs(ctx, spaceId, async () => {
      const message = await this.k.store.getMessage(spaceId, messageId);
      if (!message) throw new HarborError('not_found', 'no such message');
      const poll = message.poll;
      if (!poll || message.deletedAt) throw new HarborError('invalid_request', 'no poll on this message');
      enforce(isAuthor(ctx, message, 'end a poll'));
      const at = this.k.now();
      if (poll.endedAt || poll.expiresAt <= at) return this.foldLive(spaceId, message);

      await this.k.store.markPollEnded(spaceId, messageId, at);
      await this.k.appendNext(spaceId, at, {
        type: 'poll_ended',
        end: { spaceId, ...threadRootOf(message), messageId, by, at },
      });
      return this.foldLive(spaceId, { ...message, poll: { ...poll, endedAt: at } });
    });
  }

  /**
   * One-row lifecycle ops on the annotation — none can touch a message.
   * Retitle/archive/unarchive update the row; remove deletes it ("convert
   * back to thread") and the conversation never knew. Every act narrates on
   * the log with its actor, so threads can render attributed lifecycle lines.
   */
  async manageTopic(ctx: ActorCtx, spaceId: string, topicId: string, action: ManageTopicAction): Promise<Topic> {
    await this.k.requireMember(ctx, spaceId);
    this.k.guardWrite();
    const by = this.k.attributionOf(ctx, action);

    return this.k.lockedAs(ctx, spaceId, async () => {
      const topic = await this.k.store.getTopic(spaceId, topicId);
      if (!topic) throw new HarborError('not_found', 'no such topic');
      const at = this.k.now();

      switch (action.action) {
        case 'retitle': {
          if (topic.title === action.title) return topic; // idempotent, no event
          const updated: Topic = { ...topic, title: action.title };
          await this.k.store.putTopic(updated);
          const offset = await this.k.nextOffset(spaceId);
          await this.k.append(spaceId, offset, at, { type: 'topic', topic: updated, action: 'retitled', by });
          return updated;
        }
        case 'archive':
        case 'unarchive': {
          const archived = action.action === 'archive';
          if (topic.archived === archived) return topic; // idempotent, no event
          const updated: Topic = { ...topic, archived };
          await this.k.store.putTopic(updated);
          const offset = await this.k.nextOffset(spaceId);
          await this.k.append(spaceId, offset, at, { type: 'topic', topic: updated, action: action.action === 'archive' ? 'archived' : 'unarchived', by });
          return updated;
        }
        case 'remove': {
          await this.k.store.deleteTopic(spaceId, topicId);
          const removal: TopicRemoval = { spaceId, topicId, rootMessageId: topic.rootMessageId, by, at };
          const offset = await this.k.nextOffset(spaceId);
          await this.k.append(spaceId, offset, at, { type: 'topic_removed', removal });
          return topic;
        }
        case 'attach_document': {
          const asset = await this.assets.requireLiveAsset(spaceId, action.assetId);
          if (topic.documentAssetId === asset.id) return topic; // idempotent, no event
          await this.k.store.setTopicDocument(spaceId, topicId, asset.id);
          const updated: Topic = { ...topic, documentAssetId: asset.id };
          const offset = await this.k.nextOffset(spaceId);
          await this.k.append(spaceId, offset, at, { type: 'topic', topic: updated, action: 'document_attached', by });
          return updated;
        }
        case 'detach_document': {
          if (topic.documentAssetId === undefined) return topic; // idempotent, no event
          await this.k.store.setTopicDocument(spaceId, topicId, null);
          const { documentAssetId: _gone, ...rest } = topic;
          const updated: Topic = rest;
          await this.k.appendNext(spaceId, at, { type: 'topic', topic: updated, action: 'document_detached', by });
          return updated;
        }
      }
    });
  }

  /**
   * Space search (protocol search.ts): three categorized top-N lists over one
   * pair of GIN-backed store calls per kind. Member names are resolved here —
   * not in the store — so mention expansion (search.ts) always sees the
   * CURRENT roster: renames are correct on the very next query. Structure
   * (which thread a hit lives in, which topic annotates it) is joined at
   * query time, never copied into any index.
   */
  async search(
    ctx: ActorCtx,
    spaceId: string,
    rawQuery: string,
    opts?: { kinds?: SearchKind[]; limit?: number },
  ): Promise<SearchResults> {
    await this.k.requireMember(ctx, spaceId);
    const limit = Math.min(opts?.limit ?? 10, 50);
    const kinds = new Set<SearchKind>(opts?.kinds ?? ['messages', 'topics', 'assets']);

    const query = parseSearchQuery(rawQuery, await this.k.store.listSpaceMembers(spaceId));

    const empty: SearchResults = {
      messages: [],
      topics: [],
      assets: [],
      truncated: { messages: false, topics: false, assets: false },
    };
    if (query.terms.length === 0) return empty;
    const results = empty;

    if (kinds.has('messages')) {
      // limit+1 detects truncation without a count query.
      const rows = await this.k.store.searchMessages(spaceId, query, limit + 1);
      results.truncated.messages = rows.length > limit;
      const titleByRoot = new Map<string, string>();
      for (const { message, snippet } of rows.slice(0, limit)) {
        const rootId = message.threadRoot ?? message.id;
        if (!titleByRoot.has(rootId)) {
          const topic = await this.k.store.getTopicByRoot(spaceId, rootId);
          if (topic) titleByRoot.set(rootId, topic.title);
        }
        const topicTitle = titleByRoot.get(rootId);
        results.messages.push({
          messageId: message.id,
          threadRootId: rootId,
          ...(topicTitle !== undefined ? { topicTitle } : {}),
          author: message.author,
          snippet,
          postedAt: message.postedAt,
          offset: message.offset,
        });
      }
    }
    if (kinds.has('topics')) {
      const rows = await this.k.store.searchTopics(spaceId, query, limit + 1);
      results.truncated.topics = rows.length > limit;
      results.topics = rows.slice(0, limit).map((topic) => ({ topic }));
    }
    if (kinds.has('assets')) {
      const rows = await this.k.store.searchAssets(spaceId, query, limit + 1);
      results.truncated.assets = rows.length > limit;
      results.assets = rows.slice(0, limit).map(({ record, snippet }) => {
        const { state: _live, ...asset } = this.assets.toAsset(record);
        return { ...asset, ...(snippet !== undefined ? { snippet } : {}) };
      });
    }
    return results;
  }
}

/** A topic listing's activity stamp: the newest reply, else the root's post. */
function activityOf(root: Message | undefined, topic: Topic): string {
  return root?.lastReplyAt ?? root?.postedAt ?? topic.createdAt;
}

/** Stored rows (oldest first) → groups in ANSWER order (a poll's order is fixed); voteless answers are omitted. */
function foldPollVotes(poll: Poll, votes: StoredPollVote[]): Poll {
  const groups = new Map<number, string[]>();
  for (const v of votes) {
    const members = groups.get(v.answerId) ?? [];
    if (!members.includes(v.by.memberId)) members.push(v.by.memberId);
    groups.set(v.answerId, members);
  }
  return {
    ...poll,
    votes: poll.answers
      .filter((a) => groups.has(a.id))
      .map((a) => ({ answerId: a.id, memberIds: groups.get(a.id)! })),
  };
}

/** Stored rows (oldest first) → display groups: emojis in first-reacted order, members likewise. */
function foldReactions(reactions: StoredReaction[]): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup>();
  for (const r of reactions) {
    const group = groups.get(r.emoji) ?? { emoji: r.emoji, memberIds: [], lastOffset: 0 };
    if (!group.memberIds.includes(r.by.memberId)) group.memberIds.push(r.by.memberId);
    group.lastOffset = Math.max(group.lastOffset ?? 0, r.offset);
    groups.set(r.emoji, group);
  }
  return [...groups.values()];
}
