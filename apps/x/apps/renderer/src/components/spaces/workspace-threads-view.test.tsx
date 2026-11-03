import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { WorkspaceThreadsView } from './workspace-threads-view'
import { resetWorkspaceThreadsCache } from '@/hooks/use-workspace-threads'

vi.mock('@/components/spaces/workspace-thread-pane', () => ({ WorkspaceThreadPane: ({ space, rootId, onClose }: { space: spaces.Space; rootId: string; onClose: () => void }) =>
    <div data-testid="pane">{space.id}/{rootId}<button onClick={onClose}>Close thread</button></div>,
}))
vi.mock('@/components/spaces/atoms', () => ({ MemberAvatar: () => null }))
vi.mock('@/hooks/use-spaces', () => ({ useSpaceNames: () => new Map([['channel', 'Main']]) }))
vi.mock('@/hooks/use-space-chat', () => ({ prefetchThread: vi.fn() }))
vi.mock('@/lib/spaces-read-state', () => ({ useReadStateVersion: () => 0, threadBadge: (_org: string, _space: string, root: string, direct: boolean) => ({ unread: root === 'dm-root' ? 2 : 0, forYou: direct ? 2 : 0 }) }))
const bus = vi.hoisted(() => ({ listener: null as null | ((event: unknown) => void) }))
vi.mock('@/lib/spaces-feed', () => ({ subscribeSpacesFeed: (fn: (event: unknown) => void) => { bus.listener = fn; return () => { bus.listener = null } } }))
const channel = { id: 'channel', name: 'Main', kind: 'shared' } as spaces.Space
const dm = { id: 'dm', name: '', kind: 'direct', participants: ['me', 'other'] } as spaces.Space
const org = { id: 'org', memberId: 'me', address: 'org.test', name: 'Org', spaces: [channel], directs: [dm], directLabels: { dm: 'Other' } } as unknown as OrgWithSpaces
const item = (space: spaces.Space, id: string, body: string) => ({ space, root: { id, spaceId: space.id, body, author: { memberId: 'me' }, postedAt: '2026-11-03T00:00:00Z', replyCount: 2, replyAuthors: ['other'] }, topic: null, lastActivityAt: '2026-11-03T00:00:00Z' }) as spaces.WorkspaceThread
const rows = [item(channel, 'channel-root', 'Channel conversation'), item(dm, 'dm-root', 'DM conversation')]
const page = (items = rows, nextCursor?: string): spaces.ThreadsPage => ({ items, names: { me: 'Me', other: 'Other' }, ...(nextCursor ? { nextCursor } : {}) })
const invoke = vi.fn()
const onOpenSpace = vi.fn()
let width = 1200
function App({ currentOrg = org }: { currentOrg?: OrgWithSpaces }) {
    const [selected, setSelected] = useState<{ spaceId: string; rootId: string } | null>(null)
    return <WorkspaceThreadsView org={currentOrg} selectedSpaceId={selected?.spaceId} selectedRootId={selected?.rootId}
        onOpenThread={(spaceId, rootId) => setSelected({ spaceId, rootId })} onCloseThread={() => setSelected(null)} onOpenSpace={onOpenSpace} />
}
beforeEach(() => {
    width = 1200
    invoke.mockReset().mockResolvedValue(page())
    vi.stubGlobal('ipc', { invoke })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500)
    vi.stubGlobal('ResizeObserver', class {
        callback: () => void
        constructor(callback: () => void) { this.callback = callback }
        observe() { this.callback() }
        disconnect() {}
    })
})
afterEach(() => { cleanup(); localStorage.clear(); resetWorkspaceThreadsCache(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks() })
const row = (name: string) => screen.findByRole('button', { name: new RegExp(`^${name}`) })

describe('workspace Threads', () => {
    it('shows channel and DM sources, and keeps the list while switching the pane between them', async () => {
        render(<App />)
        const first = await row('Channel conversation')
        expect(first).toHaveTextContent('#Main')
        expect(await row('DM conversation')).toHaveTextContent('Other')
        expect(screen.getByLabelText('2 unread · all for you')).toBeInTheDocument()
        const list = screen.getByRole('region', { name: 'Threads' })
        fireEvent.scroll(list, { target: { scrollTop: 260 } })
        fireEvent.click(first)
        expect(screen.getByTestId('pane')).toHaveTextContent('channel/channel-root')
        fireEvent.click(await row('DM conversation'))
        expect(screen.getByTestId('pane')).toHaveTextContent('dm/dm-root')
        expect(list.closest('.hidden')).toBeNull()
        expect(list.scrollTop).toBe(260)
        fireEvent.click(screen.getByRole('button', { name: 'Close thread' }))
        expect(screen.queryByTestId('pane')).not.toBeInTheDocument()
        expect(list.scrollTop).toBe(260)
    })
    it('restores source, author, participant and scroll choices after leaving', async () => {
        render(<App />)
        await row('Channel conversation')
        fireEvent.click(screen.getByRole('button', { name: 'By me' }))
        fireEvent.change(screen.getByLabelText('Filter by channel or DM'), { target: { value: 'dm' } })
        await row('DM conversation')
        fireEvent.change(screen.getByLabelText('Filter by participant'), { target: { value: 'other' } })
        await waitFor(() => expect(invoke).toHaveBeenLastCalledWith('spaces:listThreads', expect.objectContaining({ filter: 'mine', spaceId: 'dm', participantId: 'other' })))
        await row('DM conversation')
        fireEvent.scroll(screen.getByRole('region', { name: 'Threads' }), { target: { scrollTop: 240 } })
        cleanup()
        render(<App />)
        expect(screen.getByRole('button', { name: 'By me' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByLabelText('Filter by channel or DM')).toHaveValue('dm')
        expect(screen.getByLabelText('Filter by participant')).toHaveValue('other')
        expect(screen.getByRole('region', { name: 'Threads' }).scrollTop).toBe(240)
    })
    it('returns from a narrow pane to the same list', async () => {
        width = 600
        render(<App />)
        fireEvent.click(await row('DM conversation'))
        const list = screen.getByRole('region', { name: 'Threads' })
        expect(list.closest('.hidden')).not.toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Close thread' }))
        expect(list.closest('.hidden')).toBeNull()
    })
    it('pages globally and ignores an older request after changing filters', async () => {
        let finish: (value: spaces.ThreadsPage) => void = () => {}
        invoke.mockImplementationOnce(() => new Promise<spaces.ThreadsPage>((resolve) => { finish = resolve }))
        render(<App />)
        invoke.mockResolvedValue(page([rows[1]!]))
        fireEvent.click(screen.getByRole('button', { name: 'Named' }))
        await row('DM conversation')
        await act(async () => { finish(page([rows[0]!])) })
        expect(screen.queryByRole('button', { name: /^Channel conversation/ })).not.toBeInTheDocument()
        cleanup(); resetWorkspaceThreadsCache(); localStorage.clear()
        invoke.mockReset().mockResolvedValueOnce(page([rows[0]!], 'older')).mockResolvedValueOnce(page([rows[1]!]))
        render(<App />)
        await row('Channel conversation')
        fireEvent.click(screen.getByRole('button', { name: 'Load older threads' }))
        await row('DM conversation')
        expect(await row('Channel conversation')).toBeInTheDocument()
        expect(invoke).toHaveBeenLastCalledWith('spaces:listThreads', expect.objectContaining({ cursor: 'older' }))
    })
    it('removes cached rows and closes access to a pane when membership disappears', async () => {
        const { rerender } = render(<App />)
        fireEvent.click(await row('DM conversation'))
        rerender(<App currentOrg={{ ...org, directs: [] }} />)
        expect(screen.queryByRole('button', { name: /^DM conversation/ })).not.toBeInTheDocument()
        expect(screen.queryByTestId('pane')).not.toBeInTheDocument()
        expect(screen.getByRole('alert')).toHaveTextContent('no longer available')
    })
    it('offers retry when the workspace query fails', async () => {
        invoke.mockRejectedValueOnce(new Error('Server unreachable'))
        render(<App />)
        expect(await screen.findByRole('alert')).toHaveTextContent('Server unreachable')
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
        expect(await row('Channel conversation')).toBeInTheDocument()
    })
    it('refreshes on live activity in another source without dropping loaded pages', async () => {
        invoke.mockReset().mockResolvedValueOnce(page([rows[0]!], 'older')).mockResolvedValueOnce(page([rows[1]!]))
        render(<App />)
        await row('Channel conversation')
        fireEvent.click(screen.getByRole('button', { name: 'Load older threads' }))
        await row('DM conversation')
        invoke.mockResolvedValueOnce(page([rows[1]!], 'older')).mockResolvedValueOnce(page([rows[0]!]))
        act(() => { bus.listener?.({ orgId: 'org', frame: { kind: 'event', spaceId: 'dm' } }) })
        await waitFor(() => expect(invoke).toHaveBeenCalledTimes(4), { timeout: 3000 })
        expect(await row('Channel conversation')).toBeInTheDocument()
        expect(await row('DM conversation')).toBeInTheDocument()
    })
})
