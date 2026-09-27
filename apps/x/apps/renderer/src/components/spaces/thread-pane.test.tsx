import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import type { SpacePresence } from '@/hooks/use-space-chat'

// The pane's scroll contract, with everything around the list stubbed: it
// opens on the newest replies, stays pinned there while bodies keep
// growing, lets go once the reader scrolls up, and puts the spot back after
// a hide/show — and a jump to a reply the newest page lacks lands on it in
// a detached window (load-around). jsdom has no layout, so the list's
// geometry is faked.

vi.mock('@/components/spaces/composer', () => ({ Composer: () => null }))
vi.mock('@/components/spaces/message-row', () => ({
    MessageRow: ({ message, onCopyLink }: { message: spaces.Message; onCopyLink?: (message: spaces.Message) => void }) => (
        <div data-mid={message.id}>
            {message.body}
            {onCopyLink && <button onClick={() => onCopyLink(message)}>Copy link to {message.id}</button>}
        </div>
    ),
    NewDivider: () => null,
    TypingIndicator: () => null,
}))
vi.mock('@/components/spaces/artifacts', () => ({ ArtifactsSummary: () => null }))
vi.mock('@/components/spaces/atoms', () => ({
    MemberAvatar: () => <span />,
    MemberProfilePopover: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/spaces/member-text', () => ({
    MemberName: ({ id }: { id: string }) => <span>{id}</span>,
    MemberText: ({ text }: { text: string }) => <span>{text}</span>,
}))
vi.mock('@/components/spaces/space-markdown', () => ({ SpaceMarkdown: ({ body }: { body: string }) => <p>{body}</p> }))
vi.mock('@/components/spaces/poll-dialog', () => ({ PollDialogHost: () => null }))
vi.mock('@/components/spaces/forward-dialog', () => ({ ForwardDialog: () => null }))
vi.mock('@/components/spaces/attach-document-dialog', () => ({ AttachDocumentDialog: () => null }))
vi.mock('@/hooks/use-space-chat', () => ({
    buildPendingMessage: vi.fn(),
    getThreadSnapshot: () => null,
    ingestTopic: vi.fn(),
    putThreadSnapshot: vi.fn(),
    removeTopicByRoot: vi.fn(),
    updateStreamMessage: vi.fn(),
    usePresenceSender: () => ({ onType: vi.fn() }),
}))
vi.mock('@/hooks/use-topic-agent-permission', () => ({ useTopicAgentPermissionWait: () => [] }))
vi.mock('@/lib/spaces-agent-activity', () => ({ useSpaceAgentActivity: () => new Map() }))
vi.mock('@/lib/spaces-read-state', () => ({
    getThreadReadState: () => null,
    markThreadRead: vi.fn(),
    noteThread: vi.fn(),
    useReadStateVersion: () => 0,
}))
vi.mock('@/lib/spaces-saved', () => ({ toggleSaved: vi.fn(), useSaved: () => [] }))
vi.mock('@/lib/spaces-rowboat', () => ({ maybeInvokeRowboat: vi.fn() }))
vi.mock('@/lib/spaces-response-chat', () => ({ openResponseChat: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
vi.mock('@/lib/analytics', () => ({
    spacesInviteLinkCopied: vi.fn(),
    spacesMessagePosted: vi.fn(),
    spacesFoldRequested: vi.fn(),
    spacesReactionToggled: vi.fn(),
    spacesMessageDeleted: vi.fn(),
    spacesTopicStarted: vi.fn(),
}))

import { ThreadPane } from './thread-pane'
import { requestJump } from '@/lib/spaces-jump'
import { toast } from '@/lib/toast'

// scrollToMessage scrolls the row into view and flashes it — neither exists in jsdom.
const scrollIntoView = vi.fn()
Element.prototype.scrollIntoView = scrollIntoView
;(Element.prototype as unknown as { animate: unknown }).animate = vi.fn()

const message = (id: string, body: string, offset: number, threadRoot?: string) =>
    ({
        id, body, offset, spaceId: 'space', ...(threadRoot ? { threadRoot } : {}),
        author: { memberId: 'alex', actingMode: 'direct' }, postedAt: '2026-09-09T09:00:00Z', replyCount: 0,
    }) as spaces.Message

const root = message('root', 'the root', 1)
const replies = [message('r1', 'reply 1', 20, 'root'), message('r2', 'reply 2', 21, 'root')]
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
beforeEach(() => {
    resizeCallbacks.length = 0
    scrollIntoView.mockClear()
    vi.mocked(toast).mockClear()
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
                if (channel === 'spaces:listThread') return { root, topic: null, messages: replies, hasMore: false, following: false, readOffset: null }
                if (channel === 'spaces:topicSession') return { sessionId: null }
                return {}
            }),
        },
    })
})
afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
})

