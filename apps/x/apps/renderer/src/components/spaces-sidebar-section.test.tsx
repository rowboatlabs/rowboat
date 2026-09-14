import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpacesSidebarSection, ServerSpaceNavigation } from './spaces-sidebar-section'
import { ServerOptionsMenu } from './spaces/server-options-menu'
import { SidebarProvider } from '@/components/ui/sidebar'
import { isSpaceExpanded, setSpacesExpanded, useSpaceExpansionVersion } from '@/lib/spaces-expansion'
import { forgetOrg, loadUnread, markStreamRead } from '@/lib/spaces-read-state'
import { resetServerFoldForTest } from '@/lib/spaces-sidebar-fold'
import { noteSpaceVisit, resetSpaceVisitsForTest } from '@/lib/spaces-visits'
import { useSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'

const { org, other, topics } = vi.hoisted(() => ({
    org: {
        id: 'server', name: 'Our server', memberId: 'me', directLabels: {},
        spaces: [{ id: 'main', name: 'main', createdAt: '2026-09-01' }, { id: 'founders', name: 'founders', createdAt: '2026-09-02' }],
        directs: Array.from({ length: 5 }, (_, i) => ({ id: `dm${i}`, name: `Person ${i}`, createdAt: `2026-09-0${i + 1}` })),
    },
    other: {
        id: 'other', name: 'Other server', memberId: 'me', directLabels: {},
        spaces: [{ id: 'welcome', name: 'welcome', createdAt: '2026-09-01' }], directs: [],
    },
    topics: [{ id: 'archived', rootMessageId: 'archived', title: 'Archived discussion', lastActivityAt: '2026-09-05', archived: true }, ...Array.from({ length: 4 }, (_, i) => ({ id: `topic${i}`, rootMessageId: `root${i}`, title: `Discussion ${i}`, lastActivityAt: `2026-09-0${i + 1}` }))],
}))
vi.mock('@/hooks/use-spaces', () => ({ useSpacesOrgs: vi.fn(() => ({ orgs: [org], loading: false, refresh: vi.fn() })), useSpaceFeed: () => ({ topics, loaded: true }), openSelfDirect: vi.fn() }))
// The unread map is the ONE thing both surfaces read; here it is built from the
// real org-owned read state, so a mark moving in the store must move both.
vi.mock('@/hooks/use-space-chat', async () => {
    const read = await vi.importActual<typeof import('@/lib/spaces-read-state')>('@/lib/spaces-read-state')
    return {
        prefetchStream: vi.fn(),
        spaceLastActivityAt: () => null,
        useSpacesUnreadCounts: () => {
            read.useReadStateVersion()
            const counts = new Map<string, ReturnType<typeof read.spaceBadge>>()
            for (const server of [org, other]) {
                for (const space of server.spaces) counts.set(`${server.id}/${space.id}`, read.spaceBadge(server.id, space.id, false))
                for (const dm of server.directs) counts.set(`${server.id}/${dm.id}`, read.spaceBadge(server.id, dm.id, true))
            }
            return counts
        },
    }
})
vi.mock('@/hooks/use-space-members', () => ({ prefetchMembers: vi.fn(), useSelfDisplayName: () => 'Me' }))
vi.mock('@/components/spaces-view', () => ({ AddOrgDialog: () => null, OrgMonogram: () => null }))
vi.mock('@/components/spaces/atoms', () => ({ MemberAvatar: () => null, AddOrgDialog: () => null }))
vi.mock('@/components/spaces/new-direct-dialog', () => ({ NewDirectDialog: () => null }))
vi.mock('@/lib/spaces-direct', () => ({
    directAvatarId: () => '', isSelfDirect: () => false, isSelfDirectUnsupported: () => false,
    markSelfDirectUnsupported: vi.fn(), selfDirectFailureMessage: () => '', selfDirectRefused: () => false,
    spaceDisplayName: (_org: unknown, dm: { name: string }) => dm.name,
}))
beforeEach(() => { vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))) })
afterEach(() => {
    cleanup()
    sessionStorage.clear()
    localStorage.clear()
    resetServerFoldForTest()
    resetSpaceVisitsForTest()
    forgetOrg(org.id)
    forgetOrg(other.id)
    vi.mocked(useSpacesOrgs).mockImplementation(() => ({ orgs: [org] as unknown as OrgWithSpaces[], loading: false, refresh: vi.fn() }))
    vi.unstubAllGlobals()
})

