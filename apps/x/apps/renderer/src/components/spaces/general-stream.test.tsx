import { SpaceAccessContext } from '@/lib/spaces-access'
import { markStreamRead, markThreadRead } from '@/lib/spaces-read-state'
import { postInlineReply, postStreamMessage } from '@/lib/spaces-post'
import { setStreamView } from '@/lib/spaces-stream-view'
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

vi.mock('@/components/spaces/composer', () => ({ Composer: ({ onSend }: { onSend: (body: string) => void }) => <button onClick={() => onSend('on it')}>Send</button> }))
vi.mock('@/lib/spaces-post', () => ({ agentOptionsPayload: () => ({}), postStreamMessage: vi.fn(), postInlineReply: vi.fn() }))
vi.mock('@/components/spaces/message-row', () => ({
    DayDivider: () => null,
    MessageRow: ({ message, arriving, threadOpen, thread, inline, inThread, continuation, onReplyInThread }: {
        message: { id: string; body: string }; arriving?: boolean; threadOpen?: boolean; thread?: unknown; inline?: boolean
        inThread?: { author?: string; label: string; onClick: () => void } | null; continuation?: boolean
        onReplyInThread?: (message: { id: string; body: string }) => void
    }) => (
        <div data-mid={message.id} data-arriving={arriving || undefined} data-thread-open={threadOpen || undefined}
            data-thread={thread ? 'yes' : undefined} data-inline={inline || undefined}
            data-in-thread={inThread ? [inThread.author, inThread.label].filter(Boolean).join(': ') : undefined} data-continuation={continuation || undefined}>
            {message.body}
            {onReplyInThread && <button aria-label={`Reply to ${message.id}`} onClick={() => onReplyInThread(message)} />}
            {inThread && <button aria-label={`Quote on ${message.id}`} onClick={inThread.onClick} />}
        </div>
    ),
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
    messages, topicsByRoot: new Map(), threadRoots: new Map(), events: [], hasMore: false, loadingOlder: false, hasMoreAfter: false, newerSince: 0, ready: true, ...patch,
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
    setStreamView('org', 'space', 'threads')
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


it('renders preview content and an explicit Join action without marking it read', () => {
    vi.mocked(markStreamRead).mockClear()
    const join = vi.fn()
    render(<SpaceAccessContext.Provider value={{ member: false, writable: false, archived: false, join, joining: false }}>
        <GeneralStream org={org} space={space} stream={streamOf([msg(1)])} presence={presence} memberNames={new Map()}
            onOpenThread={vi.fn()} />
    </SpaceAccessContext.Provider>)
    expect(screen.getByText('body 1')).toBeInTheDocument()
    expect(vi.mocked(markStreamRead)).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Join space' }))
    expect(join).toHaveBeenCalledTimes(1)
})

describe('GeneralStream join lines (2026-09-29)', () => {
    const names = new Map([['alex', 'Alex'], ['sam', 'Sam'], ['kim', 'Kim']])
    const joined = (offset: number, memberId: string, by?: string): spaces.StreamEvent => ({
        offset,
        at: '2026-09-14T09:00:00Z',
        event: {
            type: 'membership',
            action: 'joined',
            membership: { spaceId: 'space', memberId, joinedAt: '2026-09-14T09:00:00Z' },
            ...(by ? { by: { memberId: by, actingMode: 'direct' as const } } : {}),
        },
    })
    const show = (stream: StreamState, where: spaces.Space = space) =>
        render(<GeneralStream org={org} space={where} stream={stream} presence={presence} memberNames={names} onOpenThread={vi.fn()} />)
    const drawn = () => [...document.querySelectorAll('[data-mid], .spaces-membership-line')].map((el) => el.textContent)

    it('draws each line before the first message after it, and the newest after the last', async () => {
        show(streamOf([msg(2), msg(5)], { events: [joined(1, 'alex'), joined(3, 'sam', 'alex'), joined(7, 'kim')] }))
        await screen.findByText('body 5')
        expect(drawn()).toEqual(['Alex joined', 'body 2', 'Alex added Sam', 'body 5', 'Kim joined'])
    })

    it('keeps the empty-space copy when only lines exist, and draws none in a DM', async () => {
        show(streamOf([], { events: [joined(1, 'alex')] }))
        expect(screen.getByText(/Nothing here yet/)).toBeTruthy()
        expect(drawn()).toEqual(['Alex joined'])
        cleanup()
        show(streamOf([msg(2)], { events: [joined(1, 'alex')] }), { ...space, kind: 'direct', participants: ['me', 'alex'] } as spaces.Space)
        await screen.findByText('body 2')
        expect(drawn()).toEqual(['body 2'])
    })
})

describe('GeneralStream live arrivals (spaces redesign 2026-10-21)', () => {
    const arriving = () => [...document.querySelectorAll('[data-arriving]')].map((el) => el.getAttribute('data-mid'))

    it('rises in only rows that land live at the tail — not the first paint, an older page, or a catch-up burst', async () => {
        const { rerender } = mount(streamOf(range(10, 12)))
        await screen.findByText('body 12')
        expect(arriving()).toEqual([])
        rerender(streamOf(range(10, 13)))
        expect(arriving()).toEqual(['m13'])
        // An older page prepends below the newest offset seen: no entrance.
        rerender(streamOf(range(5, 13)))
        expect(arriving()).toEqual(['m13'])
        // A burst bigger than live traffic is a resync.
        rerender(streamOf(range(5, 20)))
        expect(arriving()).toEqual(['m13'])
    })

    it('skips the confirm of the viewer\'s own send (its pending echo already rose in)', async () => {
        const { rerender } = mount(streamOf(range(1, 2)))
        await screen.findByText('body 2')
        const pending = { ...msg(999), id: 'pending-1', author: { memberId: 'me', actingMode: 'direct' }, pending: true } as spaces.Message
        rerender(streamOf([...range(1, 2), pending]))
        expect(arriving()).toEqual(['pending-1'])
        const confirmed = { ...msg(3), author: { memberId: 'me', actingMode: 'direct' } } as spaces.Message
        rerender(streamOf([...range(1, 2), confirmed]))
        expect(arriving()).toEqual([])
    })

    it('marks the root whose thread is open', async () => {
        render(<GeneralStream org={org} space={space} stream={streamOf([{ ...msg(1), replyCount: 2 } as spaces.Message, msg(2)])} presence={presence}
            memberNames={new Map()} onOpenThread={vi.fn()} openThreadId="m1" />)
        await screen.findByText('body 2')
        expect([...document.querySelectorAll('[data-thread-open]')].map((el) => el.getAttribute('data-mid'))).toEqual(['m1'])
    })
})

describe('inline view (2026-10-25)', () => {
    const root = { ...msg(1), id: 'root', body: 'Fix the login bug\nmore', replyCount: 2 } as spaces.Message
    const reply = (offset: number, rootId: string, author = 'alex') =>
        ({ ...msg(offset), id: `r${offset}`, threadRoot: rootId, author: { memberId: author, actingMode: 'direct' } }) as spaces.Message
    const renderInline = (messages: spaces.Message[], patch: Partial<StreamState> = {}, onOpenThread = vi.fn()) =>
        render(<SpaceAccessContext.Provider value={{ member: true, writable: true, join: () => {}, joining: false } as never}>
            <GeneralStream org={org} space={space} stream={streamOf(messages, patch)} presence={presence} memberNames={new Map()} onOpenThread={onOpenThread} />
        </SpaceAccessContext.Provider>)

    beforeEach(() => {
        setStreamView('org', 'space', 'inline')
        vi.mocked(markThreadRead).mockClear()
        vi.mocked(postInlineReply).mockClear()
        vi.mocked(postStreamMessage).mockClear()
    })

    it('quotes what each reply answers, shows no thread chips, and starts a new run when the thread changes', async () => {
        const old = { ...msg(2), id: 'old', body: 'unused' } as spaces.Message
        renderInline([root, msg(3), reply(4, 'root'), reply(5, 'root'), reply(6, 'old-root')], { threadRoots: new Map([['old-root', { ...old, id: 'old-root', body: 'Release notes' }]]) })
        await screen.findByText('body 6')
        const attr = (id: string, name: string) => document.querySelector(`[data-mid="${id}"]`)?.getAttribute(name)
        expect([attr('m3', 'data-in-thread'), attr('r4', 'data-in-thread'), attr('r6', 'data-in-thread')]).toEqual([null, 'Fix the login bug', 'Release notes'])
        // The root has two replies, but inline there is no thread to open: no chip, and Reply is plain Reply.
        expect(attr('root', 'data-thread')).toBeNull()
        expect(attr('root', 'data-inline')).toBe('true')
        // Same author, same thread, a minute apart: one run, its line drawn once.
        expect(attr('r5', 'data-continuation')).toBe('true')
        expect(attr('r5', 'data-in-thread')).toBeNull()
        expect(attr('r6', 'data-continuation')).toBeNull()
    })

    it('reads each thread up to its newest reply on screen', async () => {
        renderInline([root, reply(4, 'root'), reply(5, 'root'), reply(6, 'other')])
        await screen.findByText('body 6')
        expect(vi.mocked(markThreadRead).mock.calls.map((c) => [c[2], c[3]]).sort()).toEqual([['other', 6], ['root', 5]])
    })

    it('replies under a "Replying in" line instead of opening the thread, and Cancel drops it', async () => {
        const onOpenThread = vi.fn()
        renderInline([root, reply(4, 'root')], {}, onOpenThread)
        fireEvent.click(await screen.findByRole('button', { name: 'Reply to r4' }))
        expect(onOpenThread).not.toHaveBeenCalled()
        expect(screen.getByText(/Replying to/)).toHaveTextContent('Replying to Fix the login bug')
        fireEvent.click(screen.getByRole('button', { name: 'Send' }))
        await vi.waitFor(() => expect(postInlineReply).toHaveBeenCalledTimes(1))
        expect(vi.mocked(postInlineReply).mock.calls[0]![2]).toEqual({ rootMessageId: 'root', label: 'Fix the login bug' })
        expect(screen.queryByText(/Replying to/)).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Reply to root' }))
        fireEvent.click(screen.getByRole('button', { name: 'Cancel reply' }))
        fireEvent.click(screen.getByRole('button', { name: 'Send' }))
        await vi.waitFor(() => expect(postStreamMessage).toHaveBeenCalledTimes(1))
        expect(postInlineReply).toHaveBeenCalledTimes(1)
    })

    it('clicking a quote lands on the message it answers, in the stream', async () => {
        const onOpenThread = vi.fn()
        renderInline([root, msg(3), reply(4, 'root')], {}, onOpenThread)
        fireEvent.click(await screen.findByRole('button', { name: 'Quote on r4' }))
        await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
        expect(onOpenThread).not.toHaveBeenCalled()
        expect(loadStreamAround).not.toHaveBeenCalled()
    })

    it('with replies in threads, the chips stay and Reply opens the thread', async () => {
        setStreamView('org', 'space', 'threads')
        const onOpenThread = vi.fn()
        renderInline([root], {}, onOpenThread)
        fireEvent.click(await screen.findByRole('button', { name: 'Reply to root' }))
        expect(onOpenThread).toHaveBeenCalledWith('root')
        expect(document.querySelector('[data-mid="root"]')?.getAttribute('data-thread')).toBe('yes')
        expect(screen.queryByText(/Replying to/)).not.toBeInTheDocument()
    })

    it('another space\'s choice does not reach this one', async () => {
        setStreamView('org', 'space', 'threads')
        setStreamView('org', 'elsewhere', 'inline')
        renderInline([root, reply(4, 'root')])
        await screen.findByText('body 4')
        expect(document.querySelector('[data-mid="root"]')?.getAttribute('data-thread')).toBe('yes')
        setStreamView('org', 'elsewhere', 'threads')
    })
})

