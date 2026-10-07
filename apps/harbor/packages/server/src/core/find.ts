import { mentionsAsText, type FindResult, type Message } from '@rowboat/spaces-protocol';
import { TypeSafeError, type JevApi } from '../connectors/jev/api.js';
import { buildFindRequest, decideFind, selectFindCandidates, type FindCandidate } from '../connectors/jev/find.js';
import { HarborError } from '../errors.js';
import type { Feed } from './feed.js';
import type { ActorCtx, Kernel } from './kernel.js';

// /find on Harbor (protocol find.ts, 2026-10-07, Arjun's call): the desktop
// app used to gather candidates and ask Jev on each person's own TypeSafe
// key; now Harbor does both on the deployment's key. Candidates are gathered
// here, through the same read-gated feed reads the caller could make, so
// only what the caller can read reaches Jev, and a client cannot spend the
// key on arbitrary text. Open to anyone who can read the space: whether Ro
// is a member decides whether it tags, not whether people can find things.

/** Hits per kind asked of the word search: the reach past the recent roots. */
const SEARCH_LIMIT = 20;
/** The newest stream roots and the most recently active topics: found without a word in common. */
const RECENT_ROOTS = 25;
const RECENT_TOPICS = 15;
/**
 * Each find is one paid Jev call on Rowboat's key: a person looking for
 * things does a few a minute at most, so this only stops a runaway client.
 */
export const FINDS_PER_MINUTE = 10;
const WINDOW_MS = 60_000;

export class Find {
  /** Per member, the times of their finds in the last minute. One instance per org runtime (AGENTS.md, one instance). */
  private readonly recent = new Map<string, number[]>();
  private jev: () => JevApi | undefined = () => undefined;

  constructor(
    private readonly k: Kernel,
    private readonly feed: Feed,
  ) {}

  /** The deployment's Jev (runtime.ts): undefined without its key, and /find answers `unavailable`. */
  attachJev(jev: () => JevApi | undefined): void {
    this.jev = jev;
  }

  async find(ctx: ActorCtx, spaceId: string, query: string): Promise<FindResult> {
    const space = await this.k.requireReadableSpace(ctx, spaceId);
    const api = this.jev();
    if (!api) return { reason: 'unavailable', ranked: [], found: false };
    this.spend(ctx.memberId);

    const candidates = selectFindCandidates(await this.gather(ctx, spaceId, query));
    if (candidates.length === 0) return { reason: 'no-candidates', ranked: [], found: false };
    const { state, questions } = buildFindRequest({ spaceName: space.name, query }, candidates);
    try {
      return decideFind(await api.judge(state, questions), candidates);
    } catch (err) {
      // OpenRouter busy or down: worth retrying; anything else is not.
      if (err instanceof TypeSafeError && err.transient) throw new HarborError('rate_limited', `Jev is busy: ${err.message}`);
      throw new HarborError('internal', `Jev could not answer: ${(err as Error).message}`);
    }
  }

  private spend(memberId: string): void {
    const now = Date.now();
    const times = (this.recent.get(memberId) ?? []).filter((t) => now - t < WINDOW_MS);
    if (times.length >= FINDS_PER_MINUTE) {
      this.recent.set(memberId, times);
      throw new HarborError('rate_limited', `At most ${FINDS_PER_MINUTE} finds a minute; try again shortly`);
    }
    times.push(now);
    this.recent.set(memberId, times);
  }

  /** Word-search hits first (selectFindCandidates keeps them over recent roots at the cap), then topics, then the stream. */
  private async gather(ctx: ActorCtx, spaceId: string, query: string): Promise<FindCandidate[]> {
    const names = new Map((await this.k.store.listSpaceMembers(spaceId)).map((m) => [m.id, m.displayName]));
    const text = (body: string) => mentionsAsText(body, names);
    const authorOf = (m: Pick<Message, 'author'>) => {
      const name = names.get(m.author.memberId);
      return name ? { author: name } : {};
    };
    const out: FindCandidate[] = [];

    const results = await this.feed.search(ctx, spaceId, query, { kinds: ['messages', 'topics'], limit: SEARCH_LIMIT });
    for (const hit of results.messages) {
      out.push({
        messageId: hit.messageId,
        threadRootId: hit.threadRootId,
        title: hit.topicTitle ? text(hit.topicTitle) : null,
        text: text(hit.snippet),
        ...authorOf(hit),
        at: hit.postedAt,
        offset: hit.offset,
      });
    }
    for (const { topic } of results.topics) {
      if (topic.archived) continue;
      const root = await this.k.store.getMessage(spaceId, topic.rootMessageId);
      if (!root) continue;
      out.push({
        messageId: root.id,
        threadRootId: root.id,
        title: text(topic.title),
        text: root.deletedAt ? '' : text(root.body),
        ...authorOf(root),
        at: root.lastReplyAt ?? root.postedAt,
        replyCount: root.replyCount,
        offset: root.offset,
      });
    }

    const topics = (await this.feed.listTopics(ctx, spaceId)).slice(0, RECENT_TOPICS);
    const titleByRoot = new Map(topics.map((t) => [t.rootMessageId, t.title]));
    for (const t of topics) {
      const root = t.rootMessage;
      if (!root) continue;
      out.push({
        messageId: root.id,
        threadRootId: root.id,
        title: text(t.title),
        text: root.deletedAt ? '' : text(root.body),
        ...authorOf(root),
        at: t.lastActivityAt,
        replyCount: root.replyCount,
        offset: root.offset,
      });
    }

    const { messages, topics: badges } = await this.feed.listStream(ctx, spaceId, { limit: RECENT_ROOTS });
    for (const b of badges) if (!titleByRoot.has(b.rootMessageId)) titleByRoot.set(b.rootMessageId, b.title);
    const archived = new Set(badges.filter((b) => b.archived).map((b) => b.rootMessageId));
    for (const m of messages) {
      if (m.deletedAt || !m.body.trim() || archived.has(m.id)) continue;
      const title = titleByRoot.get(m.id);
      out.push({
        messageId: m.id,
        threadRootId: m.id,
        title: title ? text(title) : null,
        text: text(m.body),
        ...authorOf(m),
        at: m.lastReplyAt ?? m.postedAt,
        replyCount: m.replyCount,
        offset: m.offset,
      });
    }
    return out;
  }
}
