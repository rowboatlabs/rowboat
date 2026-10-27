import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'

// The stream store's detached window (load-around, 2026-09-14): a jump to a
// row the tail does not hold swaps the window for the page around it; newer
// roots exist above it until the reader pages forward to the head or jumps
// back. Live roots meanwhile are counted, not merged; the persisted cold-open
// paint stays the tail throughout.

type Listener = (event: unknown) => void
const feed = vi.hoisted(() => ({ listeners: new Set<Listener>() }))
vi.mock('@/lib/spaces-feed', () => ({
    subscribeSpacesFeed: (listener: Listener) => {
        feed.listeners.add(listener)
        return () => feed.listeners.delete(listener)
    },
}))
vi.mock('@/hooks/use-spaces', () => ({
    feedSyncedRecently: () => false,
    getSpaceFeed: () => ({ loaded: false, topics: [], changeSets: [] }),
    getSpacesOrgs: () => [],
    isReconnect: () => true,
    refreshSpaceFeed: vi.fn(async () => {}),
    subscribeOrgs: () => () => {},
    subscribeSpaceFeedStore: () => () => {},
    useSpaceLive: () => {},
}))
vi.mock('@/lib/spaces-read-state', () => ({
    countUnread: () => 0,
    noteStreamReadOffset: vi.fn(),
    spaceBadge: () => ({ unread: 0, forMe: 0 }),
    subscribeReadState: () => () => {},
}))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
vi.mock('@/lib/spaces-agent-activity', () => ({ useSpaceAgentActivity: () => new Map() }))

const emit = (event: unknown) => {
    for (const l of feed.listeners) l(event)
}
const live = (event: object) => emit({ orgId: 'org', frame: { kind: 'event', spaceId: 'space', event } })

const msg = (offset: number): spaces.Message => ({
    id: `m${offset}`, spaceId: 'space', author: { memberId: 'alex', actingMode: 'direct' }, body: `body ${offset}`,
    postedAt: '2026-09-14T09:00:00Z', offset, replyCount: 0, replyAuthors: [], mentions: [], mentionsHere: false, mentionsRowboat: false, reactions: [],
})
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => msg(from + i))
const ids = (messages: readonly { id: string }[]) => messages.map((m) => m.id)

/** The org's log: roots 1..100. The head page is the last ten; other windows are cut to order. */
const HEAD = 100
const invoke = vi.fn()
const listStreamCalls = () => invoke.mock.calls.filter(([c]) => c === 'spaces:listStream').map(([, args]) => args as Record<string, unknown>)

beforeEach(() => {
    vi.resetModules()
    feed.listeners.clear()
    window.localStorage.clear()
    invoke.mockReset()
    invoke.mockImplementation(async (channel: string, args: { aroundOffset?: number; afterOffset?: number; beforeOffset?: number }) => {
        if (channel !== 'spaces:listStream') throw new Error(`unexpected ${channel}`)
        if (args.aroundOffset !== undefined) {
            const at = args.aroundOffset
            return { messages: range(at - 5, at + 5), topics: [], hasMore: at - 5 > 1, hasMoreAfter: at + 5 < HEAD, readOffset: 0 }
        }
        if (args.afterOffset !== undefined) {
            const from = args.afterOffset + 1
            const to = Math.min(from + 9, HEAD)
            // An older org omits hasMoreAfter — the head reached reads as false either way.
            return { messages: range(from, to), topics: [], hasMore: false, ...(to < HEAD ? { hasMoreAfter: true } : {}), readOffset: 0 }
        }
        return { messages: range(HEAD - 9, HEAD), topics: [], hasMore: true, readOffset: 0 }
    })
    ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: () => () => {} }
})

async function open() {
    const mod = await import('./use-space-chat')
    const hook = renderHook(() => mod.useStream('org', 'space'))
    await act(async () => {})
    expect(ids(hook.result.current.messages)).toEqual(ids(range(91, 100)))
    return { mod, hook }
}

