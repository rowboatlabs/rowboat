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
    postedAt: '2026-09-14T09:00:00Z', offset, replyCount: 0, mentions: [], mentionsHere: false, mentionsRowboat: false, reactions: [],
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
