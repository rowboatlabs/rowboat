import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import type { SpacePresence, StreamState } from '@/hooks/use-space-chat'

// The stream pane's side of load-around, with the store mocked and the window
// handed in as a prop: a jump to a row the window lacks asks the store for
// the page around it (resolving the offset first when the producer did not
// pass one), lands on the row once the window holds it, keeps the tail pin
// off while detached, pages forward from the bottom edge, and snaps back
// through the pill. jsdom has no layout, so the list's geometry is faked.

vi.mock('@/components/spaces/composer', () => ({ Composer: () => null }))
vi.mock('@/components/spaces/message-row', () => ({
    DayDivider: () => null,
    MessageRow: ({ message }: { message: { id: string; body: string } }) => <div data-mid={message.id}>{message.body}</div>,
    NewDivider: () => null,
    TypingIndicator: () => null,
}))
vi.mock('@/components/spaces/poll-dialog', () => ({ PollDialogHost: () => null }))
vi.mock('@/components/spaces/forward-dialog', () => ({ ForwardDialog: () => null }))
vi.mock('@/hooks/use-space-chat', () => ({
    STREAM_READ_KEY: 'stream',
    buildPendingMessage: vi.fn(),
    failPendingStreamMessage: vi.fn(),
    ingestStreamMessage: vi.fn(),
    jumpToLatest: vi.fn(async () => {}),
    loadNewerStreamMessages: vi.fn(async () => {}),
    loadOlderStreamMessages: vi.fn(async () => {}),
    loadStreamAround: vi.fn(async () => {}),
    prefetchThread: vi.fn(),
    removeStreamMessage: vi.fn(),
    resolvePendingStreamMessage: vi.fn(),
    updateStreamMessage: vi.fn(),
    usePresenceSender: () => ({ onType: vi.fn() }),
}))
vi.mock('@/hooks/use-spaces', () => ({ useSpaceNames: () => new Map() }))
vi.mock('@/lib/spaces-compose', () => ({ subscribeComposeInsert: () => () => {} }))
vi.mock('@/lib/spaces-read-state', () => ({
    getSpaceReadState: () => null,
    getStreamReadOffset: () => 0,
    getThreadReadState: () => null,
    isThreadUnread: () => false,
    markStreamRead: vi.fn(),
    markThreadRead: vi.fn(),
}))
vi.mock('@/lib/spaces-saved', () => ({ toggleSaved: vi.fn(), useSaved: () => [] }))
vi.mock('@/lib/spaces-rowboat', () => ({ maybeInvokeRowboat: vi.fn() }))
vi.mock('@/lib/spaces-response-chat', () => ({ openResponseChat: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
vi.mock('@/lib/analytics', () => ({
    spacesInviteLinkCopied: vi.fn(),
    spacesMessagePosted: vi.fn(),
    spacesReactionToggled: vi.fn(),
    spacesMessageDeleted: vi.fn(),
}))

import { GeneralStream } from './general-stream'
import { jumpToLatest, loadNewerStreamMessages, loadStreamAround } from '@/hooks/use-space-chat'
import { requestJump } from '@/lib/spaces-jump'
import { toast } from '@/lib/toast'

// scrollToMessage scrolls the row into view and flashes it — neither exists in jsdom.
const scrollIntoView = vi.fn()
Element.prototype.scrollIntoView = scrollIntoView
;(Element.prototype as unknown as { animate: unknown }).animate = vi.fn()

const msg = (offset: number): spaces.Message =>
    ({
        id: `m${offset}`, body: `body ${offset}`, offset, spaceId: 'space',
        author: { memberId: 'alex', actingMode: 'direct' }, postedAt: '2026-09-14T09:00:00Z', replyCount: 0,
    }) as spaces.Message
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => msg(from + i))
const streamOf = (messages: spaces.Message[], patch: Partial<StreamState> = {}): StreamState => ({
    messages, topicsByRoot: new Map(), hasMore: false, loadingOlder: false, hasMoreAfter: false, newerSince: 0, ready: true, ...patch,
})
const org = { id: 'org', memberId: 'me', address: 'org.example', name: 'Org', spaces: [], directs: [], directLabels: {} } as unknown as OrgWithSpaces
const space = { id: 'space', name: 'Space', createdAt: '2026-09-01T00:00:00Z', kind: 'shared' } as spaces.Space
const presence: SpacePresence = { here: [], typing: new Map(), working: new Map() }

/** The list's geometry: a content height and a viewport; scrollTop clamps like a browser's. */
function fakeScrollBox(el: HTMLElement, box: { scrollHeight: number; clientHeight: number }) {
    let top = 0
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => box.scrollHeight })
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => box.clientHeight })
    Object.defineProperty(el, 'scrollTop', {
        configurable: true,
        get: () => top,
        set: (v: number) => {
            top = Math.max(0, Math.min(v, box.scrollHeight - box.clientHeight))
        },
    })
}

