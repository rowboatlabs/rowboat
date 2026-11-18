import { describe, expect, it } from 'vitest'
import type { spaces } from '@x/shared'
import { buildGraphModel, closestTo, DEFAULT_GRAPH_SETTINGS, projectGraph, threadNodeId, type GraphSettings } from './space-graph-model'

const NOW = '2026-11-12T00:00:00.000Z'
const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString()
const thread = (id: string, over: Partial<spaces.GraphThread> = {}): spaces.GraphThread => ({
    rootMessageId: id, title: `Thread ${id}`, startedAt: daysAgo(1), lastAt: daysAgo(1), messageCount: 3,
    kind: 'feature', kindProbability: 0.9, resolved: 0.1, decision: 0.1, importance: 2, ...over,
})
const edge = (root: string, entityId: string, days: number, over: Partial<spaces.GraphEdge> = {}): spaces.GraphEdge => ({
    rootMessageId: root, entityId, relation: 'subject', probability: 0.9, strength: 0.9, events: [{ at: daysAgo(days), share: 1 }], ...over,
})
const entity = (id: string, kind: spaces.GraphEntityKind, label: string, memberId?: string): spaces.GraphEntity => ({ id, kind, label, aliases: [], ...(memberId ? { memberId } : {}) })

const graph: spaces.SpaceGraph = {
    status: 'ready', now: NOW, pending: 0,
    threads: [thread('A'), thread('B'), thread('OLD', { decision: 0.9, importance: 3.5 }), thread('STANDUP', { kind: 'routine' })],
    entities: [entity('topic:harbor', 'topic', 'Harbor'), entity('topic:billing', 'topic', 'Billing'), entity('member:sam', 'member', 'Sam', 'sam'), entity('member:bot', 'member', 'Bot', 'bot')],
    edges: [
        edge('A', 'topic:harbor', 1), edge('A', 'member:sam', 1), edge('A', 'member:bot', 1),
        edge('B', 'topic:harbor', 2), edge('B', 'topic:billing', 2), edge('B', 'member:sam', 2),
        edge('OLD', 'topic:billing', 400), edge('STANDUP', 'member:sam', 1),
    ],
}
const settings = (over: Partial<GraphSettings> = {}): GraphSettings => ({ ...DEFAULT_GRAPH_SETTINGS, ...over })
const AGENTS = new Set(['bot'])

describe('the space graph model', () => {
    it('types members as people or agents from the roster, and leaves out thread kinds and node types that are switched off', () => {
        const model = buildGraphModel(graph, settings({ keep: 100 }), AGENTS)
        expect(model.typeOf('member:sam')).toBe('person')
        expect(model.typeOf('member:bot')).toBe('agent')
        expect(model.typeOf(threadNodeId('A'))).toBe('thread')
        expect(model.byNode.has(threadNodeId('STANDUP'))).toBe(false)
        const noAgents = buildGraphModel(graph, settings({ keep: 100, types: new Set(['person', 'topic']) }), AGENTS)
        expect(noAgents.byNode.has('member:bot')).toBe(false)
    })

    it('prunes the weakest edges, but the decision floor holds a notable decision thread however old', () => {
        const pruned = buildGraphModel(graph, settings({ keep: 30 }), AGENTS)
        const old = pruned.edges.find((e) => e.edge.rootMessageId === 'OLD')!
        expect(old.weight).toBeLessThan(pruned.cut)
        expect(old.kept).toBe(true)
        expect(buildGraphModel(graph, settings({ keep: 30, floor: false }), AGENTS).edges.find((e) => e.edge.rootMessageId === 'OLD')!.kept).toBe(false)
        expect(pruned.edges.filter((e) => e.kept).length).toBeLessThan(pruned.edges.length)
    })

    it('a longer half-life gives old activity its weight back', () => {
        const weightOfOld = (halfLifeDays: number) => buildGraphModel(graph, settings({ halfLifeDays }), AGENTS).edges.find((e) => e.edge.rootMessageId === 'OLD')!.threadSide
        expect(weightOfOld(Infinity)).toBe(1)
        expect(weightOfOld(60)).toBeLessThan(0.02)
    })

    it('draws threads as nodes, or folds them into links between what they share', () => {
        const model = buildGraphModel(graph, settings({ keep: 100 }), AGENTS)
        const withThreads = projectGraph(model, settings({ keep: 100 }))
        expect(withThreads.nodes.filter((n) => n.type === 'thread').map((n) => n.id).sort()).toEqual(['thread:A', 'thread:B', 'thread:OLD'])
        expect(withThreads.links.every((l) => l.source.startsWith('thread:'))).toBe(true)
        expect(withThreads.nodes.find((n) => n.id === 'thread:OLD')!.floor).toBe(true)

        const folded = projectGraph(model, settings({ keep: 100, threadsAsNodes: false }))
        expect(folded.nodes.some((n) => n.type === 'thread')).toBe(false)
        const link = folded.links.find((l) => l.source === 'member:sam' && l.target === 'topic:harbor')!
        expect(link.threads).toBe(2)
    })

    it('closest: a walk from a node finds what shares its threads before what does not', () => {
        const model = buildGraphModel(graph, settings({ keep: 100 }), AGENTS)
        const near = closestTo(model, 'member:bot').filter((x) => !x.id.startsWith('thread:')).map((x) => x.id)
        expect(near.indexOf('topic:harbor')).toBeLessThan(near.indexOf('topic:billing'))
        expect(closestTo(model, 'topic:nothing')).toEqual([])
    })
})
