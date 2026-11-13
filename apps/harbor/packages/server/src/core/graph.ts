import { createHash } from 'node:crypto';
import {
  GRAPH_THREAD_LIMIT_MAX,
  weighGraph,
  type GraphEdge,
  type GraphEntity,
  type GraphThread,
  type Message,
  type Space,
  type SpaceGraph,
} from '@rowboat/spaces-protocol';
import type { z } from 'zod';
import type { Routes } from '@rowboat/spaces-protocol';
import { HarborError } from '../errors.js';
import {
  mayBeSameTopic,
  sameTopicRequest,
  SAME_TOPIC_MIN,
  threadCandidates,
  threadJudgment,
  threadRequest,
  TOPIC_MIN,
  vocabularyAnswers,
  vocabularyRequest,
  type GraphThreadInput,
  type GraphTopic,
  type MemberLabel,
} from '../graph/questions.js';
import { codeIn, excerpt, excerptsOf, mainRepository, topicCandidates, type ThreadText } from '../graph/text.js';
import type { JevApi } from '../jev.js';
import { canSetSpaceGraph, enforce } from '../policy.js';
import type { StoredGraphThread, StoredGraphTopic } from '../store.js';
import type { ActorCtx, Kernel } from './kernel.js';

// The space graph (spec §8 Space graph, 2026-11-12): what a space's threads
// are about, kept current by a worker and read by its members. An admin
// turns it on per space; while it is on, the worker reads the space's
// messages, finds candidates without a model (graph/text.ts), asks Jev to
// judge them (graph/questions.ts) and stores each thread's judgment and
// edges. Nothing here is on the log: the rows are derived, rewritten whole,
// and deleted when the graph is turned off. A read joins them with the
// messages as they are now, so a deleted message's text is never served.

export type SetSpaceGraphInput = z.infer<Routes['setSpaceGraph']['request']>;

export interface GraphOptions {
  /** How often the worker looks at every graph space. */
  tickMs?: number;
  /** A thread is judged once it has been quiet this long, so a live conversation is not judged on every message. */
  quietMs?: number;
  /** The vocabulary is judged again after this many new messages. */
  vocabularyEvery?: number;
  /** The most threads judged for one space in one pass: a new graph on an old space fills in over several. */
  threadsPerPass?: number;
}

const DEFAULT_TICK_MS = 60_000;
const DEFAULT_QUIET_MS = 10 * 60_000;
const DEFAULT_VOCABULARY_EVERY = 40;
const DEFAULT_THREADS_PER_PASS = 80;
/** Requests to Jev in flight at once, per space. */
const CONCURRENCY = 4;
const VOCABULARY_BATCH = 20;
const SAME_TOPIC_BATCH = 12;
/** New candidates judged in one vocabulary pass. */
const VOCABULARY_PER_PASS = 200;
/** An identifier is a node once this many threads name it. */
const SHARED_CODE_THREADS = 3;
const TITLE_CHARS = 90;
const QUOTE_CHARS = 300;

interface LiveThread extends GraphThreadInput {
  lastOffset: number;
  lastAt: string;
}

async function pool<T>(items: readonly T[], run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) await run(items[next++] as T);
  }));
}

export class Graph {
  private jev: JevApi | undefined;
  private options: GraphOptions = {};
  private timer: NodeJS.Timeout | undefined;
  private ticking: Promise<void> | undefined;
  /** The log head each space had when it was last found fully judged: an unchanged head is skipped without reading a message. */
  private readonly settled = new Map<string, number>();

  constructor(private readonly k: Kernel) {}

  attach(jev: JevApi, options: GraphOptions = {}): void {
    this.jev = jev;
    this.options = options;
  }

  /** Whether this server can build graphs: it has Jev. */
  get available(): boolean {
    return this.jev !== undefined;
  }

  start(): void {
    if (this.timer || !this.jev || this.k.readOnly) return;
    this.timer = setInterval(() => void this.tick(), this.options.tickMs ?? DEFAULT_TICK_MS);
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.ticking;
  }

  // --- the switch -------------------------------------------------------------------