const resizeCallbacks: Array<() => void> = []
const getMessage = vi.fn(async () => ({ message: msg(50) }))
beforeEach(() => {
    resizeCallbacks.length = 0
    scrollIntoView.mockClear()
    getMessage.mockClear()
    vi.mocked(toast).mockClear()
    vi.mocked(loadStreamAround).mockClear()
    vi.mocked(loadNewerStreamMessages).mockClear()
    vi.mocked(jumpToLatest).mockClear()
    vi.stubGlobal('ResizeObserver', class {
        constructor(cb: () => void) {
            resizeCallbacks.push(cb)
        }
        observe() {}
        unobserve() {}
        disconnect() {}
    })
    Object.defineProperty(window, 'ipc', {
        configurable: true,
        value: {
            invoke: vi.fn(async (channel: string) => {
                if (channel === 'spaces:getMessage') return getMessage()
                return {}
            }),
        },
    })
})
afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
})

function mount(stream: StreamState) {
    const utils = render(<GeneralStream org={org} space={space} stream={stream} presence={presence} memberNames={new Map()} onOpenThread={vi.fn()} />)
    const list = document.querySelector<HTMLElement>('.spaces-message-list')!
    const box = { scrollHeight: 1000, clientHeight: 300 }
    fakeScrollBox(list, box)
    return {
        list,
        box,
        rerender: (next: StreamState) =>
            utils.rerender(<GeneralStream org={org} space={space} stream={next} presence={presence} memberNames={new Map()} onOpenThread={vi.fn()} />),
    }
}
const rowOf = (id: string) => document.querySelector<HTMLElement>(`[data-mid="${id}"]`)
const jump = (messageId: string, offset?: number) =>
    act(async () => {
        requestJump({ topicId: 'stream', messageId, ...(offset !== undefined ? { offset } : {}) })
    })

describe('GeneralStream jump to a row outside the window', () => {
    it('resolves the offset with one lookup and loads around it; lands once the window holds the row', async () => {
        const head = streamOf(range(91, 100))
        const { list, box, rerender } = mount(head)
        await screen.findByText('body 100')
        // The store swaps the window for the page around the row before its promise settles.
        vi.mocked(loadStreamAround).mockImplementationOnce(async () => rerender(streamOf(range(45, 55), { hasMore: true, hasMoreAfter: true })))
        await jump('m50')
        expect(getMessage).toHaveBeenCalledTimes(1)
        expect(loadStreamAround).toHaveBeenCalledWith('org', 'space', 50)
        await screen.findByText('body 50')
        expect(scrollIntoView.mock.instances).toContain(rowOf('m50'))
        expect(screen.getByText('Jump to latest')).toBeTruthy()
        // The tail pin is off: growth leaves the landing spot alone.
        list.scrollTop = 100
        fireEvent.scroll(list)
        box.scrollHeight += 400
        act(() => {
            for (const cb of resizeCallbacks) cb()
        })
        expect(list.scrollTop).toBe(100)
        // What arrived at the tail since shows on the pill; a resync makes it unknown.
        rerender(streamOf(range(45, 55), { hasMore: true, hasMoreAfter: true, newerSince: 3 }))
        expect(screen.getByText('Jump to latest · 3 new')).toBeTruthy()
        rerender(streamOf(range(45, 55), { hasMore: true, hasMoreAfter: true, newerSince: null }))
        expect(screen.getByText('Jump to latest')).toBeTruthy()
        // The bottom edge pages forward.
        list.scrollTop = box.scrollHeight - box.clientHeight
        fireEvent.scroll(list)
        expect(loadNewerStreamMessages).toHaveBeenCalledWith('org', 'space')
        // The pill snaps back to the tail.
        fireEvent.click(screen.getByText('Jump to latest'))
        await act(async () => {})
        expect(jumpToLatest).toHaveBeenCalledWith('org', 'space')
        rerender(head)
        expect(screen.queryByText('Jump to latest')).toBeNull()
        expect(screen.getByText('body 100')).toBeTruthy()
    })

    it('uses the offset the producer passed — no lookup', async () => {
        mount(streamOf(range(91, 100)))
        await screen.findByText('body 100')
        await jump('m50', 50)
        expect(getMessage).not.toHaveBeenCalled()
        expect(loadStreamAround).toHaveBeenCalledWith('org', 'space', 50)
    })

    it('a row already in the window lands without asking the store', async () => {
        mount(streamOf(range(91, 100)))
        await screen.findByText('body 100')
        await jump('m95')
        expect(scrollIntoView.mock.instances).toContain(rowOf('m95'))
        expect(getMessage).not.toHaveBeenCalled()
        expect(loadStreamAround).not.toHaveBeenCalled()
    })

    it('a jump to a message that is gone toasts once and stops', async () => {
        getMessage.mockRejectedValueOnce(new Error('no such message'))
        const { rerender } = mount(streamOf(range(91, 100)))
        await screen.findByText('body 100')
        await jump('m-gone')
        expect(vi.mocked(toast)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(toast).mock.calls[0]?.[0]).toBe('That message is no longer here')
        expect(loadStreamAround).not.toHaveBeenCalled()
        // Nothing keeps trying as the window changes.
        rerender(streamOf(range(90, 100)))
        await act(async () => {})
        expect(getMessage).toHaveBeenCalledTimes(1)
    })
})
