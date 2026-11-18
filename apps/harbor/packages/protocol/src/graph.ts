import { z } from 'zod';
import { MemberId, MessageId } from './ids.js';

// The space graph (spec §8 Space graph, 2026-11-12): what a space's threads
// are about, derived by Harbor and read by members. It is two-sided. One side
// is the threads; the other is the things threads touch: members, topics,
// references (pull requests and issues) and code identifiers. Every edge joins
// one thread to one thing.
//
// An edge stores facts, never a weight: the events that touched it (which
// message, and that message's share) and Jev's judgment of it. The weight is
// computed on read by `weighGraph` below, shared by Harbor and the app, so a
// half-life can change without rewriting a row and every weight can be traced
// to the messages behind it.

/** What kind of conversation a thread is, one of a closed set Jev chooses from. */
export const GraphThreadKind = z.enum(['feature', 'bug', 'decision', 'question', 'review', 'ops', 'idea', 'routine', 'chatter']);
export type GraphThreadKind = z.infer<typeof GraphThreadKind>;

export const GraphEntityKind = z.enum(['member', 'topic', 'reference', 'code']);
export type GraphEntityKind = z.infer<typeof GraphEntityKind>;

/** What a topic names, one of a closed set Jev chooses from. */
export const GraphTopicCategory = z.enum(['external_product', 'own_component', 'feature', 'practice', 'technology']);
export type GraphTopicCategory = z.infer<typeof GraphTopicCategory>;

/**
 * What an edge says. A member's part in the thread (`participant` = took part,
 * unjudged); `subject` for a topic or identifier; what a reference is to the
 * thread (`produced` by it, its `subject`, or passing `context`).
 */
export const GraphRelation = z.enum(['requester', 'doer', 'decider', 'reviewer', 'bystander', 'participant', 'subject', 'produced', 'context']);
export type GraphRelation = z.infer<typeof GraphRelation>;

const Probability = z.number().min(0).max(1);

export const GraphQuote = z.object({ memberId: MemberId, text: z.string().max(400) });
export type GraphQuote = z.infer<typeof GraphQuote>;

export const GraphThread = z.object({
  rootMessageId: MessageId,
  /** The discussion's title, else the start of the root message, read at request time: a deleted message leaves no text here. */
  title: z.string().max(200),
  startedAt: z.iso.datetime(),
  lastAt: z.iso.datetime(),
  messageCount: z.number().int().nonnegative(),
  kind: GraphThreadKind,
  /** Jev's probability for `kind`. */
  kindProbability: Probability,
  /** Jev: is the matter settled by the last message? */
  resolved: Probability,
  /** Jev: did someone make an explicit decision? */
  decision: Probability,
  /** Jev: 0 (noise) to 4 (reshapes the product). */
  importance: z.number().min(0).max(4),
  opening: GraphQuote.optional(),
  latest: GraphQuote.optional(),
});
export type GraphThread = z.infer<typeof GraphThread>;

export const GraphEntity = z.object({
  /** `member:<memberId>`, `topic:<key>`, `reference:<owner>/<repo>#<number>` or `code:<identifier>`. */
  id: z.string().min(1).max(400),
  kind: GraphEntityKind,
  label: z.string().min(1).max(200),
  memberId: MemberId.optional(),
  url: z.string().max(400).optional(),
  category: GraphTopicCategory.optional(),
  /** Other wordings Jev judged to be this same topic. */
  aliases: z.array(z.string().max(200)).default([]),
});
export type GraphEntity = z.infer<typeof GraphEntity>;

export const GraphEvent = z.object({
  at: z.iso.datetime(),
  /** One message is one unit, split across the edges it touched. */
  share: z.number().positive().max(1),
});
export type GraphEvent = z.infer<typeof GraphEvent>;

export const GraphEdge = z.object({
  rootMessageId: MessageId,
  entityId: z.string().min(1).max(400),
  relation: GraphRelation,
  /** Jev's probability for the relation; null where nothing was asked. */
  probability: Probability.nullable(),
  /** The judgment as a multiplier, 0 to 1: how much of the edge's activity counts. */
  strength: Probability,
  events: z.array(GraphEvent),
});
export type GraphEdge = z.infer<typeof GraphEdge>;