  async setEnabled(ctx: ActorCtx, spaceId: string, input: SetSpaceGraphInput): Promise<Space> {
    const { space, membership } = await this.k.requireMembership(ctx, spaceId);
    enforce(canSetSpaceGraph(membership, space));
    if (input.enabled && !this.jev) throw new HarborError('invalid_request', 'the space graph is not available on this server');
    this.k.guardWrite();
    const by = this.k.attributionOf(ctx, input);
    const updated = await this.k.lockedAs(ctx, spaceId, async () => {
      const current = (await this.k.store.getSpace(spaceId)) ?? space;
      if (current.graph === input.enabled) return current; // idempotent, no event
      const next: Space = { ...current, graph: input.enabled };
      await this.k.store.putSpace(next);
      // Off means off: what was derived from the messages goes with the switch.
      if (!input.enabled) await this.k.store.clearGraph(spaceId);
      await this.k.appendNext(spaceId, this.k.now(), { type: 'space_graph_changed', space: next, by });
      return next;
    }, { archived: 'allow' });
    this.settled.delete(spaceId);
    if (updated.graph) void this.tick();
    return updated;
  }

  // --- reading ----------------------------------------------------------------------

  async read(ctx: ActorCtx, spaceId: string, opts: { about?: string; limit?: number } = {}): Promise<SpaceGraph> {
    const space = await this.k.requireMember(ctx, spaceId);
    const now = this.k.now();
    const empty = (status: SpaceGraph['status'], pending = 0): SpaceGraph => ({ status, now, pending, threads: [], entities: [], edges: [] });
    if (!space.graph) return empty(this.jev ? 'off' : 'unavailable');
    const [rows, topicRows, messages, discussions, roster] = await Promise.all([
      this.k.store.listGraphThreads(spaceId),
      this.k.store.listGraphTopics(spaceId),
      this.k.store.listMessagesBySpace(spaceId),
      this.k.store.listTopics(spaceId, true),
      this.k.store.listSpaceMembers(spaceId),
    ]);
    const live = liveThreads(messages);
    const stored = new Map(rows.map((r) => [r.rootMessageId, r]));
    const pending = live.filter((t) => stored.get(t.rootMessageId)?.lastOffset !== t.lastOffset).length;
    if (rows.length === 0) return empty('building', pending);

    const names = new Map(roster.map((m) => [m.id, m.displayName]));
    const titles = new Map(discussions.map((d) => [d.rootMessageId, d.title]));
    const threads: GraphThread[] = [];
    const edges: GraphEdge[] = [];
    for (const thread of live) {
      const row = stored.get(thread.rootMessageId);
      if (!row) continue;
      const first = thread.messages[0];
      const last = thread.messages.at(-1);
      if (!first || !last) continue;
      threads.push({
        rootMessageId: thread.rootMessageId,
        title: (titles.get(thread.rootMessageId) ?? excerpt(first.body, TITLE_CHARS)).slice(0, 200) || '(no text)',
        startedAt: first.postedAt,
        lastAt: last.postedAt,
        messageCount: thread.messages.length,
        kind: row.judgment.kind,
        kindProbability: row.judgment.kindProbability,
        resolved: row.judgment.resolved,
        decision: row.judgment.decision,
        importance: row.judgment.importance,
        opening: { memberId: first.memberId, text: excerpt(first.body, QUOTE_CHARS) },
        ...(last !== first ? { latest: { memberId: last.memberId, text: excerpt(last.body, QUOTE_CHARS) } } : {}),
      });
      for (const edge of row.judgment.edges) edges.push({ rootMessageId: thread.rootMessageId, ...edge });
    }
    const entities = describeEntities(edges, topicRows, names);

    // Which threads to send: the ones about `about`, or the heaviest, by the weights every reader computes.
    const weighed = weighGraph({ now, threads, edges });
    const limit = Math.min(opts.limit ?? GRAPH_THREAD_LIMIT_MAX, GRAPH_THREAD_LIMIT_MAX);
    const score = new Map<string, number>();
    if (opts.about !== undefined) {
      const target = findEntity(opts.about, entities, weighed);
      if (!target) return { ...empty('ready', pending) };
      for (const w of weighed) if (w.edge.entityId === target) score.set(w.edge.rootMessageId, w.weight);
    } else {
      for (const w of weighed) score.set(w.edge.rootMessageId, (score.get(w.edge.rootMessageId) ?? 0) + w.weight);
    }
    const chosen = new Set([...score.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, limit).map(([id]) => id));
    const keptEdges = edges.filter((e) => chosen.has(e.rootMessageId));
    const named = new Set(keptEdges.map((e) => e.entityId));
    return {
      status: 'ready',
      now,
      pending,
      threads: threads.filter((t) => chosen.has(t.rootMessageId)).sort((a, b) => (score.get(b.rootMessageId) ?? 0) - (score.get(a.rootMessageId) ?? 0)),
      entities: entities.filter((e) => named.has(e.id)),
      edges: keptEdges,
    };
  }

  // --- the worker --------------------------------------------------------------------

