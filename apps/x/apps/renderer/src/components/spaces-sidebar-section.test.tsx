import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpacesSidebarSection, ServerSpaceNavigation } from './spaces-sidebar-section'
import { ServerOptionsMenu } from './spaces/server-options-menu'
import { SidebarProvider } from '@/components/ui/sidebar'
import { isSpaceExpanded, setSpacesExpanded, useSpaceExpansionVersion } from '@/lib/spaces-expansion'
import { forgetOrg, loadUnread, markStreamRead } from '@/lib/spaces-read-state'
import { useSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'
import { openServerDialog } from '@/lib/server-dialog'

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
vi.mock('@/components/spaces-view', () => ({ OrgMonogram: () => null }))
vi.mock('@/components/spaces/atoms', () => ({ MemberAvatar: () => null, OrgMonogram: () => null }))
vi.mock('@/components/spaces/new-direct-dialog', () => ({ NewDirectDialog: () => null }))
vi.mock('@/lib/spaces-direct', () => ({
    directAvatarId: () => '', isSelfDirect: () => false, isSelfDirectUnsupported: () => false,
    markSelfDirectUnsupported: vi.fn(), selfDirectFailureMessage: () => '', selfDirectRefused: () => false,
    spaceDisplayName: (_org: unknown, dm: { name: string }) => dm.name,
}))
vi.mock('@/lib/server-dialog', () => ({ openServerDialog: vi.fn() }))
beforeEach(() => { vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))) })
afterEach(() => {
    cleanup()
    sessionStorage.clear()
    localStorage.clear()
    forgetOrg(org.id)
    forgetOrg(other.id)
    vi.mocked(useSpacesOrgs).mockImplementation(() => ({ orgs: [org] as unknown as OrgWithSpaces[], loading: false, refresh: vi.fn() }))
    vi.unstubAllGlobals()
})

describe('the sidebar server list', () => {
    it('lists only servers and opens each server using the shared landing destination', () => {
        vi.mocked(useSpacesOrgs).mockReturnValue({ orgs: [org, other] as unknown as OrgWithSpaces[], loading: false, refresh: vi.fn() })
        const open = vi.fn()
        render(<SidebarProvider><SpacesSidebarSection active activeSpace={{ orgId: org.id, spaceId: 'main' }}
            onOpenSpace={open} /></SidebarProvider>)
        expect(screen.getByRole('button', { name: 'Our server' })).toHaveAttribute('data-active', 'true')
        expect(screen.getByRole('button', { name: 'Other server' })).toHaveAttribute('data-active', 'false')
        expect(screen.queryByText('founders')).toBeNull()
        expect(screen.queryByText('Person 0')).toBeNull()
        expect(screen.queryByRole('button', { name: /Spaces activity/ })).toBeNull()
        expect(screen.queryByRole('region', { name: 'Activity across organizations' })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Other server' }))
        expect(open).toHaveBeenCalledWith(other.id, 'welcome')
        expect(screen.queryByRole('button', { name: 'Spaces' })).toBeNull()
        expect(screen.getByRole('heading', { name: 'Spaces' })).toBeVisible()
    })
    it('can open an empty server and add a server when none are connected', () => {
        vi.mocked(useSpacesOrgs).mockReturnValue({ orgs: [{ ...org, spaces: [], directs: [] }] as unknown as OrgWithSpaces[], loading: false, refresh: vi.fn() })
        const open = vi.fn()
        const view = render(<SidebarProvider><SpacesSidebarSection active={false} onOpenSpace={open} /></SidebarProvider>)
        fireEvent.click(screen.getByRole('button', { name: 'Our server' }))
        expect(open).toHaveBeenCalledWith(org.id, '')
        vi.mocked(useSpacesOrgs).mockReturnValue({ orgs: [], loading: false, refresh: vi.fn() })
        view.rerender(<SidebarProvider><SpacesSidebarSection active={false} onOpenSpace={open} /></SidebarProvider>)
        expect(screen.queryByText('Our server')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Add server' }))
        expect(screen.getByRole('dialog', { name: 'Add a server' })).toBeVisible()
        fireEvent.click(screen.getByRole('button', { name: /Create a free server/ }))
        expect(openServerDialog).toHaveBeenLastCalledWith({ kind: 'create' })
        expect(screen.queryByRole('dialog')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Add server' }))
        fireEvent.click(screen.getByRole('button', { name: /Join a server/ }))
        expect(openServerDialog).toHaveBeenLastCalledWith({ kind: 'join' })
    })
    it('aggregates space and DM unread counts per server and updates after reading', async () => {
        vi.mocked(useSpacesOrgs).mockReturnValue({ orgs: [org, other] as unknown as OrgWithSpaces[], loading: false, refresh: vi.fn() })
        vi.stubGlobal('ipc', { on: vi.fn(() => () => {}), invoke: vi.fn(async (_channel, args) => ({
            spaces: [{ spaceId: args.orgId === org.id ? 'founders' : 'welcome', head: 3, readOffset: 0, unreadRoots: 3, unreadMentions: args.orgId === org.id ? 1 : 0, threads: [] },
                ...(args.orgId === org.id ? [{ spaceId: 'dm0', head: 2, readOffset: 0, unreadRoots: 2, unreadMentions: 0, threads: [] }] : [])],
        })) })
        await act(async () => { await loadUnread(org.id, 'me'); await loadUnread(other.id, 'me') })
        render(<SidebarProvider><SpacesSidebarSection active onOpenSpace={vi.fn()} /></SidebarProvider>)
        const ourServer = screen.getByText('Our server').closest('button')!
        const otherServer = screen.getByText('Other server').closest('button')!
        expect(within(ourServer).getByLabelText('5 unread · 3 for you')).toBeVisible()
        expect(within(otherServer).getByLabelText('3 unread · none for you')).toBeVisible()
        act(() => markStreamRead(org.id, 'founders', 3, { sync: false }))
        expect(within(ourServer).getByLabelText('2 unread · 2 for you')).toBeVisible()
    })
})

describe('server and space navigation', () => {
    it('nests and expands legacy discussions while keeping every DM visible', () => {
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
        expect(screen.getByText('Person 0')).toBeTruthy()
        expect(screen.getByRole('heading', { name: 'DMs' })).toBeTruthy()
    })
    it('shows every space and DM without list expansion controls in the content-tab rail', () => {
        sessionStorage.setItem(`spaces:directsExpanded:${org.id}`, 'false')
        render(<SidebarProvider><ServerSpaceNavigation org={org as unknown as OrgWithSpaces} spaceId="main"
            onOpenSpace={vi.fn()} showDiscussions={false} /></SidebarProvider>)
        for (let i = 0; i < 5; i++) expect(screen.getByText(`Person ${i}`)).toBeTruthy()
        for (const space of org.spaces) expect(screen.getByText(space.name)).toBeTruthy()
        expect(screen.queryByText('View all')).toBeNull()
        expect(screen.queryByText('Show less')).toBeNull()
        const newSpace = screen.getByRole('button', { name: 'New space' })
        expect(screen.getByText('founders').compareDocumentPosition(newSpace) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(newSpace.compareDocumentPosition(screen.getByRole('heading', { name: 'DMs' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        fireEvent.click(newSpace)
        expect(screen.getByPlaceholderText('Space name').compareDocumentPosition(screen.getByRole('heading', { name: 'DMs' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
