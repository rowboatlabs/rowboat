import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpacesSidebarSection, ServerSpaceNavigation } from './spaces-sidebar-section'
import { ServerOptionsMenu } from './spaces/server-options-menu'
import { SidebarProvider } from '@/components/ui/sidebar'
import { useSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'

const { org, topics } = vi.hoisted(() => ({
    org: {
        id: 'server', name: 'Our server', memberId: 'me', directLabels: {},
        spaces: [{ id: 'main', name: 'main' }, { id: 'founders', name: 'founders' }],
        directs: Array.from({ length: 5 }, (_, i) => ({ id: `dm${i}`, name: `Person ${i}`, createdAt: `2026-09-0${i + 1}` })),
    },
    topics: [{ id: 'archived', rootMessageId: 'archived', title: 'Archived discussion', lastActivityAt: '2026-09-05', archived: true }, ...Array.from({ length: 4 }, (_, i) => ({ id: `topic${i}`, rootMessageId: `root${i}`, title: `Discussion ${i}`, lastActivityAt: `2026-09-0${i + 1}` }))],
}))
vi.mock('@/hooks/use-spaces', () => ({ useSpacesOrgs: vi.fn(() => ({ orgs: [org], loading: false, refresh: vi.fn() })), useSpaceFeed: () => ({ topics, loaded: true }), openSelfDirect: vi.fn() }))
vi.mock('@/hooks/use-space-chat', () => ({ useSpacesUnreadCounts: () => new Map(), prefetchStream: vi.fn(), spaceLastActivityAt: () => null }))
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
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals() })

describe('server and space navigation', () => {
    it('shows nested server names and preserves the current location when returning to Spaces', () => {
        const onOpenSpaces = vi.fn()
        render(<SidebarProvider><SpacesSidebarSection active={false} activeSpace={{ orgId: org.id, spaceId: 'founders' }} onOpenSpaces={onOpenSpaces} onOpenSpace={vi.fn()} /></SidebarProvider>)
        expect(screen.getByText('Our server')).toHaveClass('font-medium')
        expect(screen.getByText('Our server').closest('button')?.querySelector('svg')).toBeNull()
        expect(screen.queryByText('main')).toBeNull()
        expect(screen.queryByText('Direct messages')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Spaces' }))
        expect(onOpenSpaces).toHaveBeenCalledTimes(1)
        fireEvent.click(screen.getByText('Our server'))
        expect(onOpenSpaces).toHaveBeenCalledTimes(2)
    })
    it('navigates to a different server when its name is clicked', () => {
        const other = { ...org, id: 'other', name: 'Other server', spaces: [{ id: 'welcome', name: 'welcome' }] }
        vi.mocked(useSpacesOrgs).mockReturnValueOnce({ orgs: [org, other] as unknown as OrgWithSpaces[], loading: false, refresh: vi.fn() })
        const onOpenSpace = vi.fn()
        render(<SidebarProvider><SpacesSidebarSection active activeSpace={{ orgId: org.id, spaceId: 'founders' }}
            onOpenSpaces={vi.fn()} onOpenSpace={onOpenSpace} /></SidebarProvider>)
        expect(screen.getByText('Other server')).toHaveClass('font-normal')
        fireEvent.click(screen.getByText('Other server'))
        expect(onOpenSpace).toHaveBeenCalledWith('other', 'welcome')
    })
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