  /** One pass over every graph space; a pass already running is joined, never doubled. */
  private tick(): Promise<void> {
    if (this.ticking) return this.ticking;
    this.ticking = this.drive()
      .catch((err) => console.log('[harbor] graph: pass failed', (err as Error).message))
      .finally(() => {
        this.ticking = undefined;
      });
    return this.ticking;
  }

  private async drive(): Promise<void> {
    if (!this.jev || this.k.readOnly) return;
    for (const space of await this.k.store.listAllSpaces()) {
      if (!space.graph) continue;
      try {
        await this.build(space, this.jev);
      } catch (err) {
        // Jev busy, or one bad answer: the fingerprints are unchanged, so the next pass tries the same threads again.
        console.log('[harbor] graph: space failed', { spaceId: space.id, error: (err as Error).message });
      }
    }
  }

  private async build(space: Space, jev: JevApi): Promise<void> {
    const store = this.k.store;
    const head = await store.head(space.id);
    if (this.settled.get(space.id) === head) return;
    const [messages, roster, discussions] = await Promise.all([store.listMessagesBySpace(space.id), store.listSpaceMembers(space.id), store.listTopics(space.id, true)]);
    const threads = liveThreads(messages);
    const titles = new Map(discussions.map((d) => [d.rootMessageId, d.title]));
    for (const thread of threads) {
      const title = titles.get(thread.rootMessageId);
      if (title !== undefined) thread.title = title;
    }
    const members = new Map<string, MemberLabel>(roster.map((m) => [m.id, { name: m.displayName, agent: m.kind === 'agent' }]));
    const texts: ThreadText[] = threads.map((t) => ({ id: t.rootMessageId, bodies: t.messages.map((m) => m.body) }));
    const liveCount = threads.reduce((n, t) => n + t.messages.length, 0);

    const vocabulary = await store.getGraphVocabulary(space.id);
    if (!vocabulary || Math.abs(liveCount - vocabulary.messages) >= (this.options.vocabularyEvery ?? DEFAULT_VOCABULARY_EVERY)) {
      await this.judgeVocabulary(space.id, texts, roster.map((m) => m.displayName), liveCount, jev);
    }
    const topics = usableTopics(await store.listGraphTopics(space.id));
    const mainRepo = mainRepository(messages.map((m) => m.body));
    const codeThreads = new Map<string, number>();
    for (const text of texts) for (const code of new Set(text.bodies.flatMap(codeIn))) codeThreads.set(code, (codeThreads.get(code) ?? 0) + 1);
    const sharedCode = new Set([...codeThreads.entries()].filter(([, n]) => n >= SHARED_CODE_THREADS).map(([code]) => code));

    const stored = new Map((await store.listGraphThreads(space.id)).map((r) => [r.rootMessageId, r]));
    const liveIds = new Set(threads.map((t) => t.rootMessageId));
    for (const id of stored.keys()) if (!liveIds.has(id)) await this.write(space.id, (s) => s.deleteGraphThread(space.id, id));

    const quietBefore = Date.now() - (this.options.quietMs ?? DEFAULT_QUIET_MS);
    const due: { thread: LiveThread; candidates: ReturnType<typeof threadCandidates>; fingerprint: string }[] = [];
    let waiting = 0;
    for (const thread of threads) {
      const candidates = threadCandidates(thread, topics, { threadCount: threads.length, mainRepo, sharedCode });
      const fingerprint = fingerprintOf(thread, candidates);
      if (stored.get(thread.rootMessageId)?.fingerprint === fingerprint) continue;
      if (Date.parse(thread.lastAt) > quietBefore) waiting++;
      else due.push({ thread, candidates, fingerprint });
    }
    // Newest first: on an old space the recent threads are the ones people open the graph for.
    due.sort((a, b) => (a.thread.lastAt < b.thread.lastAt ? 1 : -1));
    const batch = due.slice(0, this.options.threadsPerPass ?? DEFAULT_THREADS_PER_PASS);
    let failed = 0;
    await pool(batch, async ({ thread, candidates, fingerprint }) => {
      try {
        const { state, questions } = threadRequest(thread, candidates, members);
        const judgment = threadJudgment(thread, candidates, await jev.ask(state, questions), mainRepo);
        const row: StoredGraphThread = { spaceId: space.id, rootMessageId: thread.rootMessageId, fingerprint, lastOffset: thread.lastOffset, judgedAt: this.k.now(), judgment };
        await this.write(space.id, (s) => s.putGraphThread(row));
      } catch (err) {
        failed++;
        console.log('[harbor] graph: thread failed', { spaceId: space.id, rootMessageId: thread.rootMessageId, error: (err as Error).message });
      }
    });
    if (failed === 0 && waiting === 0 && batch.length === due.length) this.settled.set(space.id, head);
  }

