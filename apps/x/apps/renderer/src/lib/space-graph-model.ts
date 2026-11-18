import { spaces } from '@x/shared'

// The space graph as the view draws it (harbor spec §8 Space graph,
// 2026-11-12). The server sends threads, entities and edges with their
// events; the weight of an edge is computed here, on read, by the protocol's
// weighGraph, so moving the half-life or the prune line never asks the
// server again. Pure: no canvas, no React, tested on its own.

export type GraphNodeType = 'person' | 'agent' | 'topic' | 'reference' | 'code' | 'thread'

export const GRAPH_KINDS: readonly spaces.GraphThreadKind[] = ['feature', 'bug', 'decision', 'question', 'review', 'ops', 'idea', 'routine', 'chatter']
/** Half-lives the slider steps through, in days; the last means nothing fades. */
export const GRAPH_HALF_LIVES: readonly number[] = [7, 14, 30, 60, 120, 365, Infinity]

export interface GraphSettings {
    types: ReadonlySet<GraphNodeType>
    kinds: ReadonlySet<spaces.GraphThreadKind>
    halfLifeDays: number
    /** Percent of edges drawn, strongest first. */
    keep: number
    threadsAsNodes: boolean
    importance: boolean
    /** Edges of a notable decision thread are drawn whatever their weight. */
    floor: boolean
}

// Standups and greetings are most of a busy space's threads and none of what a
// reader opens the graph for, so they start off (the 2026-11-12 experiment:
// 421 of 869 threads). Code identifiers start off for the same reason.
export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
    types: new Set<GraphNodeType>(['person', 'agent', 'topic', 'reference']),
    kinds: new Set(GRAPH_KINDS.filter((k) => k !== 'routine' && k !== 'chatter')),
    halfLifeDays: 60,
    keep: 30,
    threadsAsNodes: true,
    importance: true,
    floor: true,
}

export interface ModelEdge extends spaces.WeighedEdge {
    /** The thread's node id. */
    threadId: string
    /** Drawn: above the prune line, or held by the decision floor. */
    kept: boolean
}

export interface GraphModel {
    edges: ModelEdge[]
    /** Every edge of a node, thread or entity, pruned or not. */
    byNode: Map<string, ModelEdge[]>
    /** The weight of the weakest edge the prune line keeps. */
    cut: number
    max: number
    entities: Map<string, spaces.GraphEntity>
    threads: Map<string, spaces.GraphThread>
    typeOf: (id: string) => GraphNodeType
    /** How reachable each node is from everywhere: what a walk from one node is divided by. */
    rank: Map<string, number>
}

export const threadNodeId = (rootMessageId: string): string => `thread:${rootMessageId}`

export function buildGraphModel(graph: spaces.SpaceGraph, settings: GraphSettings, agentIds: ReadonlySet<string>): GraphModel {
    const entities = new Map(graph.entities.map((e) => [e.id, e]))
    const threads = new Map(graph.threads.map((t) => [threadNodeId(t.rootMessageId), t]))
    const typeOf = (id: string): GraphNodeType => {
        if (id.startsWith('thread:')) return 'thread'
        const entity = entities.get(id)
        if (!entity || entity.kind === 'code') return 'code'
        if (entity.kind === 'member') return entity.memberId !== undefined && agentIds.has(entity.memberId) ? 'agent' : 'person'
        return entity.kind
    }
    const shownThreads = graph.threads.filter((t) => settings.kinds.has(t.kind))
    const shownRoots = new Set(shownThreads.map((t) => t.rootMessageId))
    const shownEdges = graph.edges.filter((e) => shownRoots.has(e.rootMessageId) && entities.has(e.entityId) && settings.types.has(typeOf(e.entityId)))
    const weighed = spaces.weighGraph({ now: graph.now, threads: shownThreads, edges: shownEdges }, { halfLifeDays: settings.halfLifeDays, importance: settings.importance })
    const sorted = [...weighed].sort((a, b) => b.weight - a.weight)
    const cut = sorted[Math.max(0, Math.ceil(sorted.length * settings.keep / 100) - 1)]?.weight ?? 0
    const edges: ModelEdge[] = weighed.map((w) => ({ ...w, threadId: threadNodeId(w.edge.rootMessageId), kept: w.weight >= cut || (settings.floor && w.floor) }))
    const byNode = new Map<string, ModelEdge[]>()
    for (const edge of edges) for (const id of [edge.threadId, edge.edge.entityId]) {
        const list = byNode.get(id)
        if (list) list.push(edge)
        else byNode.set(id, [edge])
    }
    return { edges, byNode, cut, max: sorted[0]?.weight ?? 1, entities, threads, typeOf, rank: walk(byNode, null) }
}