function mount(visible = true) {
    const props = {
        org, space, rootMessageId: 'root', rootFromStream: root, topicFromStream: undefined, changeSets: [], entries: [], presence,
        members: [], memberNames: new Map([['alex', 'Alex']]), refreshTick: 0, showBack: true, onBack: vi.fn(), onOpenFile: vi.fn(),
        artifactsRailOpen: false, onToggleArtifactsRail: vi.fn(),
    }
    const utils = render(<ThreadPane {...props} visible={visible} />)
    const list = document.querySelector<HTMLElement>('.spaces-message-list')!
    const box = { scrollHeight: 1000, clientHeight: 300 }
    fakeScrollBox(list, box)
    return {
        ...utils,
        list,
        box,
        rerender: (next: { visible?: boolean; refreshTick?: number }) =>
            utils.rerender(<ThreadPane {...props} visible={next.visible ?? visible} refreshTick={next.refreshTick ?? 0} />),
    }
}

/** The list grows (an image loaded, a code block highlighted) and the observer reports it. */
function grow(box: { scrollHeight: number }, by: number) {
    box.scrollHeight += by
    act(() => {
        for (const cb of resizeCallbacks) cb()
    })
}

it('wires a copy action for each reply that links to the reply, not its thread root', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    try {
        mount()
        fireEvent.click(await screen.findByRole('button', { name: 'Copy link to r2' }))
        await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://org.example/s/space/m/r2'))
        expect(toast).toHaveBeenCalledWith('Link copied', 'success')
    } finally {
        if (previous) Object.defineProperty(navigator, 'clipboard', previous)
        else Reflect.deleteProperty(navigator, 'clipboard')
    }
})

describe('ThreadPane scroll position', () => {
    it('opens on the newest replies and stays pinned there while the content keeps growing', async () => {
        const { list, box } = mount()
        await screen.findByText('reply 2')
        expect(list.scrollTop).toBe(700)
        grow(box, 400)
        expect(list.scrollTop).toBe(1100)
    })

    it('lets go once the reader scrolls up, and keeps their spot across a hide/show', async () => {
        const { list, box, rerender } = mount()
        await screen.findByText('reply 2')
        fireEvent.wheel(list)
        list.scrollTop = 120
        fireEvent.scroll(list)
        grow(box, 400)
        expect(list.scrollTop).toBe(120)
        // Hidden (display:none) drops the geometry; showing again puts it back.
        rerender({ visible: false })
        list.scrollTop = 0
        rerender({ visible: true })
        expect(list.scrollTop).toBe(120)
    })

    it('a scroll the reader did not make, while following, re-pins the bottom', async () => {
        const { list } = mount()
        await screen.findByText('reply 2')
        // Anchoring's compensation for a late layout: no wheel, no pointer.
        list.scrollTop = 400
        fireEvent.scroll(list)
        expect(list.scrollTop).toBe(700)
    })

    it('back from hidden while following lands on the bottom again', async () => {
        const { list, rerender } = mount()
        await screen.findByText('reply 2')
        rerender({ visible: false })
        list.scrollTop = 0
        rerender({ visible: true })
        expect(list.scrollTop).toBe(700)
    })
})