/**
 * `unavailable`: this server has no Jev key. `off`: an admin has not turned
 * the graph on for the space. `building`: on, nothing judged yet. `ready`:
 * judged threads are below; `pending` more wait for the next pass.
 */
export const GraphStatus = z.enum(['unavailable', 'off', 'building', 'ready']);
export type GraphStatus = z.infer<typeof GraphStatus>;

export const SpaceGraph = z.object({
  status: GraphStatus,
  /** The server's clock when it answered: the "now" weights decay from. */
  now: z.iso.datetime(),
  /** Threads changed since they were last judged, or never judged. */
  pending: z.number().int().nonnegative(),
  threads: z.array(GraphThread),
  entities: z.array(GraphEntity),
  edges: z.array(GraphEdge),
});
export type SpaceGraph = z.infer<typeof SpaceGraph>;

// --- weights, computed on read -------------------------------------------------

export const GRAPH_HALF_LIFE_DAYS = 60;
/** A thread Jev rated at least this important, with a decision at least this likely, keeps its edges through any prune. */
export const GRAPH_FLOOR_IMPORTANCE = 3;
export const GRAPH_FLOOR_DECISION = 0.7;
export const GRAPH_FLOOR_STRENGTH = 0.5;

export interface GraphWeightOptions {
  /** Days for an event to count half; Infinity = nothing fades. */
  halfLifeDays?: number;
  /** False = every thread pays the same, whatever Jev rated it. */
  importance?: boolean;
}

export interface WeighedEdge {
  edge: GraphEdge;
  thread: GraphThread;
  /** This thread's own activity on the edge, decayed. */
  threadSide: number;
  /** The entity's activity everywhere, split evenly over its threads: a topic still talked about keeps its old threads alive. */
  entitySide: number;
  importanceFactor: number;
  weight: number;
  /** Never pruned: an edge of a notable decision thread. */
  floor: boolean;
  /** The latest event, ms since the epoch. */
  lastAt: number;
}

/**
 * weight = strength × importance × (thread side + ½ entity side). The ½ and
 * the importance range are starting points from the 2026-11-12 experiment on
 * one space, not laws; they live here so both ends change together.
 */
export function weighGraph(graph: Pick<SpaceGraph, 'now' | 'threads' | 'edges'>, options: GraphWeightOptions = {}): WeighedEdge[] {
  const halfLife = options.halfLifeDays ?? GRAPH_HALF_LIFE_DAYS;
  const now = Date.parse(graph.now);
  const decay = (at: number): number => (halfLife === Infinity ? 1 : Math.pow(0.5, Math.max(0, now - at) / 86_400_000 / halfLife));
  const threads = new Map(graph.threads.map((t) => [t.rootMessageId, t]));
  const out: WeighedEdge[] = [];
  const byEntity = new Map<string, WeighedEdge[]>();
  for (const edge of graph.edges) {
    const thread = threads.get(edge.rootMessageId);
    if (!thread) continue;
    let threadSide = 0;
    let lastAt = 0;
    for (const event of edge.events) {
      const at = Date.parse(event.at);
      threadSide += decay(at) * event.share;
      if (at > lastAt) lastAt = at;
    }
    const weighed: WeighedEdge = {
      edge,
      thread,
      threadSide,
      entitySide: 0,
      importanceFactor: options.importance === false ? 1 : 0.4 + thread.importance / 2.5,
      weight: 0,
      floor: thread.decision >= GRAPH_FLOOR_DECISION && thread.importance >= GRAPH_FLOOR_IMPORTANCE && edge.strength >= GRAPH_FLOOR_STRENGTH,
      lastAt,
    };
    out.push(weighed);
    const list = byEntity.get(edge.entityId);
    if (list) list.push(weighed);
    else byEntity.set(edge.entityId, [weighed]);
  }
  for (const list of byEntity.values()) {
    const share = list.reduce((sum, e) => sum + e.threadSide, 0) / list.length;
    for (const e of list) e.entitySide = share;
  }
  for (const e of out) e.weight = e.edge.strength * e.importanceFactor * (e.threadSide + 0.5 * e.entitySide);
  return out;
}