  /**
   * Judge the space's new candidate topics, then whether any new topic is an
   * old one under another wording. A candidate is asked about once: refused
   * ones keep their row. Marked done before the merges, which are a
   * refinement: failing there must not make the next pass ask everything again.
   */
  private async judgeVocabulary(spaceId: string, texts: readonly ThreadText[], memberNames: readonly string[], liveCount: number, jev: JevApi): Promise<void> {
    const store = this.k.store;
    const known = new Map((await store.listGraphTopics(spaceId)).map((t) => [t.key, t]));
    const candidates = topicCandidates(texts, memberNames);
    const fresh = candidates.filter((c) => !known.has(c.key)).slice(0, VOCABULARY_PER_PASS);
    const added: StoredGraphTopic[] = [];
    const batches: (typeof fresh)[] = [];
    for (let i = 0; i < fresh.length; i += VOCABULARY_BATCH) batches.push(fresh.slice(i, i + VOCABULARY_BATCH));
    await pool(batches, async (batch) => {
      const { state, questions } = vocabularyRequest(batch.map((c) => ({ label: c.label, excerpts: excerptsOf([c.label], texts, 3) })));
      const verdicts = vocabularyAnswers(batch.length, await jev.ask(state, questions));
      for (const [i, candidate] of batch.entries()) {
        const verdict = verdicts[i];
        if (!verdict) continue;
        const topic: StoredGraphTopic = { spaceId, key: candidate.key, label: candidate.label, category: verdict.category, real: verdict.real, threads: candidate.threads };
        await this.write(spaceId, (s) => s.putGraphTopic(topic));
        added.push(topic);
      }
    });
    await this.write(spaceId, (s) => s.putGraphVocabulary(spaceId, liveCount, this.k.now()));

    const real = [...known.values(), ...added].filter((t) => t.real >= TOPIC_MIN && t.aliasOf === undefined);
    const fresher = new Set(added.map((t) => t.key));
    const pairs: [StoredGraphTopic, StoredGraphTopic][] = [];
    for (let i = 0; i < real.length; i++) {
      for (let j = i + 1; j < real.length; j++) {
        const a = real[i] as StoredGraphTopic;
        const b = real[j] as StoredGraphTopic;
        if ((fresher.has(a.key) || fresher.has(b.key)) && mayBeSameTopic(a.key, b.key)) pairs.push([a, b]);
      }
    }
    const aliasOf = new Map<string, string>();
    const rootOf = (key: string): string => { let k = key; while (aliasOf.has(k)) k = aliasOf.get(k) as string; return k; };
    const byKey = new Map(real.map((t) => [t.key, t]));
    for (let i = 0; i < pairs.length; i += SAME_TOPIC_BATCH) {
      const batch = pairs.slice(i, i + SAME_TOPIC_BATCH);
      const { state, questions } = sameTopicRequest(batch.map(([a, b]) => ({ first: { label: a.label, excerpts: excerptsOf([a.label], texts, 2) }, second: { label: b.label, excerpts: excerptsOf([b.label], texts, 2) } })));
      const answers = await jev.ask(state, questions);
      for (const [n, [a, b]] of batch.entries()) {
        const answer = answers[`same_${n}`];
        if (answer?.type !== 'score' || answer.score < SAME_TOPIC_MIN) continue;
        const rootA = rootOf(a.key);
        const rootB = rootOf(b.key);
        if (rootA === rootB) continue;
        // The wording seen in more threads keeps the node; the other becomes its alias.
        const [winner, loser] = (byKey.get(rootA)?.threads ?? 0) >= (byKey.get(rootB)?.threads ?? 0) ? [rootA, rootB] : [rootB, rootA];
        aliasOf.set(loser, winner);
      }
    }
    for (const key of aliasOf.keys()) {
      const topic = byKey.get(key);
      if (topic) await this.write(spaceId, (s) => s.putGraphTopic({ ...topic, aliasOf: rootOf(key) }));
    }
  }

  /**
   * A derived row lands only while the graph is still on: inside the space
   * lock, after re-reading the switch, so a pass that was mid-request when an
   * admin turned the graph off cannot put back what turning it off deleted.
   */
  private async write(spaceId: string, fn: (store: Kernel['store']) => Promise<void>): Promise<void> {
    await this.k.locked(spaceId, async () => {
      if ((await this.k.store.getSpace(spaceId))?.graph) await fn(this.k.store);
    });
  }
}

