import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RailSelection } from '@/lib/spaces-selection'

const fixture = vi.hoisted(() => {
    const space = { id: 'space', name: 'Main', kind: 'shared' }
    const org = { id: 'org', name: 'Org', address: 'org.example', memberId: 'me', spaces: [space], directs: [] }
    const messages = ['one', 'two'].map((id) => ({ id, body: `Thread ${id}`, spaceId: 'space', author: { memberId: 'me' }, postedAt: '2026-11-03T00:00:00Z', offset: 1, replyCount: 1, replyAuthors: ['me'] }))
    return { space, org, orgs: [org], empty: [], map: new Map(), members: [{ id: 'me', displayName: 'Me', kind: 'human' }],
        feed: { topics: [], changeSets: [], loaded: true },
        stream: { messages, topicsByRoot: new Map(), ready: true, hasMore: false, loadingOlder: false },
        presence: { working: new Map(), typing: new Map(), here: [] as string[] }, online: new Set<string>(['me']), inline: false,
    }
})
vi.mock('@/hooks/use-spaces', () => ({
    useSpacesOrgs: () => ({ orgs: fixture.orgs, loading: false }), useSpacesAccountState: () => null,
    findSpace: () => fixture.space, useSpaceFeed: () => fixture.feed, useSpaceLive: () => {}, useSpaceNames: () => fixture.map,
}))
vi.mock('@/hooks/use-space-chat', () => ({
    useStream: () => fixture.stream, useSpacePresence: () => fixture.presence,
    useSpacesUnreadCounts: () => fixture.map, prefetchThread: vi.fn(), STREAM_READ_KEY: '__stream__',
}))
vi.mock('@/hooks/use-space-members', () => ({ usePeopleOnline: () => fixture.online, useSpaceMembers: () => fixture.members, useOrgRoster: () => fixture.members, refreshMembers: vi.fn() }))
vi.mock('@/hooks/use-space-invocations', () => ({ useSpaceInvocations: () => fixture.map }))
vi.mock('@/hooks/use-space-boards', () => ({ noteListingFromEntries: vi.fn() }))
vi.mock('@/lib/spaces-read-state', () => ({
    useStreamReadOffset: () => 0, useReadStateVersion: () => 0,
    streamBadge: () => ({ unread: 0, forYou: 0 }), threadsBadge: () => ({ unread: 0, forYou: 0 }), threadBadge: () => ({ unread: 0, forYou: 0 }),
}))
vi.mock('@/lib/spaces-stream-view', () => ({ useStreamView: () => fixture.inline ? 'inline' : 'threads', getStreamView: () => 'threads' }))
vi.mock('@/lib/analytics', () => ({ spacesTabViewed: vi.fn() }))
vi.mock('@/components/spaces/general-stream', () => ({ GeneralStream: ({ visible }: { visible: boolean }) => <div data-testid="stream" data-visible={visible} /> }))
vi.mock('@/components/spaces/thread-pane', () => ({ ThreadPane: ({ rootMessageId, visible, onBack }: { rootMessageId: string; visible: boolean; onBack: () => void }) =>
    <div data-testid="thread" data-visible={visible}>{rootMessageId}<button onClick={onBack}>Back to list</button></div>,
}))
vi.mock('@/components/spaces/member-directory', () => ({ MemberDirectory: () => null }))
vi.mock('@/components/spaces/agents-view', () => ({ AgentsView: () => null }))
vi.mock('@/components/spaces/bookmarks', () => ({ BookmarksPanel: () => null }))
vi.mock('@/components/spaces/files-tab', () => ({ FileColumn: () => null, TrashDialog: () => null, UploadFilesDialog: () => null }))
vi.mock('@/components/spaces/scheduled-dialog', () => ({ ScheduledDialog: () => null }))
vi.mock('@/components/spaces/add-members-dialog', () => ({ AddMembersDialog: () => null }))
vi.mock('@/components/spaces/space-admin-dialogs', () => ({ ArchiveSpaceDialog: () => null, DeleteSpaceDialog: () => null }))
vi.mock('@/components/spaces/invite-link', () => ({ InviteLinkPanel: () => null }))
vi.mock('@/components/spaces/selection-copy', () => ({ SelectionCopy: () => null }))
vi.mock('@/components/spaces/activity-view', () => ({ ActivityView: () => null }))
vi.mock('@/components/spaces/space-rail', () => ({ SpaceRail: () => <div data-testid="rail" /> }))
vi.mock('@/components/spaces/start-here', () => ({ StartHere: () => <div data-testid="start-here" /> }))
vi.mock('@/components/spaces/space-files-view', () => ({ SpaceFilesView: () => null }))
vi.mock('@/components/spaces/space-search', () => ({ SpaceSearch: () => null }))
vi.mock('@/components/spaces/atoms', () => ({ MemberAvatar: () => null }))
vi.mock('@/components/spaces/member-admin', () => ({ MemberAdminProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/spaces/invocation-lines', () => ({ SpaceInvocationsProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/spaces/member-text', () => ({ SpaceMembersProvider: ({ children }: { children: ReactNode }) => children, SpaceProfilesProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/spaces/space-markdown', () => ({ SpaceRefsProvider: ({ children }: { children: ReactNode }) => children, SpaceAssetsProvider: ({ children }: { children: ReactNode }) => children, SpaceNavProvider: ({ children }: { children: ReactNode }) => children, AttachmentColumn: ({ children }: { children: ReactNode }) => children }))

import { SpacesView } from './spaces-view'
function App() {
    const [rail, setRail] = useState<RailSelection>({ kind: 'discussions' })
    return <SpacesView selection={{ orgId: 'org', spaceId: 'space' }} railSelection={rail} onRailSelect={setRail} onSelect={vi.fn()} onSwitchSpace={vi.fn()} />
}
let width = 1200
beforeEach(() => {
    fixture.inline = false
    fixture.online = new Set(['me'])
    fixture.presence.here = []
    width = 1200
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
    vi.stubGlobal('ResizeObserver', class {
        callback: () => void
        constructor(callback: () => void) { this.callback = callback }
        observe() { this.callback() }
        disconnect() {}
    })
    Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke: vi.fn(async (channel: string) => channel === 'spaces:listArchivedThreads' ? { threads: [] } : { entries: [] }) } })
})
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); fixture.orgs = [fixture.org] })

