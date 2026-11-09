import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServerSpaceNavigation } from './spaces-sidebar-section'
import { ServerOptionsMenu } from './spaces/server-options-menu'
import { SidebarProvider } from '@/components/ui/sidebar'
import { isSpaceExpanded, setSpacesExpanded, useSpaceExpansionVersion } from '@/lib/spaces-expansion'
import { forgetOrg } from '@/lib/spaces-read-state'
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
vi.mock('@/hooks/use-space-members', () => ({ prefetchMembers: vi.fn(), usePeopleOnline: () => new Set(['dm0']), useSelfDisplayName: () => 'Me', useOrgRoster: () => [] }))
vi.mock('@/hooks/use-org-settings', () => ({ useOrgSettings: () => ({ invitePolicy: 'members' }), canInvite: () => true }))
vi.mock('@/components/spaces-view', () => ({ OrgMonogram: () => null }))
vi.mock('@/components/spaces/atoms', () => ({ MemberAvatar: ({ name, online }: { name: string; online?: boolean }) => <span data-testid={`avatar-${name}`} data-online={online} />, MemberStatus: () => null, OrgMonogram: () => null }))
vi.mock('@/components/spaces/new-direct-dialog', () => ({ NewDirectDialog: () => null }))
vi.mock('@/lib/spaces-direct', () => ({
    directAvatarId: (dm: { id: string }) => dm.id, isSelfDirect: () => false, isSelfDirectUnsupported: () => false,
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

describe('server and space navigation', () => {
    it('offers no DMs in a group chat, notes to self included', () => {
        render(<SidebarProvider><ServerSpaceNavigation org={{ ...other, groupChat: true } as unknown as OrgWithSpaces} spaceId="welcome"
            onOpenSpace={vi.fn()} showDiscussions={false} /></SidebarProvider>)
        expect(screen.getByText('welcome')).toBeTruthy()
        expect(screen.queryByRole('button', { name: 'Direct messages' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'New direct message' })).toBeNull()
        expect(screen.queryByText('Me')).toBeNull()
    })
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
        expect(screen.getByRole('button', { name: 'Direct messages' })).toBeTruthy()
    })
    it('shows every space and DM without list expansion controls in the content-tab rail', () => {
        sessionStorage.setItem(`spaces:directsExpanded:${org.id}`, 'false')
        render(<SidebarProvider><ServerSpaceNavigation org={org as unknown as OrgWithSpaces} spaceId="main"
            onOpenSpace={vi.fn()} showDiscussions={false} /></SidebarProvider>)
        for (let i = 0; i < 5; i++) expect(screen.getByText(`Person ${i}`)).toBeTruthy()
        for (const space of org.spaces) expect(screen.getByText(space.name)).toBeTruthy()
        expect(screen.queryByText('View all')).toBeNull()
        expect(screen.queryByText('Show less')).toBeNull()
        // Spaces redesign (2026-10-21): the section header's + replaces the "New space" row.
        const newSpace = screen.getByRole('button', { name: 'New space' })
        expect(newSpace.compareDocumentPosition(screen.getByText('founders')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(screen.getByText('founders').compareDocumentPosition(screen.getByRole('button', { name: 'Direct messages' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(screen.queryByText('New DM')).toBeNull()
        fireEvent.click(newSpace)
        expect(screen.getByRole('dialog', { name: 'Create a space' })).toBeInTheDocument()
    })
    it('leads with Activity, Agents and Browse rows, and pins Invite people to the foot', () => {
        const openActivity = vi.fn()
        render(<SidebarProvider><ServerSpaceNavigation org={org as unknown as OrgWithSpaces} spaceId="main" onOpenSpace={vi.fn()}
            onOpenActivity={openActivity} onOpenAgents={vi.fn()} onOpenBrowse={vi.fn()} showDiscussions={false} /></SidebarProvider>)
        const order = ['Activity', 'Agents', 'Browse spaces', 'Spaces', 'Direct messages', 'Invite people']
            .map((name) => screen.getByRole('button', { name }))
        for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        fireEvent.click(order[0])
        expect(openActivity).toHaveBeenCalledWith(org.id)
        expect(screen.queryByText('Invite')).toBeNull()
    })
    it('collapses each section from its header and remembers it', () => {
        const view = render(<SidebarProvider><ServerSpaceNavigation org={org as unknown as OrgWithSpaces} spaceId="main"
            onOpenSpace={vi.fn()} showDiscussions={false} /></SidebarProvider>)
        const directs = screen.getByRole('button', { name: 'Direct messages' })
        expect(directs).toHaveAttribute('aria-expanded', 'true')
        fireEvent.click(directs)
        expect(directs).toHaveAttribute('aria-expanded', 'false')
        expect(document.getElementById(directs.getAttribute('aria-controls')!)).toHaveAttribute('inert')
        expect(localStorage.getItem('spaces:sectionOpen:directs')).toBe('false')
        expect(screen.getByRole('button', { name: 'Spaces' })).toHaveAttribute('aria-expanded', 'true')
        view.unmount()
        render(<SidebarProvider><ServerSpaceNavigation org={org as unknown as OrgWithSpaces} spaceId="main"
            onOpenSpace={vi.fn()} showDiscussions={false} /></SidebarProvider>)
        expect(screen.getByRole('button', { name: 'Direct messages' })).toHaveAttribute('aria-expanded', 'false')
    })
    it('folds archived spaces under one row at the foot of Spaces', () => {
        const withArchived = { ...org, spaces: [...org.spaces, { id: 'old', name: 'old', createdAt: '2026-08-01', archived: true }] }
        render(<SidebarProvider><ServerSpaceNavigation org={withArchived as unknown as OrgWithSpaces} spaceId="main"
            onOpenSpace={vi.fn()} showDiscussions={false} /></SidebarProvider>)
        const archived = screen.getByRole('button', { name: 'Archived (1)' })
        expect(archived).toHaveAttribute('aria-expanded', 'false')
        expect(screen.getByText('old').closest('[data-open]')).toHaveAttribute('inert')
        fireEvent.click(archived)
        expect(archived).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByText('old').closest('[data-open]')).not.toHaveAttribute('inert')
    })
    it('opens rename from the row\'s options button as well as the context menu', () => {
        render(<SidebarProvider><ServerSpaceNavigation org={org as unknown as OrgWithSpaces} spaceId="main"
            onOpenSpace={vi.fn()} showDiscussions={false} /></SidebarProvider>)
        fireEvent.keyDown(screen.getByRole('button', { name: 'Options for founders' }), { key: 'Enter' })
        fireEvent.click(screen.getByRole('menuitem', { name: 'Rename space' }))
        expect(screen.getByDisplayValue('founders')).toBeInTheDocument()
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

it('marks the online DM participant while leaving offline participants unmarked', () => {
    render(<SidebarProvider><ServerSpaceNavigation org={org as unknown as OrgWithSpaces} spaceId="main"
        onOpenSpace={vi.fn()} showDiscussions={false} /></SidebarProvider>)
    expect(screen.getByTestId('avatar-Person 0')).toHaveAttribute('data-online', 'true')
    expect(screen.getByTestId('avatar-Person 1')).toHaveAttribute('data-online', 'false')
})
