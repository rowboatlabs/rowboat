import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { find } from '@x/shared'

const jumps = vi.hoisted(() => [] as unknown[])
const search = vi.hoisted(() => ({ results: { messages: [] as unknown[], topics: [] as unknown[], assets: [], truncated: { messages: false, topics: false, assets: false } }, findResult: null as unknown }))
vi.mock('@/hooks/use-space-chat', () => ({ STREAM_READ_KEY: 'stream', getStreamState: () => ({ messages: [], topicsByRoot: new Map() }) }))
vi.mock('@/lib/spaces-auto-route', () => ({
    collectRouteCandidates: () => [
        { rootMessageId: 'r1', title: 'Offsite', rootText: 'Where in November?', rootAuthor: 'Priya', rootAuthorId: 'p', replyCount: 5, lastActivityAt: '2026-09-23T11:00:00.000Z' },
        { rootMessageId: 'r2', title: null, rootText: 'Lunch?', replyCount: 0, lastActivityAt: '2026-09-23T09:00:00.000Z' },
    ],
}))
vi.mock('@/lib/spaces-jump', () => ({ requestJump: (t: unknown) => jumps.push(t) }))

import { clearFindSession, findNext, gatherFindCandidates, getFindSession, landingOf, runFind } from './spaces-find'

const memberNames = new Map([['p', 'Priya'], ['s', 'Sam']])
const spaceNames = new Map<string, string>()
const nav = { openThread: vi.fn(), openStream: vi.fn() }

beforeEach(() => {
    jumps.length = 0
    nav.openThread.mockClear()
    nav.openStream.mockClear()
    clearFindSession()
    search.results = { messages: [], topics: [], assets: [], truncated: { messages: false, topics: false, assets: false } }
    Object.defineProperty(window, 'ipc', {
        configurable: true,
        value: {
            invoke: vi.fn(async (channel: string) => {
                if (channel === 'spaces:search') return search.results
                if (channel === 'spaces:findMessage') return search.findResult
                throw new Error(`unexpected ${channel}`)
            }),
        },
    })
})

const c = (over: Partial<find.FindCandidate> & { messageId: string }): find.FindCandidate => ({
    threadRootId: over.messageId, title: null, text: 't', at: '2026-09-23T00:00:00.000Z', source: 'recent', ...over,
})

describe('landingOf', () => {
    it('opens threads for replies, topics and replied-to roots, and the stream for a lone root', () => {
        expect(landingOf(c({ messageId: 'x', threadRootId: 'r' }))).toEqual({ pane: 'thread', rootMessageId: 'r' })
        expect(landingOf(c({ messageId: 'r', title: 'T' }))).toEqual({ pane: 'thread', rootMessageId: 'r' })
        expect(landingOf(c({ messageId: 'r', replyCount: 2 }))).toEqual({ pane: 'thread', rootMessageId: 'r' })
        expect(landingOf(c({ messageId: 'r', replyCount: 0 }))).toEqual({ pane: 'stream' })
    })
})

describe('gatherFindCandidates', () => {
    it('merges recent roots with search hits, one entry per message, names resolved', async () => {
        search.results.topics = [{ topic: { id: 't', spaceId: 's1', rootMessageId: 'r1', title: 'Offsite', createdBy: { memberId: 'p', actingMode: 'direct' }, createdAt: '2026-09-20T00:00:00.000Z', archived: false } }]
        search.results.messages = [
            { messageId: 'm9', threadRootId: 'r1', topicTitle: 'Offsite', author: { memberId: 's', actingMode: 'direct' }, snippet: 'Lisbon gets [@Priya](#member:p)’s vote', postedAt: '2026-09-22T10:00:00.000Z', offset: 40 },
            { messageId: 'r2', threadRootId: 'r2', author: { memberId: 'p', actingMode: 'direct' }, snippet: 'Lunch?', postedAt: '2026-09-23T09:00:00.000Z', offset: 50 },
        ]
        const out = await gatherFindCandidates('o1', 's1', 'lisbon', memberNames, spaceNames)
        expect(out.map((x) => x.messageId)).toEqual(['r1', 'r2', 'm9'])
        expect(out[0]).toMatchObject({ source: 'recent', title: 'Offsite', author: 'Priya', replyCount: 5 })
        expect(out[2]).toMatchObject({ source: 'search', threadRootId: 'r1', title: 'Offsite', text: 'Lisbon gets @Priya’s vote', author: 'Sam', offset: 40 })
    })

    it('stands on the recent roots when the org search fails', async () => {
        ;(window as unknown as { ipc: { invoke: ReturnType<typeof vi.fn> } }).ipc.invoke.mockImplementation(async () => { throw new Error('offline') })
        const out = await gatherFindCandidates('o1', 's1', 'x', memberNames, spaceNames)
        expect(out.map((x) => x.messageId)).toEqual(['r1', 'r2'])
    })
})

describe('runFind and findNext', () => {
    it('lands on the top pick, then walks the ranking and ends when spent', async () => {
        search.findResult = { reason: 'ranked', found: true, presence: 0.9, confidence: 0.8, ranked: [{ messageId: 'r1', probability: 0.6 }, { messageId: 'r2', probability: 0.3 }, { messageId: 'zz', probability: 0.01 }] }
        const res = await runFind({ orgId: 'o1', spaceId: 's1', spaceName: 'eng', query: 'offsite', memberNames, spaceNames, nav })
        expect(res).toMatchObject({ outcome: 'landed', candidate: { messageId: 'r1' }, total: 2 })
        expect(nav.openThread).toHaveBeenCalledWith('r1')
        expect(jumps[0]).toEqual({ topicId: 'r1', messageId: 'r1' })
        expect(getFindSession()).toMatchObject({ query: 'offsite', index: 0 })

        const next = findNext(nav)
        expect(next?.messageId).toBe('r2')
        expect(nav.openStream).toHaveBeenCalled()
        expect(jumps[1]).toEqual({ topicId: 'stream', messageId: 'r2' })
        expect(getFindSession()).toMatchObject({ index: 1 })

        expect(findNext(nav)).toBeNull()
        expect(getFindSession()).toBeNull()
    })

    it('reports not found, no key, and errors without opening a session', async () => {
        search.findResult = { reason: 'ranked', found: false, ranked: [{ messageId: 'r1', probability: 0.3 }] }
        expect(await runFind({ orgId: 'o1', spaceId: 's1', spaceName: 'eng', query: 'q', memberNames, spaceNames, nav })).toEqual({ outcome: 'not-found' })
        search.findResult = { reason: 'no-key', found: false, ranked: [] }
        expect(await runFind({ orgId: 'o1', spaceId: 's1', spaceName: 'eng', query: 'q', memberNames, spaceNames, nav })).toEqual({ outcome: 'no-key' })
        ;(window as unknown as { ipc: { invoke: ReturnType<typeof vi.fn> } }).ipc.invoke.mockImplementation(async (channel: string) => {
            if (channel === 'spaces:search') return search.results
            throw new Error('boom')
        })
        expect(await runFind({ orgId: 'o1', spaceId: 's1', spaceName: 'eng', query: 'q', memberNames, spaceNames, nav })).toEqual({ outcome: 'error', error: 'boom' })
        expect(getFindSession()).toBeNull()
        expect(nav.openThread).not.toHaveBeenCalled()
    })
})
