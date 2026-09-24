import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type { ChatMessage } from '@/hooks/use-space-chat'

const feed = vi.hoisted(() => ({ topics: [] as spaces.TopicListing[] }))
const streamStub = vi.hoisted(() => ({ state: { messages: [] as ChatMessage[], topicsByRoot: new Map<string, spaces.Topic>() } }))
// Full replacements, not importOriginal: both hook modules wire window.ipc at
// load, which jsdom does not have. The module under test uses only these.
vi.mock('@/hooks/use-spaces', () => ({
    getSpaceFeed: () => ({ topics: feed.topics, changeSets: [], loaded: true }),
}))
vi.mock('@/hooks/use-space-chat', () => ({
    getStreamState: () => streamStub.state,
    getThreadSnapshot: () => undefined,
}))

import { collectRouteCandidates, getAutoRouteMode, routeThreadLabel, setAutoRouteMode } from './spaces-auto-route'

const memberNames = new Map([['m1', 'Sam'], ['m2', 'Arjun']])
const spaceNames = new Map<string, string>()

function message(over: Partial<ChatMessage> & { id: string }): ChatMessage {
    return {
        spaceId: 's1',
        author: { memberId: 'm1', actingMode: 'direct' },
        body: 'hello',
        postedAt: '2026-09-22T09:00:00.000Z',
        offset: 1,
        replyCount: 0,
        mentions: [],
        mentionsHere: false,
        mentionsRowboat: false,
        reactions: [],
        ...over,
    }
}

function topic(over: Partial<spaces.TopicListing> & { id: string; rootMessageId: string; title: string }): spaces.TopicListing {
    return {
        spaceId: 's1',
        createdBy: { memberId: 'm1', actingMode: 'direct' },
        createdAt: '2026-09-22T08:00:00.000Z',
        archived: false,
        rootMessage: null,
        lastActivityAt: '2026-09-22T08:00:00.000Z',
        ...over,
    }
}

beforeEach(() => {
    feed.topics = []
    window.localStorage.clear()
})

describe('collectRouteCandidates', () => {
    it('lists open topics and every live root once each, newest activity first', () => {
        const root = message({ id: 'r1', body: 'CI is red on main ![shot](app://x/b/abc)', replyCount: 3, lastReplyAt: '2026-09-22T12:00:00.000Z' })
        feed.topics = [
            topic({ id: 't1', rootMessageId: 'r1', title: 'CI status', rootMessage: root, lastActivityAt: '2026-09-22T12:00:00.000Z' }),
            topic({ id: 't2', rootMessageId: 'r2', title: 'Offsite', lastActivityAt: '2026-09-22T13:00:00.000Z' }),
            topic({ id: 't3', rootMessageId: 'r3', title: 'Old', archived: true }),
        ]
        const stream = {
            messages: [
                root,
                message({ id: 'r4', body: 'Lunch?', replyCount: 2, author: { memberId: 'm2', actingMode: 'direct' }, postedAt: '2026-09-22T11:00:00.000Z' }),
                message({ id: 'r5', body: 'No replies here', replyCount: 0 }),
                message({ id: 'r6', body: 'Pending', replyCount: 1, pending: true }),
                message({ id: 'r7', body: '', replyCount: 4, deletedAt: '2026-09-22T10:00:00.000Z' }),
            ],
            topicsByRoot: new Map<string, spaces.Topic>(),
        }

        const candidates = collectRouteCandidates('o1', 's1', stream, memberNames, spaceNames)

        // r5 has no replies yet and still counts: a root IS a thread. r6 is
        // unconfirmed and r7 is a tombstone, so neither is a destination.
        expect(candidates.map((c) => c.rootMessageId)).toEqual(['r2', 'r1', 'r4', 'r5'])
        expect(candidates[1]).toMatchObject({ title: 'CI status', rootText: 'CI is red on main', rootAuthor: 'Sam', replyCount: 3 })
        expect(candidates[2]).toMatchObject({ title: null, rootText: 'Lunch?', rootAuthor: 'Arjun', replyCount: 2, lastActivityAt: '2026-09-22T11:00:00.000Z' })
        expect(candidates[3]).toMatchObject({ title: null, rootText: 'No replies here', replyCount: 0, lastActivityAt: '2026-09-22T09:00:00.000Z' })
    })

    it('skips a root whose topic is archived', () => {
        const stream = {
            messages: [message({ id: 'r1', replyCount: 2 })],
            topicsByRoot: new Map<string, spaces.Topic>([
                ['r1', { id: 't1', spaceId: 's1', rootMessageId: 'r1', title: 'Done', createdBy: { memberId: 'm1', actingMode: 'direct' }, createdAt: '2026-09-22T08:00:00.000Z', archived: true }],
            ]),
        }
        expect(collectRouteCandidates('o1', 's1', stream, memberNames, spaceNames)).toEqual([])
    })
})

describe('routeThreadLabel', () => {
    it('prefers the topic title, then the root first line, then a generic name', () => {
        feed.topics = [topic({ id: 't1', rootMessageId: 'r1', title: 'CI status' })]
        streamStub.state = { messages: [message({ id: 'r2', body: 'Lunch?\nmore below' })], topicsByRoot: new Map() }
        expect(routeThreadLabel('o1', 's1', 'r1', memberNames, spaceNames)).toBe('CI status')
        expect(routeThreadLabel('o1', 's1', 'r2', memberNames, spaceNames)).toBe('Lunch?')
        expect(routeThreadLabel('o1', 's1', 'zz', memberNames, spaceNames)).toBe('the thread')
    })
})

describe('the mode', () => {
    it('persists per install and reads absent as off', () => {
        expect(getAutoRouteMode()).toBe('off')
        setAutoRouteMode('preview')
        expect(getAutoRouteMode()).toBe('preview')
        expect(window.localStorage.getItem('spaces:auto-route')).toBe('preview')
        setAutoRouteMode('post')
        expect(window.localStorage.getItem('spaces:auto-route')).toBe('post')
        setAutoRouteMode('off')
        expect(window.localStorage.getItem('spaces:auto-route')).toBeNull()
    })

    it('reads the pre-mode on flag as preview, the default', async () => {
        window.localStorage.setItem('spaces:auto-route', '1')
        vi.resetModules()
        const fresh = await import('./spaces-auto-route')
        expect(fresh.getAutoRouteMode()).toBe('preview')
    })
})