// --- the sidebar's working set ---------------------------------------------
// A short, fixed list per server: the open space, then what is waiting, then
// what the reader keeps coming back to, then a deterministic backfill.

describe('the sidebar working set', () => {
    const bothServers = () => vi.mocked(useSpacesOrgs).mockImplementation(
        () => ({ orgs: [org, other] as unknown as OrgWithSpaces[], loading: false, refresh: vi.fn() }))
    const sidebar = (props: Partial<Parameters<typeof SpacesSidebarSection>[0]> = {}) => render(
        <SidebarProvider>
            <SpacesSidebarSection active activeSpace={{ orgId: org.id, spaceId: 'founders' }}
                onOpenSpaces={vi.fn()} onOpenSpace={vi.fn()} {...props} />
        </SidebarProvider>)
    /** Put unread roots on spaces, the way the org's snapshot does. */
    const seedUnread = async (orgId: string, spaces: Array<{ spaceId: string; unreadRoots: number; unreadMentions?: number }>) => {
        vi.stubGlobal('ipc', {
            on: vi.fn(() => () => {}),
            invoke: vi.fn(async (channel: string) => channel === 'spaces:getUnread'
                ? { spaces: spaces.map((s) => ({ head: s.unreadRoots, readOffset: 0, unreadMentions: 0, threads: [], ...s })) }
                : {}),
        })
        await act(async () => { await loadUnread(orgId, 'me') })
    }

    it('shows the open space pinned, then backfills to exactly three rows', () => {
        sidebar()
        const rows = ['founders', 'main', 'Person 0']
        for (const name of rows) expect(screen.getByText(name)).toBeTruthy()
        // The fourth candidate stays out, and a discussion is never a row.
        expect(screen.queryByText('Person 1')).toBeNull()
        expect(screen.queryByText('Discussion 0')).toBeNull()
        expect(screen.getByText('founders').closest('button')).toHaveAttribute('data-active', 'true')
    })

    it('opens a server holding the open space or anything unread, and leaves the rest closed', async () => {
        bothServers()
        sidebar()
        const header = (name: string) => screen.getByText(name).closest('button')!
        expect(header('Our server')).toHaveAttribute('aria-expanded', 'true')
        expect(header('Other server')).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByText('welcome')).toBeNull()
        await seedUnread(other.id, [{ spaceId: 'welcome', unreadRoots: 2 }])
        expect(header('Other server')).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByText('welcome')).toHaveClass('font-medium')
    })

    it('shows a closed server the sum of its items\' badges, and opens on a click', async () => {
        bothServers()
        await seedUnread(org.id, [{ spaceId: 'main', unreadRoots: 3, unreadMentions: 1 }, { spaceId: 'dm1', unreadRoots: 4 }])
        sidebar({ activeSpace: null })
        // Both servers are open (one holds the restored location, one has unread),
        // so close ours by hand to read its rolled-up badge.
        fireEvent.click(screen.getByText('Our server'))
        const header = screen.getByText('Our server').closest('button')!
        expect(header).toHaveAttribute('aria-expanded', 'false')
        // 3 roots + 4 in a DM, of which 1 mention + the DM's 4 are for me.
        expect(within(header).getByLabelText('7 unread · 5 for you')).toBeTruthy()
        expect(screen.queryByText('main')).toBeNull()
        fireEvent.click(screen.getByText('Our server'))
        expect(screen.getByText('main')).toBeTruthy()
    })

    it('keeps the reader\'s own toggle over the automatic rule, across relaunches', () => {
        const view = sidebar()
        expect(screen.getByText('Our server').closest('button')).toHaveAttribute('aria-expanded', 'true')
        fireEvent.click(screen.getByText('Our server'))
        expect(screen.queryByText('founders')).toBeNull()
        view.unmount()
        // A relaunch: the in-memory mirror is gone, the answer is not.
        resetServerFoldForTest()
        sidebar()
        expect(screen.getByText('Our server').closest('button')).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByText('founders')).toBeNull()
    })

    it('holds a row in place once it is showing, and gives an entering one its rank', async () => {
        const view = sidebar()
        // Each row is titled with its name; the server header's title is its own sentence.
        const shown = () => screen.getAllByRole('button').map((b) => b.getAttribute('title'))
            .filter((t) => ['founders', 'main', 'Person 0', 'Person 3'].includes(t ?? ''))
        expect(shown()).toEqual(['founders', 'main', 'Person 0'])
        // Visiting one already showing must not move it.
        act(() => noteSpaceVisit(org.id, 'main', 9_000))
        expect(shown()).toEqual(['founders', 'main', 'Person 0'])
        // A DM goes unread: it enters behind the open space, ahead of the backfill,
        // and the row it displaced leaves.
        await seedUnread(org.id, [{ spaceId: 'dm3', unreadRoots: 1 }])
        expect(shown()).toEqual(['founders', 'Person 3', 'main'])
        view.unmount()
    })

    it('reaches the siderail and the sidebar from one read state', async () => {
        render(<SidebarProvider>
            <SpacesSidebarSection active activeSpace={{ orgId: org.id, spaceId: 'main' }} onOpenSpaces={vi.fn()} onOpenSpace={vi.fn()} />
            <ServerSpaceNavigation org={org as unknown as OrgWithSpaces} spaceId="main" onOpenSpace={vi.fn()}
                onOpenDiscussion={vi.fn()} activeDiscussionCount={0} renderActiveDiscussions={() => null} />
        </SidebarProvider>)
        await seedUnread(org.id, [{ spaceId: 'founders', unreadRoots: 2 }])
        expect(screen.getAllByLabelText('2 unread · none for you')).toHaveLength(2)
        act(() => markStreamRead(org.id, 'founders', 2, { sync: false }))
        expect(screen.queryByLabelText('2 unread · none for you')).toBeNull()
    })
})

