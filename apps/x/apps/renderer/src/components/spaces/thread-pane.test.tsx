import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import type { SpacePresence } from '@/hooks/use-space-chat'

// The pane's scroll contract, with everything around the list stubbed: it
// opens on the newest replies, stays pinned there while bodies keep
// growing, lets go once the reader scrolls up, and puts the spot back after
// a hide/show. jsdom has no layout, so the list's geometry is faked.

vi.mock('@/components/spaces/composer', () => ({ Composer: () => null }))
vi.mock('@/components/spaces/message-row', () => ({
    MessageRow: ({ message }: { message: { id: string; body: string } }) => <div data-mid={message.id}>{message.body}</div>,
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
    spacesMessagePosted: vi.fn(),
    spacesFoldRequested: vi.fn(),
    spacesReactionToggled: vi.fn(),
    spacesMessageDeleted: vi.fn(),
    spacesTopicStarted: vi.fn(),
}))

import { ThreadPane } from './thread-pane'

const message = (id: string, body: string, offset: number, threadRoot?: string) =>
    ({
        id, body, offset, spaceId: 'space', ...(threadRoot ? { threadRoot } : {}),
        author: { memberId: 'alex', actingMode: 'direct' }, postedAt: '2026-09-09T09:00:00Z', replyCount: 0,
    }) as spaces.Message

const root = message('root', 'the root', 1)
const replies = [message('r1', 'reply 1', 2, 'root'), message('r2', 'reply 2', 3, 'root')]
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
    return { ...utils, list, box, rerender: (next: { visible: boolean }) => utils.rerender(<ThreadPane {...props} visible={next.visible} />) }
}

/** The list grows (an image loaded, a code block highlighted) and the observer reports it. */
function grow(box: { scrollHeight: number }, by: number) {
    box.scrollHeight += by
    act(() => {
        for (const cb of resizeCallbacks) cb()
    })
}

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
