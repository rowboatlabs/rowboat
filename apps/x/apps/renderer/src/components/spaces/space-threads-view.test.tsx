import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import { SpaceThreadsView } from './space-threads-view'
import { refreshSpaceFeed } from '@/hooks/use-spaces'
import { toast } from '@/lib/toast'

vi.mock('@/hooks/use-spaces', () => ({ refreshSpaceFeed: vi.fn(async () => {}) }))
vi.mock('@/hooks/use-space-chat', () => ({ prefetchThread: vi.fn() }))
vi.mock('@/lib/spaces-read-state', () => ({ useReadStateVersion: () => 0, threadBadge: () => ({ unread: 0, forYou: 0 }) }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
const invoke = vi.fn(async () => ({}))
beforeEach(() => { Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })
const topics = [
    { id: 'live', rootMessageId: 'root-live', title: 'Launch', archived: false, lastActivityAt: '2026-09-15T10:00:00Z' },
    { id: 'archived', rootMessageId: 'root-archived', title: 'Old launch', archived: true, lastActivityAt: '2026-09-14T10:00:00Z' },
] as spaces.TopicListing[]
const root = (id: string, memberId: string, body: string, replyCount: number, lastReplyAt?: string) =>
    ({ id, spaceId: 'dm', author: { memberId, actingMode: 'direct' }, body, postedAt: '2026-09-01T10:00:00Z', offset: 1, replyCount, lastReplyAt, mentions: [], mentionsHere: false, mentionsRowboat: false, reactions: [] }) as spaces.Message
const roots = [
    root('root-mine', 'me', 'Fix the login bug\nmore detail', 4, '2026-09-16T10:00:00Z'),
    root('root-theirs', 'ana', 'Plan the release', 2, '2026-09-13T10:00:00Z'),
    root('root-quiet', 'me', 'No replies here', 0),
    root('root-archived', 'me', 'Archived root', 1, '2026-09-14T10:00:00Z'),
]
function mount(onLoadOlder = vi.fn()) {
    const onOpen = vi.fn()
    render(<SpaceThreadsView orgId="org" orgAddress="spaces.example.com" spaceId="dm" direct selfMemberId="me" topics={topics} roots={roots}
        hasMore loadingOlder={false} onLoadOlder={onLoadOlder} loaded memberNames={new Map([['me', 'Arjun'], ['ana', 'Ana']])} spaceNames={new Map()}
        presence={{ working: new Map(), typing: new Map(), here: [] }} onOpen={onOpen} />)
    return onOpen
}
function openOptions(name: string) {
    fireEvent.pointerDown(screen.getByRole('button', { name }), { button: 0, ctrlKey: false })
}
describe('threads view', () => {
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
        expect(screen.queryByRole('button', { name: /^Archived/ })).not.toBeInTheDocument()
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
        invoke.mockRejectedValueOnce(new Error('Could not reach server'))
        mount()
        openOptions('Options for Launch')
        fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }))
        await waitFor(() => expect(toast).toHaveBeenCalledWith('Could not reach server', 'error'))
        expect(screen.getByText('Launch', { exact: true })).toBeInTheDocument()
        expect(refreshSpaceFeed).not.toHaveBeenCalled()
    })
})