describe('server and space navigation', () => {
    it('nests three recent discussions, expands and collapses them, and folds DMs', () => {
        const onOpenDiscussion = vi.fn()
        render(<SidebarProvider><ServerSpaceNavigation org={org as unknown as OrgWithSpaces} spaceId="main" onOpenSpace={vi.fn()}
            onOpenDiscussion={onOpenDiscussion} activeDiscussionCount={0} renderActiveDiscussions={() => null} /></SidebarProvider>)
        const founders = screen.getByText('founders').closest('li')!
        expect(within(founders).queryByText('Discussion 3')).toBeNull()
        expect(screen.queryByLabelText('Expand #main')).toBeNull()
        expect(screen.queryByText('No discussions yet')).toBeNull()
        fireEvent.click(screen.getByLabelText('Expand #founders'))
        expect(within(founders).queryByText('Discussion 0')).toBeNull()
        fireEvent.click(within(founders).getByText('View all'))
        fireEvent.click(within(founders).getByText('Discussion 0'))
        expect(onOpenDiscussion).toHaveBeenCalledWith('founders', { kind: 'thread', rootMessageId: 'root0' })
        fireEvent.click(screen.getByLabelText('Collapse #founders'))
        expect(within(founders).queryByText('Discussion 3')).toBeNull()
        expect(screen.queryByText('Person 0')).toBeNull()
        fireEvent.click(screen.getByText('View all'))
        expect(screen.getByText('Person 0')).toBeTruthy()
        fireEvent.click(screen.getByText('Direct messages'))
        expect(screen.queryByText('Person 0')).toBeNull()
    })
    it('moves every space from the rail\'s one expand-all / collapse-all control', () => {
        // The rail header's control, standing in for space-rail.tsx: the space
        // rows and the control share one store, so either can move the other.
        function Navigation() {
            useSpaceExpansionVersion()
            const ids = org.spaces.map((space) => space.id)
            const anyExpanded = ids.some((id) => isSpaceExpanded(org.id, id))
            return <SidebarProvider>
                <button type="button" onClick={() => setSpacesExpanded(org.id, ids, !anyExpanded)}>
                    {anyExpanded ? 'Collapse all discussions' : 'Expand all discussions'}
                </button>
                <ServerSpaceNavigation org={org as unknown as OrgWithSpaces} spaceId="" onOpenSpace={vi.fn()}
                    onOpenDiscussion={vi.fn()} activeDiscussionCount={0} renderActiveDiscussions={() => null} />
            </SidebarProvider>
        }
        render(<Navigation />)
        fireEvent.click(screen.getByRole('button', { name: 'Expand all discussions' }))
        expect(screen.getByLabelText('Collapse #main')).toBeTruthy()
        expect(screen.getByLabelText('Collapse #founders')).toBeTruthy()
        // A partially expanded server must still offer Collapse all, as one button.
        fireEvent.click(screen.getByLabelText('Collapse #founders'))
        expect(screen.getByRole('button', { name: 'Collapse all discussions' })).toBeTruthy()
        expect(screen.queryByRole('button', { name: 'Expand all discussions' })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Collapse all discussions' }))
        expect(screen.getByLabelText('Expand #main')).toBeTruthy()
        expect(screen.getByLabelText('Expand #founders')).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Expand all discussions' })).toBeTruthy()
    })
})

describe('server removal menus', () => {
    it('can cancel removal and then reopen and confirm from the rail', async () => {
        const invoke = vi.fn().mockResolvedValue({})
        vi.stubGlobal('ipc', { invoke })
        render(<ServerOptionsMenu org={org} showArchived={false} onToggleArchived={vi.fn()} onMenuOpenChange={vi.fn()} />)
        const openMenu = () => fireEvent.keyDown(screen.getByRole('button', { name: 'Server options' }), { key: 'Enter' })
        openMenu()
        expect(screen.queryByRole('menuitem', { name: 'New message' })).toBeNull()
        expect(screen.queryByRole('menuitem', { name: 'New space' })).toBeNull()
        expect(screen.queryByRole('menuitem', { name: 'Collapse spaces and DMs' })).toBeNull()
        fireEvent.click(screen.getByRole('menuitem', { name: 'Remove server' }))
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
        expect(screen.queryByRole('alertdialog')).toBeNull()
        expect(invoke).not.toHaveBeenCalled()
        openMenu()
        fireEvent.click(screen.getByRole('menuitem', { name: 'Remove server' }))
        fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
        expect(invoke).toHaveBeenCalledExactlyOnceWith('spaces:removeOrg', { orgId: 'server' })
    })
})

it('shows archived discussions alongside live discussions, then hides only archived discussions', () => {
    function Navigation() {
        const [showArchived, setShowArchived] = useState(false)
        return <SidebarProvider>
            <ServerOptionsMenu org={org} showArchived={showArchived} onToggleArchived={() => setShowArchived((value) => !value)} onMenuOpenChange={() => {}} />
            <ServerSpaceNavigation org={org as unknown as OrgWithSpaces} spaceId="main" onOpenSpace={vi.fn()}
                onOpenDiscussion={vi.fn()} activeDiscussionCount={0} renderActiveDiscussions={() => null} showArchived={showArchived} />
        </SidebarProvider>
    }
    render(<Navigation />)
    fireEvent.click(screen.getByLabelText('Expand #founders'))
    const founders = screen.getByText('founders').closest('li')!
    fireEvent.click(within(founders).getByText('View all'))
    expect(screen.queryByText('Archived discussion')).toBeNull()
    const openMenu = () => fireEvent.keyDown(screen.getByRole('button', { name: 'Server options' }), { key: 'Enter' })
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show Archived' }))
    expect(screen.getByText('Archived discussion')).toBeTruthy()
    expect(screen.getByText('Discussion 0')).toBeTruthy()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide archived' }))
    expect(screen.queryByText('Archived discussion')).toBeNull()
    expect(screen.getByText('Discussion 0')).toBeTruthy()
})
