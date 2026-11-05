import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { MyThreadsView } from './my-threads-view'

// Your threads across the server (2026-11-05): All / Sessions / Named over
// Harbor's list, Archived fetched when shown, End session on a session's menu.

const listing = (id: string, opts: { session?: string; topic?: string; status?: spaces.ThreadStatus; space?: string; unread?: number } = {}): spaces.ThreadListing => ({
    spaceId: opts.space === 'Design' ? 'design' : 'main',
    spaceName: opts.space ?? 'Main',
    spaceKind: 'shared',
    root: {
        id, spaceId: 'main', author: { memberId: 'me', actingMode: 'direct' }, body: `${id} body`, postedAt: '2026-11-05T10:00:00Z', offset: 1,
        replyCount: 2, replyAuthors: [], reactions: [], mentions: [], mentionsHere: false, mentionsRowboat: false,
        ...(opts.session ? { session: { title: opts.session } } : {}),
    } as spaces.Message,
    ...(opts.topic ? { topic: { id: `t-${id}`, spaceId: 'main', rootMessageId: id, title: opts.topic, archived: false } as spaces.Topic } : {}),
    status: opts.status ?? 'idle',
    unreadReplies: opts.unread ?? 0,
    unreadMentions: 0,
    lastActivityAt: '2026-11-05T10:00:00Z',
})

let live: spaces.ThreadListing[] = []
vi.mock('@/lib/spaces-my-threads', async (orig) => ({
    ...(await orig<typeof import('@/lib/spaces-my-threads')>()),
    useMyThreads: () => ({ threads: live, loaded: true }),
    refreshMyThreads: vi.fn(async () => {}),
}))
vi.mock('@/hooks/use-spaces', () => ({ useSpaceNames: () => new Map() }))
vi.mock('@/hooks/use-space-members', () => ({ useOrgRoster: () => [{ id: 'me', displayName: 'Arjun' }] }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

const invoke = vi.fn(async (channel: string): Promise<unknown> => channel === 'spaces:myThreads' ? { threads: [listing('old', { session: 'old work' })] } : {})
beforeEach(() => { Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } }) })
afterEach(() => { cleanup(); vi.clearAllMocks(); window.localStorage.clear() })

const org = { id: 'org', spaces: [{ id: 'main' }, { id: 'design' }] } as unknown as OrgWithSpaces

function mount() {
    const onOpenThread = vi.fn()
    render(<MyThreadsView org={org} onOpenThread={onOpenThread} />)
    return onOpenThread
}

describe('your threads', () => {
    beforeEach(() => {
        live = [
            listing('s1', { session: 'fix thread nav', status: 'needs_you', unread: 1 }),
            listing('p1'),
            listing('d1', { topic: 'Pricing page', space: 'Design', status: 'working' }),
        ]
    })

    it('lists every thread you are in, with its space and where it stands, and opens one', () => {
        const onOpenThread = mount()
        expect(screen.getByRole('button', { name: /^fix thread nav Main · Arjun · 2 replies .*· Needs you/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /^p1 body Main/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /^Pricing page Design .*Working/ })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /^Pricing page/ }))
        expect(onOpenThread).toHaveBeenCalledWith('design', 'd1')
    })

    it('narrows to sessions and to named threads', () => {
        mount()
        fireEvent.click(screen.getByRole('button', { name: 'Sessions' }))
        expect(screen.getByRole('button', { name: /^fix thread nav/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /^p1 body/ })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Named' }))
        expect(screen.getByRole('button', { name: /^Pricing page/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /^fix thread nav/ })).toBeNull()
    })

    it('ends a session from its menu', async () => {
        mount()
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Options for fix thread nav' }), { button: 0, ctrlKey: false })
        fireEvent.click(await screen.findByRole('menuitem', { name: 'End session' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:archiveThread', { orgId: 'org', spaceId: 'main', rootMessageId: 's1', archived: true }))
    })

    it('fetches the archived ones when shown', async () => {
        mount()
        fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
        expect(await screen.findByRole('button', { name: /^old work/ })).toBeInTheDocument()
        expect(invoke).toHaveBeenCalledWith('spaces:myThreads', { orgId: 'org', archived: true })
    })
})