describe('stream store — detached window', () => {
    it('loadStreamAround replaces the window with the page around the row and marks it detached', async () => {
        const { mod, hook } = await open()
        await act(() => mod.loadStreamAround('org', 'space', 50))
        const state = hook.result.current
        expect(ids(state.messages)).toEqual(ids(range(45, 55)))
        expect(state.hasMore).toBe(true)
        expect(state.hasMoreAfter).toBe(true)
        expect(state.newerSince).toBe(0)
        expect(state.ready).toBe(true)
    })

    it('live roots while detached are counted, not merged; rows in the window still update', async () => {
        const { mod, hook } = await open()
        await act(() => mod.loadStreamAround('org', 'space', 50))
        act(() => live({ type: 'message', message: msg(101) }))
        act(() => live({ type: 'message', message: msg(102) }))
        expect(ids(hook.result.current.messages)).toEqual(ids(range(45, 55)))
        expect(hook.result.current.newerSince).toBe(2)
        act(() => live({ type: 'message_edited', edit: { messageId: 'm50', body: 'edited', at: '2026-09-14T10:00:00Z', mentions: [], mentionsHere: false, mentionsRowboat: false } }))
        expect(hook.result.current.messages.find((m) => m.id === 'm50')?.body).toBe('edited')
        act(() => live({ type: 'message_deleted', deletion: { messageId: 'm51', at: '2026-09-14T10:00:00Z' } }))
        expect(hook.result.current.messages.find((m) => m.id === 'm51')?.deletedAt).toBe('2026-09-14T10:00:00Z')
        expect(hook.result.current.newerSince).toBe(2)
    })

    it('loadNewerStreamMessages pages forward from the newest row until the head, which clears the count', async () => {
        const { mod, hook } = await open()
        await act(() => mod.loadStreamAround('org', 'space', 80))
        act(() => live({ type: 'message', message: msg(101) }))
        expect(hook.result.current.newerSince).toBe(1)
        await act(() => mod.loadNewerStreamMessages('org', 'space'))
        expect(listStreamCalls().at(-1)).toEqual({ orgId: 'org', spaceId: 'space', afterOffset: 85 })
        expect(ids(hook.result.current.messages)).toEqual(ids(range(75, 95)))
        expect(hook.result.current.hasMoreAfter).toBe(true)
        expect(hook.result.current.newerSince).toBe(1)
        await act(() => mod.loadNewerStreamMessages('org', 'space'))
        expect(ids(hook.result.current.messages)).toEqual(ids(range(75, 100)))
        expect(hook.result.current.hasMoreAfter).toBe(false)
        expect(hook.result.current.newerSince).toBe(0)
        // Attached again: live roots merge as before.
        act(() => live({ type: 'message', message: msg(101) }))
        expect(ids(hook.result.current.messages).at(-1)).toBe('m101')
        // Nothing to page once attached.
        const calls = listStreamCalls().length
        await act(() => mod.loadNewerStreamMessages('org', 'space'))
        expect(listStreamCalls().length).toBe(calls)
    })

    it('jumpToLatest drops the window for the head page', async () => {
        const { mod, hook } = await open()
        await act(() => mod.loadStreamAround('org', 'space', 50))
        act(() => live({ type: 'message', message: msg(101) }))
        await act(() => mod.jumpToLatest('org', 'space'))
        const state = hook.result.current
        expect(ids(state.messages)).toEqual(ids(range(91, 100)))
        expect(state.hasMoreAfter).toBe(false)
        expect(state.newerSince).toBe(0)
        expect(state.hasMore).toBe(true)
    })

    it('jumpToLatest is not ready until the head page lands — no flash of the empty-space copy', async () => {
        const { mod, hook } = await open()
        await act(() => mod.loadStreamAround('org', 'space', 50))
        let release: (() => void) | null = null
        const prior = invoke.getMockImplementation()!
        invoke.mockImplementation((channel: string, args: never) =>
            channel === 'spaces:listStream' && !(args as { aroundOffset?: number }).aroundOffset
                ? new Promise((resolve) => { release = () => resolve(prior(channel, args)) })
                : prior(channel, args),
        )
        let jump: Promise<void> = Promise.resolve()
        await act(async () => {
            jump = mod.jumpToLatest('org', 'space')
            await Promise.resolve()
        })
        expect(hook.result.current.ready).toBe(false)
        expect(hook.result.current.messages).toEqual([])
        await act(async () => {
            release!()
            await jump
        })
        expect(hook.result.current.ready).toBe(true)
        expect(ids(hook.result.current.messages)).toEqual(ids(range(91, 100)))
    })

    it('a send that fails after a jump swept its row away tells the sender instead of vanishing', async () => {
        const { mod, hook } = await open()
        const pending = mod.buildPendingMessage('space', 'me', 'the words I typed')
        act(() => mod.ingestStreamMessage('org', 'space', pending))
        expect(ids(hook.result.current.messages)).toContain(pending.id)
        await act(() => mod.loadStreamAround('org', 'space', 50))
        expect(ids(hook.result.current.messages)).not.toContain(pending.id)
        act(() => mod.failPendingStreamMessage('org', 'space', pending.id, 'the words I typed'))
        const { toast } = await import('@/lib/toast')
        expect(toast).toHaveBeenCalledWith(expect.stringContaining('the words I typed'), 'error')
    })

    it('a reconnect resync while detached leaves the window and makes the count unknown', async () => {
        const { mod, hook } = await open()
        await act(() => mod.loadStreamAround('org', 'space', 50))
        act(() => live({ type: 'message', message: msg(101) }))
        await act(async () => {
            emit({ orgId: 'org', frame: { kind: 'subscribed', spaceId: 'space' } })
        })
        expect(listStreamCalls().at(-1)).toEqual({ orgId: 'org', spaceId: 'space' })
        expect(ids(hook.result.current.messages)).toEqual(ids(range(45, 55)))
        expect(hook.result.current.hasMoreAfter).toBe(true)
        expect(hook.result.current.newerSince).toBeNull()
        // Unknown stays unknown until the head is reached or the window is dropped.
        act(() => live({ type: 'message', message: msg(102) }))
        expect(hook.result.current.newerSince).toBeNull()
    })

    it('the persisted cold-open tail is never a detached window', async () => {
        const { mod } = await open()
        const cached = () => JSON.parse(window.localStorage.getItem('spaces:general:org/space')!) as { messages: { id: string }[] }
        expect(ids(cached().messages)).toEqual(ids(range(91, 100)))
        await act(() => mod.loadStreamAround('org', 'space', 50))
        act(() => live({ type: 'message', message: msg(101) }))
        expect(ids(cached().messages)).toEqual(ids(range(91, 100)))
        await act(() => mod.jumpToLatest('org', 'space'))
        expect(ids(cached().messages)).toEqual(ids(range(91, 100)))
    })

    it('opening a space whose window was left detached lands on the tail again', async () => {
        const { mod, hook } = await open()
        await act(() => mod.loadStreamAround('org', 'space', 50))
        hook.unmount()
        const again = renderHook(() => mod.useStream('org', 'space'))
        await act(async () => {})
        expect(ids(again.result.current.messages)).toEqual(ids(range(91, 100)))
        expect(again.result.current.hasMoreAfter).toBe(false)
    })
})