/** A random walk with restart over the weighted two-sided graph. `start` null = restart anywhere: plain PageRank. */
function walk(byNode: ReadonlyMap<string, ModelEdge[]>, start: string | null): Map<string, number> {
    const ids = [...byNode.keys()]
    const index = new Map(ids.map((id, i) => [id, i]))
    const n = ids.length
    const out = ids.map((id) => (byNode.get(id) ?? []).reduce((sum, e) => sum + e.weight, 0))
    const restart = new Float64Array(n)
    const from = start !== null ? index.get(start) : undefined
    if (from !== undefined) restart[from] = 1
    else restart.fill(n ? 1 / n : 0)
    let rank = Float64Array.from(restart)
    const RESTART = 0.3
    for (let step = 0; step < 30; step++) {
        const next = new Float64Array(n)
        for (let i = 0; i < n; i++) {
            const total = out[i] ?? 0
            if (!total) continue
            const share = (rank[i] ?? 0) * (1 - RESTART) / total
            const id = ids[i] as string
            for (const e of byNode.get(id) ?? []) {
                const other = index.get(e.threadId === id ? e.edge.entityId : e.threadId)
                if (other !== undefined) next[other] = (next[other] ?? 0) + share * e.weight
            }
        }
        for (let i = 0; i < n; i++) next[i] = (next[i] ?? 0) + RESTART * (restart[i] ?? 0)
        rank = next
    }
    return new Map(ids.map((id, i) => [id, rank[i] ?? 0]))
}

/**
 * What is nearest a node: a walk that keeps returning to it, each result
 * divided by the root of how reachable it is from everywhere, or the busiest
 * people would top every list.
 */
export function closestTo(model: GraphModel, id: string): { id: string; score: number }[] {
    if (!model.byNode.has(id)) return []
    const from = walk(model.byNode, id)
    return [...from.entries()]
        .filter(([other]) => other !== id)
        .map(([other, value]) => ({ id: other, score: value / Math.sqrt(model.rank.get(other) || 1e-9) }))
        .sort((a, b) => b.score - a.score)
}

export interface DrawnNode {
    id: string
    type: GraphNodeType
    label: string
    /** Sum of the node's drawn edge weights: its size. */
    weight: number
    /** A thread the decision floor protects. */
    floor: boolean
    /** Labelled at any zoom: one of the heaviest of its type. */
    top: boolean
    /** In the largest connected piece: what the first view frames. */
    main: boolean
}

export interface DrawnLink {
    source: string
    target: string
    weight: number
    /** Threads behind a derived link (threads folded away). */
    threads?: number
    /** Drawn only because of the decision floor. */
    floor?: boolean
}

export interface DrawnGraph {
    nodes: DrawnNode[]
    links: DrawnLink[]
    /** The heaviest thread node and the heaviest other node: what sizes scale against. */
    maxThread: number
    maxEntity: number
}

export function labelOf(model: GraphModel, id: string): string {
    return id.startsWith('thread:') ? model.threads.get(id)?.title ?? 'A thread' : model.entities.get(id)?.label ?? id
}

/** Strongest derived links kept per node when threads are folded away. */
const DERIVED_LINKS_PER_NODE = 5