// The thread's log: the root, an OLD reply the newest page does not hold,
// then the newest page (r1, r2). A window "around" r0 is r0 alone with the
// newest page above it; paging forward from it reaches r1, r2.
const oldReply = message('r0', 'reply 0', 2, 'root')
type Page = { messages: spaces.Message[]; hasMore: boolean; hasMoreAfter?: boolean }
function threadOrg(opts: { getMessage?: () => Promise<{ message: spaces.Message }> } = {}) {
    const invoke = vi.fn(async (channel: string, args: { aroundOffset?: number; afterOffset?: number }) => {
        if (channel === 'spaces:getMessage') return (opts.getMessage ?? (async () => ({ message: oldReply })))()
        if (channel === 'spaces:listThread') {
            const page: Page =
                args.aroundOffset !== undefined
                    ? { messages: [oldReply], hasMore: false, hasMoreAfter: true }
                    : args.afterOffset !== undefined
                      ? { messages: replies, hasMore: false, hasMoreAfter: false }
                      : { messages: replies, hasMore: true }
            return { root, topic: null, ...page, following: false, readOffset: null }
        }
        if (channel === 'spaces:topicSession') return { sessionId: null }
        return {}
    })
    Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } })
    return { invoke, calls: (channel: string) => invoke.mock.calls.filter(([c]) => c === channel) }
}
const rowOf = (id: string) => document.querySelector<HTMLElement>(`[data-mid="${id}"]`)

describe('ThreadPane jump to a reply outside the window', () => {
    it('resolves the offset with one lookup, loads around it, lands on it, and pages forward from the bottom edge', async () => {
        const org = threadOrg()
        const { list, box } = mount()
        await screen.findByText('reply 2')
        await act(async () => {
            requestJump({ topicId: 'root', messageId: 'r0' })
        })
        await screen.findByText('reply 0')
        expect(org.calls('spaces:getMessage')).toHaveLength(1)
        expect(org.calls('spaces:listThread').at(-1)?.[1]).toMatchObject({ aroundOffset: 2 })
        // The window IS the around page — the newest replies are not in it.
        expect(screen.queryByText('reply 2')).toBeNull()
        expect(scrollIntoView.mock.instances).toContain(rowOf('r0'))
        expect(screen.getByText('Jump to latest')).toBeTruthy()
        // The bottom pin is off: growth leaves the landing spot alone.
        list.scrollTop = 100
        fireEvent.scroll(list)
        grow(box, 400)
        expect(list.scrollTop).toBe(100)
        // The bottom edge pages forward; the head re-attaches and the pill goes.
        list.scrollTop = box.scrollHeight - box.clientHeight
        fireEvent.scroll(list)
        await screen.findByText('reply 2')
        expect(org.calls('spaces:listThread').at(-1)?.[1]).toMatchObject({ afterOffset: 2 })
        expect(screen.getByText('reply 0')).toBeTruthy()
        expect(screen.queryByText('Jump to latest')).toBeNull()
    })

    it('uses the offset the producer passed; live replies count on the pill, which reloads the newest page', async () => {
        const org = threadOrg()
        const { rerender } = mount()
        await screen.findByText('reply 2')
        await act(async () => {
            requestJump({ topicId: 'root', messageId: 'r0', offset: 2 })
        })
        await screen.findByText('reply 0')
        expect(org.calls('spaces:getMessage')).toHaveLength(0)
        // A live event refetches the newest page: not merged into the detached window, counted.
        rerender({ refreshTick: 1 })
        await screen.findByText('Jump to latest · 2 new')
        expect(screen.queryByText('reply 2')).toBeNull()
        fireEvent.click(screen.getByText('Jump to latest · 2 new'))
        await screen.findByText('reply 2')
        expect(org.calls('spaces:listThread').at(-1)?.[1]).not.toHaveProperty('aroundOffset')
        expect(org.calls('spaces:listThread').at(-1)?.[1]).not.toHaveProperty('afterOffset')
        expect(screen.queryByText('reply 0')).toBeNull()
        expect(screen.queryByText('Jump to latest')).toBeNull()
    })

    it('a jump to a message that is gone toasts once and stops', async () => {
        const org = threadOrg({ getMessage: async () => { throw new Error('no such message') } })
        mount()
        await screen.findByText('reply 2')
        await act(async () => {
            requestJump({ topicId: 'root', messageId: 'r-gone' })
        })
        await act(async () => {})
        expect(vi.mocked(toast)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(toast).mock.calls[0]?.[0]).toBe('That message is no longer here')
        expect(org.calls('spaces:getMessage')).toHaveLength(1)
        // No around page was asked for, and nothing keeps trying.
        expect(org.calls('spaces:listThread').some(([, a]) => (a as { aroundOffset?: number }).aroundOffset !== undefined)).toBe(false)
        expect(screen.getByText('reply 2')).toBeTruthy()
    })
})