// One server (2026-11-09): with no selection — the web app's "/" — the server is the place,
// so the sidebar is there, and an account with nothing in it lands on Start here.
describe('an empty account', () => {
    it('gets the sidebar and Start here, never a dead end', () => {
        fixture.orgs = [{ ...fixture.org, spaces: [], directs: [] } as typeof fixture.org]
        render(<SpacesView selection={null} railSelection={{ kind: 'general' }} onRailSelect={vi.fn()} onSelect={vi.fn()} onSwitchSpace={vi.fn()} />)
        expect(screen.getByTestId('rail')).toBeInTheDocument()
        expect(screen.getByTestId('start-here')).toBeInTheDocument()
        expect(screen.queryByText(/No chat to open/)).toBeNull()
    })
})

describe('Threads list and pane navigation', () => {
    it.each([false, true])('keeps the filtered list mounted beside successive threads (inline=%s)', async (inline) => {
        fixture.inline = inline
        render(<App />)
        fireEvent.click(screen.getByRole('button', { name: 'By me' }))
        const list = screen.getByRole('region', { name: 'Threads' })
        fireEvent.scroll(list, { target: { scrollTop: 240 } })
        fireEvent.click(screen.getByRole('button', { name: /^Thread one/ }))
        expect(screen.getByTestId('thread')).toHaveTextContent('one')
        expect(screen.getByTestId('thread')).toHaveAttribute('data-visible', 'true')
        expect(screen.getByTestId('stream')).toHaveAttribute('data-visible', 'false')
        expect(screen.getByRole('region', { name: 'Threads' })).toBe(list)
        expect(list.closest('.hidden')).toBeNull()
        expect(list.scrollTop).toBe(240)
        expect(screen.getByRole('separator', { name: 'Resize thread pane' })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /^Thread two/ }))
        expect(screen.getByTestId('thread')).toHaveTextContent('two')
        expect(screen.getByRole('button', { name: /^Thread two/ })).toHaveAttribute('aria-current', 'true')
        fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
        expect(screen.queryByTestId('thread')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'By me' })).toHaveAttribute('aria-pressed', 'true')
        await waitFor(() => expect(list.scrollTop).toBe(240))
        fireEvent.click(screen.getByRole('button', { name: 'Messages' }))
        expect(screen.getByTestId('stream')).toHaveAttribute('data-visible', 'true')
        fireEvent.click(screen.getByRole('button', { name: 'Threads' }))
        expect(screen.getByRole('button', { name: 'By me' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('region', { name: 'Threads' }).scrollTop).toBe(240)
    })
    it('returns from a narrow thread pane to the same list', () => {
        width = 600
        render(<App />)
        const list = screen.getByRole('region', { name: 'Threads' })
        fireEvent.click(screen.getByRole('button', { name: /^Thread one/ }))
        expect(list.closest('.hidden')).not.toBeNull()
        expect(screen.queryByRole('separator', { name: 'Resize thread pane' })).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
        expect(list.closest('.hidden')).toBeNull()
        expect(screen.queryByTestId('thread')).not.toBeInTheDocument()
    })
})

it('uses account online status in the member header even without space viewing presence', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Members — 1, 1 online' })).toBeInTheDocument()
})

it('does not show an online dot just because a member is viewing the space', () => {
    fixture.online = new Set()
    fixture.presence.here = ['me']
    render(<App />)
    expect(screen.getByRole('button', { name: 'Members — 1' })).toBeInTheDocument()
})