/** The space's threads as they are now: roots with their replies, deleted messages left out, a thread with nothing left dropped. */
function liveThreads(messages: readonly Message[]): LiveThread[] {
  const byRoot = new Map<string, Message[]>();
  for (const message of messages) {
    if (message.body === '' || message.deletedAt !== undefined) continue;
    const root = message.threadRoot ?? message.id;
    const list = byRoot.get(root);
    if (list) list.push(message);
    else byRoot.set(root, [message]);
  }
  const threads: LiveThread[] = [];
  for (const [rootMessageId, list] of byRoot) {
    list.sort((a, b) => a.offset - b.offset);
    const last = list.at(-1);
    if (!last) continue;
    threads.push({
      rootMessageId,
      messages: list.map((m) => ({ id: m.id, memberId: m.author.memberId, body: m.body, postedAt: m.postedAt })),
      lastOffset: last.offset,
      lastAt: last.postedAt,
    });
  }
  return threads;
}

/** What a judgment was made of. An edit, a reply, a deletion, a new title or a new topic found in the thread each change it. */
function fingerprintOf(thread: GraphThreadInput, candidates: ReturnType<typeof threadCandidates>): string {
  const hash = createHash('sha1');
  hash.update(thread.title ?? '');
  for (const m of thread.messages) hash.update(`\n${m.id}\t${m.memberId}\t${m.body}`);
  hash.update(`\n${candidates.topics.map((t) => `${t.key}=${t.labels.join('|')}`).join(',')}\n${candidates.code.join(',')}\n${candidates.references.join(',')}`);
  return hash.digest('hex');
}

/** The topics threads may link to: judged real, with each alias folded into the topic that carries it. */
function usableTopics(rows: readonly StoredGraphTopic[]): (GraphTopic & { threads: number })[] {
  const real = rows.filter((t) => t.real >= TOPIC_MIN);
  return real.filter((t) => t.aliasOf === undefined).map((t) => {
    const aliases = real.filter((a) => a.aliasOf === t.key);
    return { key: t.key, labels: [t.label, ...aliases.map((a) => a.label)], threads: t.threads + aliases.reduce((n, a) => n + a.threads, 0) };
  });
}

function describeEntities(edges: readonly GraphEdge[], topics: readonly StoredGraphTopic[], names: ReadonlyMap<string, string>): GraphEntity[] {
  const ids = [...new Set(edges.map((e) => e.entityId))].sort();
  const topicByKey = new Map(topics.map((t) => [t.key, t]));
  const repos = new Map<string, number>();
  for (const id of ids) if (id.startsWith('reference:')) { const repo = id.slice('reference:'.length).split('#')[0] ?? ''; repos.set(repo, (repos.get(repo) ?? 0) + 1); }
  const mainRepo = [...repos.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
  return ids.map((id): GraphEntity => {
    const rest = id.slice(id.indexOf(':') + 1);
    if (id.startsWith('member:')) return { id, kind: 'member', label: names.get(rest) ?? 'A former member', memberId: rest, aliases: [] };
    if (id.startsWith('topic:')) {
      const topic = topicByKey.get(rest);
      return { id, kind: 'topic', label: topic?.label ?? rest, ...(topic ? { category: topic.category } : {}), aliases: topics.filter((t) => t.aliasOf === rest && t.real >= TOPIC_MIN).map((t) => t.label) };
    }
    if (id.startsWith('reference:')) {
      const [repo = '', number = ''] = rest.split('#');
      // GitHub answers /issues/N for a pull request too, by redirect; the graph does not know which it is.
      return { id, kind: 'reference', label: repo === mainRepo ? `#${number}` : `${repo.split('/')[1] ?? repo}#${number}`, url: `https://github.com/${repo}/issues/${number}`, aliases: [] };
    }
    return { id, kind: 'code', label: rest.slice(0, 200), aliases: [] };
  });
}

/** `about` as an entity: its id, else its exact name or alias, else the heaviest entity whose name contains it. */
function findEntity(about: string, entities: readonly GraphEntity[], weighed: ReturnType<typeof weighGraph>): string | undefined {
  const wanted = about.trim().toLowerCase().replace(/^@/, '');
  const exact = entities.find((e) => e.id.toLowerCase() === wanted) ?? entities.find((e) => e.label.toLowerCase() === wanted || e.aliases.some((a) => a.toLowerCase() === wanted));
  if (exact) return exact.id;
  const total = new Map<string, number>();
  for (const w of weighed) total.set(w.edge.entityId, (total.get(w.edge.entityId) ?? 0) + w.weight);
  return entities
    .filter((e) => e.label.toLowerCase().includes(wanted) || e.id.toLowerCase().endsWith(wanted))
    .sort((a, b) => (total.get(b.id) ?? 0) - (total.get(a.id) ?? 0))[0]?.id;
}
