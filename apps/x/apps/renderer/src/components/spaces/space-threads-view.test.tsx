import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import { SpaceThreadsView } from './space-threads-view'
import { refreshSpaceFeed } from '@/hooks/use-spaces'
import { updateStreamMessage } from '@/hooks/use-space-chat'
import { forgetOrg, loadUnread, markThreadRead, spaceBadge, threadsBadge } from '@/lib/spaces-read-state'
import { toast } from '@/lib/toast'
import { resetFallbackReplyAuthors } from '@/lib/spaces-thread-participants'

vi.mock('@/hooks/use-spaces', () => ({ refreshSpaceFeed: vi.fn(async () => {}) }))
vi.mock('@/hooks/use-space-chat', () => ({ prefetchThread: vi.fn(), updateStreamMessage: vi.fn() }))
vi.mock('@/lib/spaces-feed', () => ({ subscribeSpacesFeed: () => () => {} }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
// The view fetches the archived unnamed threads on mount; every other channel answers {} unless a test says otherwise.
let archivedThreads: spaces.Message[] = []
const defaultInvoke = async (channel: string): Promise<unknown> => channel === 'spaces:listArchivedThreads' ? { threads: archivedThreads } : {}
const invoke = vi.fn(defaultInvoke)
beforeEach(() => { Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } }) })
afterEach(() => { cleanup(); forgetOrg('org'); vi.clearAllMocks(); invoke.mockImplementation(defaultInvoke); archivedThreads = []; window.localStorage.clear(); resetFallbackReplyAuthors() })
const topics = [
    { id: 'live', rootMessageId: 'root-live', title: 'Launch', archived: false, lastActivityAt: '2026-09-15T10:00:00Z' },
    { id: 'archived', rootMessageId: 'root-archived', title: 'Old launch', archived: true, lastActivityAt: '2026-09-14T10:00:00Z' },
] as spaces.TopicListing[]
const root = (id: string, memberId: string, body: string, replyCount: number, lastReplyAt?: string, replyAuthors: string[] = []) =>
    ({ id, spaceId: 'dm', author: { memberId, actingMode: 'direct' }, body, postedAt: '2026-09-01T10:00:00Z', offset: 1, replyCount, lastReplyAt, replyAuthors, mentions: [], mentionsHere: false, mentionsRowboat: false, reactions: [] }) as spaces.Message