// Join and leave lines (2026-09-29): the page's membership events ride with
// its messages, merge by offset across pages, arrive live on the tail, and
// paint from the cold-open cache.
describe('stream store — join lines', () => {
    const line = (offset: number, memberId: string): spaces.StreamEvent => ({
        offset,
        at: '2026-09-14T09:00:00Z',
        event: { type: 'membership', action: 'joined', membership: { spaceId: 'space', memberId, joinedAt: '2026-09-14T09:00:00Z' } },
    })
    const offsets = (events: readonly spaces.StreamEvent[]) => events.map((e) => e.offset)

    beforeEach(() => {
        const base = invoke.getMockImplementation()!
        invoke.mockImplementation(async (channel: string, args: { beforeOffset?: number; aroundOffset?: number; afterOffset?: number }) => {
            const page = await base(channel, args)
            if (args.beforeOffset !== undefined) return { messages: range(81, 90), topics: [], hasMore: true, readOffset: 0, events: [line(85.5, 'kim')] }
            return { ...page, events: args.aroundOffset === undefined && args.afterOffset === undefined ? [line(95.5, 'sam'), line(100.5, 'alex')] : [] }
        })
    })

    it('keeps the head page’s lines and adds an older page’s', async () => {
        const { mod, hook } = await open()
        expect(offsets(hook.result.current.events)).toEqual([95.5, 100.5])
        await act(() => mod.loadOlderStreamMessages('org', 'space'))
        expect(offsets(hook.result.current.events)).toEqual([85.5, 95.5, 100.5])
    })

    it('takes a live line on the tail, never while the window is detached', async () => {
        const { mod, hook } = await open()
        const frame = (offset: number) =>
            emit({ orgId: 'org', frame: { kind: 'event', spaceId: 'space', offset, at: '2026-09-14T10:00:00Z', event: line(offset, 'kim').event } })
        act(() => frame(101))
        expect(offsets(hook.result.current.events)).toEqual([95.5, 100.5, 101])
        await act(() => mod.loadStreamAround('org', 'space', 50))
        act(() => frame(102))
        expect(hook.result.current.events).toEqual([])
        expect(hook.result.current.newerSince).toBe(0)
    })

    it('paints the cached tail’s lines on a cold open', async () => {
        await open()
        const cached = JSON.parse(window.localStorage.getItem('spaces:general:org/space')!) as { events: spaces.StreamEvent[] }
        expect(offsets(cached.events)).toEqual([95.5, 100.5])
    })
})