export function projectGraph(model: GraphModel, settings: GraphSettings): DrawnGraph {
    const nodes = new Map<string, DrawnNode>()
    const node = (id: string): DrawnNode => {
        let n = nodes.get(id)
        if (!n) nodes.set(id, (n = { id, type: model.typeOf(id), label: labelOf(model, id), weight: 0, floor: false, top: false, main: false }))
        return n
    }
    const kept = model.edges.filter((e) => e.kept)
    for (const e of kept) {
        node(e.threadId).weight += e.weight
        node(e.edge.entityId).weight += e.weight
        if (settings.floor && e.floor) node(e.threadId).floor = true
    }
    let links: DrawnLink[] = []
    if (settings.threadsAsNodes) {
        links = kept.map((e) => ({ source: e.threadId, target: e.edge.entityId, weight: e.weight, ...(e.weight < model.cut ? { floor: true } : {}) }))
    } else {
        // Two things are linked through the threads they share: two hops, never stored.
        const pairs = new Map<string, DrawnLink & { strength: number }>()
        const byThread = new Map<string, ModelEdge[]>()
        for (const e of kept) {
            const list = byThread.get(e.threadId)
            if (list) list.push(e)
            else byThread.set(e.threadId, [e])
        }
        for (const list of byThread.values()) {
            for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
                const [a, b] = [list[i] as ModelEdge, list[j] as ModelEdge].sort((x, y) => (x.edge.entityId < y.edge.entityId ? -1 : 1)) as [ModelEdge, ModelEdge]
                const key = `${a.edge.entityId}|${b.edge.entityId}`
                const pair = pairs.get(key) ?? { source: a.edge.entityId, target: b.edge.entityId, weight: 0, threads: 0, strength: 0 }
                pair.weight += Math.sqrt(a.weight * b.weight)
                pair.threads = (pair.threads ?? 0) + 1
                pairs.set(key, pair)
            }
        }
        const perNode = new Map<string, (DrawnLink & { strength: number })[]>()
        for (const pair of pairs.values()) {
            pair.strength = pair.weight / Math.sqrt((nodes.get(pair.source)?.weight || 1) * (nodes.get(pair.target)?.weight || 1))
            for (const id of [pair.source, pair.target]) {
                const list = perNode.get(id)
                if (list) list.push(pair)
                else perNode.set(id, [pair])
            }
        }
        const chosen = new Set<DrawnLink>()
        for (const list of perNode.values()) for (const pair of list.sort((a, b) => b.strength - a.strength).slice(0, DERIVED_LINKS_PER_NODE)) chosen.add(pair)
        links = [...chosen].map(({ source, target, weight, threads }) => ({ source, target, weight, ...(threads !== undefined ? { threads } : {}) }))
        for (const id of [...nodes.keys()]) if (id.startsWith('thread:')) nodes.delete(id)
    }
    const linked = new Set(links.flatMap((l) => [l.source, l.target]))
    for (const id of [...nodes.keys()]) if (!linked.has(id)) nodes.delete(id)

    for (const [type, count] of [['topic', 22], ['person', 6], ['agent', 6]] as const) {
        [...nodes.values()].filter((n) => n.type === type).sort((a, b) => b.weight - a.weight).slice(0, count).forEach((n) => { n.top = true })
    }
    const neighbours = new Map<string, string[]>()
    for (const l of links) {
        neighbours.set(l.source, [...(neighbours.get(l.source) ?? []), l.target])
        neighbours.set(l.target, [...(neighbours.get(l.target) ?? []), l.source])
    }
    const seen = new Set<string>()
    let largest: string[] = []
    for (const id of nodes.keys()) {
        if (seen.has(id)) continue
        const piece: string[] = []
        const stack = [id]
        seen.add(id)
        while (stack.length) {
            const at = stack.pop() as string
            piece.push(at)
            for (const next of neighbours.get(at) ?? []) if (!seen.has(next)) { seen.add(next); stack.push(next) }
        }
        if (piece.length > largest.length) largest = piece
    }
    for (const id of largest) { const n = nodes.get(id); if (n) n.main = true }
    const heaviest = (thread: boolean): number => Math.max(1e-9, ...[...nodes.values()].filter((n) => (n.type === 'thread') === thread).map((n) => n.weight))
    return { nodes: [...nodes.values()], links, maxThread: heaviest(true), maxEntity: heaviest(false) }
}

export function formatWeight(weight: number): string {
    return weight >= 10 ? weight.toFixed(0) : weight >= 1 ? weight.toFixed(1) : weight.toFixed(2)
}