const roots = [
    root('root-mine', 'me', 'Fix the login bug\nmore detail', 4, '2026-09-16T10:00:00Z', ['me']),
    root('root-theirs', 'ana', 'Plan the release', 2, '2026-09-13T10:00:00Z', ['bo', 'me']),
    root('root-quiet', 'me', 'No replies here', 0),
    root('root-archived', 'me', 'Archived root', 1, '2026-09-14T10:00:00Z'),
]
function mount(onLoadOlder = vi.fn(), shown = roots, inline = false) {
    const onOpen = vi.fn()
    render(<SpaceThreadsView orgId="org" orgAddress="spaces.example.com" spaceId="dm" direct selfMemberId="me" topics={topics} roots={shown}
        hasMore loadingOlder={false} onLoadOlder={onLoadOlder} loaded memberNames={new Map([['me', 'Arjun'], ['ana', 'Ana'], ['bo', 'Bo']])} spaceNames={new Map()}
        presence={{ working: new Map(), typing: new Map(), here: [] }} inline={inline} onOpen={onOpen} />)
    return onOpen
}
function openOptions(name: string) {
    fireEvent.pointerDown(screen.getByRole('button', { name }), { button: 0, ctrlKey: false })
}
describe('threads view', () => {
    it('Sessions lists the roots marked as sessions, replies or not, by their title, and ends them', async () => {
        const session = { ...root('root-session', 'me', 'fix thread nav', 0), session: { title: 'fix thread nav' } }
        mount(vi.fn(), [...roots, session])
        // A session is a thread from its first message: All has it too.
        expect(screen.getByRole('button', { name: /^fix thread nav/ })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Sessions' }))
        expect(screen.getAllByRole('button', { name: / repl(y|ies)/ }).map((row) => row.textContent)).toEqual([expect.stringMatching(/^fix thread nav Arjun · 0 replies/)])
        invoke.mockImplementation(async (channel: string) => channel === 'spaces:archiveThread' ? { root: { ...session, archived: true } } : defaultInvoke(channel))
        openOptions('Options for fix thread nav')
        fireEvent.click(await screen.findByRole('menuitem', { name: 'End session' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:archiveThread', { orgId: 'org', spaceId: 'dm', rootMessageId: 'root-session', archived: true }))
    })
    it('lists every thread with replies, named or not, newest activity first', () => {
        const onOpen = mount()
        const rows = screen.getAllByRole('button', { name: / replies/ }).map((row) => row.textContent)
        expect(rows).toEqual([
            expect.stringMatching(/^Fix the login bug Arjun · 4 replies/),
            expect.stringMatching(/^Launch /),
            expect.stringMatching(/^Plan the release Ana · 2 replies/),
        ])
        fireEvent.click(screen.getByRole('button', { name: /^Fix the login bug/ }))
        expect(onOpen).toHaveBeenCalledWith('root-mine')
    })
    it('narrows to named threads and to threads the reader started', () => {
        mount()
        fireEvent.click(screen.getByRole('button', { name: 'Named' }))
        expect(screen.getAllByRole('button', { name: / replies/ })).toHaveLength(1)
        expect(screen.getByText('Launch', { exact: true })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'By me' }))
        expect(screen.getAllByRole('button', { name: / replies/ }).map((row) => row.textContent)).toEqual([expect.stringMatching(/^Fix the login bug/)])
    })
    it('remembers the primary and archive filters after remounting', () => {
        mount()
        fireEvent.click(screen.getByRole('button', { name: 'By me' }))
        cleanup()
        mount()
        expect(screen.getByRole('button', { name: 'By me' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.queryByText('Plan the release')).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Named' }))
        fireEvent.click(screen.getByRole('button', { name: /^Archived/ }))
        cleanup()
        mount()
        expect(screen.getByRole('button', { name: 'Named' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: /^Archived/ })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByText('Old launch')).toBeInTheDocument()
    })
    it('ignores invalid persisted filter values', () => {
        localStorage.setItem('spaces:threads-filter:org:dm', 'obsolete')
        mount()
        expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    })
    it('updates row and aggregate badges together when an unnamed thread is read', async () => {
        invoke.mockResolvedValueOnce({ spaces: [{ spaceId: 'dm', head: 20, readOffset: 20, unreadRoots: 0, unreadMentions: 1,
            threads: [{ rootMessageId: 'root-mine', readOffset: 1, lastReplyOffset: 20, unreadReplies: 3, unreadMentions: 1 }],
        }] })
        await loadUnread('org', 'me')
        mount()
        expect(screen.getByLabelText('3 unread · all for you')).toBeInTheDocument()
        expect(threadsBadge('org', 'dm', false)).toEqual({ unread: 3, forYou: 1 })
        expect(threadsBadge('org', 'dm', true)).toEqual(spaceBadge('org', 'dm', true))
        act(() => markThreadRead('org', 'dm', 'root-mine', 20, { sync: false }))
        expect(screen.queryByLabelText('3 unread · all for you')).not.toBeInTheDocument()
        expect(threadsBadge('org', 'dm', true)).toEqual({ unread: 0, forYou: 0 })
        expect(spaceBadge('org', 'dm', true)).toEqual({ unread: 0, forYou: 0 })
    })
    it('shows each thread\'s participants, root author first', () => {
        mount()
        const row = screen.getByRole('button', { name: /^Plan the release/ })
        expect(row.querySelector('[title="Ana, Bo, Arjun"]')).not.toBeNull()
    })
    it('reads the repliers from the thread when Harbor sends no reply authors', async () => {
        const reply = (memberId: string) => ({ ...root(`r-${memberId}`, memberId, 'reply', 0), threadRoot: 'root-old' })
        invoke.mockImplementation((async (channel: string) => channel === 'spaces:listArchivedThreads' ? { threads: [] } : ({ root: roots[0], topic: null, messages: [reply('bo'), reply('me'), reply('bo')], hasMore: false })) as never)
        mount(vi.fn(), [root('root-old', 'ana', 'From an older Harbor', 3, '2026-09-16T10:00:00Z')])
        const row = screen.getByRole('button', { name: /^From an older Harbor/ })
        await waitFor(() => expect(row.querySelector('[title="Ana, Bo, Arjun"]')).not.toBeNull())
        expect(invoke).toHaveBeenCalledWith('spaces:listThread', { orgId: 'org', spaceId: 'dm', rootMessageId: 'root-old', afterOffset: 1, limit: 200 })
        expect(invoke.mock.calls.filter(([channel]) => channel === 'spaces:listThread')).toHaveLength(1)
    })
    it('filters by several participants and keeps the choice after leaving and coming back', () => {
        mount()
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Filter by participant' }), { button: 0, ctrlKey: false })
        expect(screen.getAllByRole('menuitemcheckbox').map((item) => item.textContent)).toEqual(['Everyone', 'ANAna', 'ARArjun', 'BOBo'])
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Bo$/ }))
        expect(screen.getAllByRole('button', { name: / replies/, hidden: true }).map((row) => row.textContent)).toEqual([expect.stringMatching(/^Plan the release/)])
        // The menu stays open for a second pick; a thread shows when any chosen person is in it.
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Arjun$/ }))
        expect(screen.getByRole('menuitemcheckbox', { name: /Bo$/ })).toHaveAttribute('aria-checked', 'true')
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
        expect(screen.getAllByRole('button', { name: / replies/ })).toHaveLength(2)
        expect(window.localStorage.getItem('spaces:threads-participant:org:dm')).toBe('bo,me')
        cleanup()
        mount()
        expect(screen.getByRole('button', { name: 'Participants: Bo or Arjun' })).toBeInTheDocument()
        expect(screen.getAllByRole('button', { name: / replies/ })).toHaveLength(2)
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Participants: Bo or Arjun' }), { button: 0, ctrlKey: false })
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Bo$/ }))
        expect(screen.getByRole('button', { name: 'Participants: Arjun', hidden: true })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Everyone' }))
        expect(screen.getAllByRole('button', { name: / replies/ })).toHaveLength(3)
        expect(window.localStorage.getItem('spaces:threads-participant:org:dm')).toBeNull()
    })
    it('reads back a single participant saved before the filter took several', () => {
        window.localStorage.setItem('spaces:threads-participant:org:dm', 'bo')
        mount()
        expect(screen.getByRole('button', { name: 'Participants: Bo' })).toHaveTextContent('Bo')
        expect(screen.getAllByRole('button', { name: / replies/ })).toHaveLength(1)
    })
    it('in an inline space a row still opens, as a conversation (2026-10-25)', () => {
        const onOpen = mount(vi.fn(), roots, true)
        fireEvent.click(screen.getByRole('button', { name: /^Fix the login bug/ }))
        expect(onOpen).toHaveBeenCalledWith('root-mine')
        fireEvent.contextMenu(screen.getByRole('button', { name: /^Fix the login bug/ }))
        expect(screen.getByRole('menuitem', { name: 'Open conversation' })).toBeInTheDocument()
    })
    it('pages older threads from the stream', () => {
        const onLoadOlder = vi.fn()
        mount(onLoadOlder)
        fireEvent.click(screen.getByRole('button', { name: 'Load older threads' }))
        expect(onLoadOlder).toHaveBeenCalledOnce()
    })

    it('separates active and archived discussions while preserving their destinations', () => {
        const onOpen = mount()
        fireEvent.click(screen.getByRole('button', { name: 'Named' }))
        expect(screen.queryByText('Old launch')).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /^Launch 0 replies/ }))
        expect(onOpen).toHaveBeenCalledWith('root-live')
        fireEvent.click(screen.getByRole('button', { name: /^Archived/ }))
        expect(screen.queryByText('Launch', { exact: true })).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /^Old launch 0 replies/ }))
        expect(onOpen).toHaveBeenLastCalledWith('root-archived')
    })
    it('keeps the existing archive action scoped to the selected DM topic', async () => {
        mount()
        openOptions('Options for Launch')
        fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:manageTopic', { orgId: 'org', spaceId: 'dm', topicId: 'live', action: { action: 'archive' } }))
        await waitFor(() => expect(refreshSpaceFeed).toHaveBeenCalledWith('org', 'dm'))
    })
    it('reports a failed lifecycle action instead of hiding the discussion', async () => {
        invoke.mockImplementation((async (channel: string) => {
            if (channel === 'spaces:manageTopic') throw new Error('Could not reach server')
            return defaultInvoke(channel)
        }) as never)
        mount()
        openOptions('Options for Launch')
        fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }))
        await waitFor(() => expect(toast).toHaveBeenCalledWith('Could not reach server', 'error'))
        expect(screen.getByText('Launch', { exact: true })).toBeInTheDocument()
        expect(refreshSpaceFeed).not.toHaveBeenCalled()
    })
    it('archives an unnamed thread without naming it', async () => {
        invoke.mockImplementation((async (channel: string) => channel === 'spaces:archiveThread'
            ? { root: { ...roots[0], archived: true } }
            : defaultInvoke(channel)) as never)
        mount()
        openOptions('Options for Fix the login bug')
        fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:archiveThread', { orgId: 'org', spaceId: 'dm', rootMessageId: 'root-mine', archived: true }))
        expect(invoke).not.toHaveBeenCalledWith('spaces:createTopic', expect.anything())
        await waitFor(() => expect(updateStreamMessage).toHaveBeenCalledWith('org', 'dm', expect.objectContaining({ id: 'root-mine', archived: true })))
    })
    it('lists archived unnamed threads beside archived discussions, and leaves them out of All', async () => {
        archivedThreads = [{ ...root('root-old', 'me', 'Old coding session', 3, '2026-09-17T10:00:00Z'), archived: true }]
        mount(vi.fn(), [...roots, { ...root('root-done', 'ana', 'Done session', 2, '2026-09-18T10:00:00Z'), archived: true }])
        expect(screen.queryByText('Done session')).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /^Archived/ }))
        await waitFor(() => expect(screen.getAllByRole('button', { name: / replies/ }).map((row) => row.textContent)).toEqual([
            expect.stringMatching(/^Done session/),
            expect.stringMatching(/^Old coding session/),
            expect.stringMatching(/^Old launch/),
        ]))
        expect(screen.queryByRole('button', { name: 'Load older threads' })).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'By me' }))
        expect(screen.getAllByRole('button', { name: / replies/ }).map((row) => row.textContent)).toEqual([expect.stringMatching(/^Old coding session/)])
    })
})