describe('stream store — summaries (2026-10-25)', () => {
    it('a live edit replaces the summary, and one without a summary removes it', async () => {
        const { hook } = await open()
        const edit = (summary?: string) => live({ type: 'message_edited', edit: {
            messageId: 'm100', body: 'long body', at: '2026-10-25T10:00:00Z', mentions: [], mentionsHere: false, mentionsRowboat: false, ...(summary ? { summary } : {}),
        } })
        act(() => edit('the point'))
        expect(hook.result.current.messages.find((m) => m.id === 'm100')?.summary).toBe('the point')
        act(() => edit())
        expect(hook.result.current.messages.find((m) => m.id === 'm100')).not.toHaveProperty('summary')
    })
})

describe('stream store — the inline view (2026-10-25)', () => {
    const reply = (offset: number, rootId: string): spaces.Message => ({ ...msg(offset), id: `r${offset}`, threadRoot: rootId })

    it('reads with replies, takes live replies, and fetches a root it cannot name', async () => {
        const view = await import('@/lib/spaces-stream-view')
        view.setStreamView('org', 'space', 'inline')
        try {
            const base = invoke.getMockImplementation()!
            invoke.mockImplementation(async (channel: string, args: { messageId?: string }) =>
                channel === 'spaces:getMessage' ? { message: { ...msg(3), id: args.messageId, body: 'Fix the login bug' } } : base(channel, args))
            const { hook } = await open()
            expect(listStreamCalls().at(-1)).toMatchObject({ replies: true })
            await act(async () => live({ type: 'message', message: reply(101, 'm3') }))
            expect(ids(hook.result.current.messages).at(-1)).toBe('r101')
            expect(hook.result.current.threadRoots.get('m3')?.body).toBe('Fix the login bug')
            // A root the window holds needs no fetch.
            await act(async () => live({ type: 'message', message: reply(102, 'm95') }))
            expect(invoke.mock.calls.filter(([c]) => c === 'spaces:getMessage')).toHaveLength(1)
        } finally {
            view.setStreamView('org', 'space', 'threads')
        }
    })

    it('the threads view leaves live replies in their threads and reads roots only', async () => {
        const { hook } = await open()
        expect(listStreamCalls().at(-1)).not.toHaveProperty('replies')
        act(() => live({ type: 'message', message: reply(101, 'm95') }))
        expect(ids(hook.result.current.messages)).toEqual(ids(range(91, 100)))
    })

    it('switching views reads the other window, and switching back refetches what it missed', async () => {
        const view = await import('@/lib/spaces-stream-view')
        const { hook } = await open()
        const before = listStreamCalls().length
        await act(async () => view.setStreamView('org', 'space', 'inline'))
        expect(listStreamCalls().length).toBe(before + 1)
        expect(listStreamCalls().at(-1)).toMatchObject({ replies: true })
        await act(async () => view.setStreamView('org', 'space', 'threads'))
        expect(listStreamCalls().length).toBe(before + 2)
        expect(listStreamCalls().at(-1)).not.toHaveProperty('replies')
        expect(ids(hook.result.current.messages)).toEqual(ids(range(91, 100)))
    })
})
