import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServerSpaceNavigation } from './spaces-sidebar-section'
import { SidebarProvider } from '@/components/ui/sidebar'
import { forgetOrg } from '@/lib/spaces-read-state'
import { applyMemberPresence } from '@/hooks/use-space-members'
import type { OrgWithSpaces } from '@/hooks/use-spaces'

// The sidebar (spec §10, 2026-11-09, sections since the evening's design
// pass): New space leads, Activity and Threads above, then Agents (highlighted),
// Groups and People, each newest first with its own +; your link at the foot.

const { org, topics, activity } = vi.hoisted(() => ({
    org: {
        id: 'server', name: 'Spaces', memberId: 'me', directLabels: {},
        spaces: [{ id: 'main', name: 'main', createdAt: '2026-09-01' }, { id: 'founders', name: 'founders', createdAt: '2026-09-02' }],
        directs: [{ id: 'dm0', name: 'Person 0', createdAt: '2026-09-03', participants: ['me', 'p0'] }, { id: 'dm1', name: 'Person 1', createdAt: '2026-09-04', participants: ['me', 'p1'] }, { id: 'bot', name: 'Claude', createdAt: '2026-09-05', participants: ['me', 'claude'] }],
    },
    topics: [{ id: 'archived', rootMessageId: 'archived', title: 'Archived discussion', lastActivityAt: '2026-09-05', archived: true }, ...Array.from({ length: 4 }, (_, i) => ({ id: `topic${i}`, rootMessageId: `root${i}`, title: `Discussion ${i}`, lastActivityAt: `2026-09-0${i + 1}` }))],
    activity: {} as Record<string, string>,
}))
vi.mock('@/hooks/use-spaces', () => ({ useSpacesOrgs: vi.fn(() => ({ orgs: [org], loading: false, refresh: vi.fn() })), useSpaceFeed: () => ({ topics, loaded: true }), openSelfDirect: vi.fn(), refreshSpacesOrgs: vi.fn() }))
// The unread map is the ONE thing both surfaces read; here it is built from the
// real server-owned read state, so a mark moving in the store must move both.
vi.mock('@/hooks/use-space-chat', async () => {
    const read = await vi.importActual<typeof import('@/lib/spaces-read-state')>('@/lib/spaces-read-state')
    return {
        prefetchStream: vi.fn(),
        spaceLastActivityAt: (_orgId: string, spaceId: string) => activity[spaceId] ?? null,
        useSpacesUnreadCounts: () => {
            read.useReadStateVersion()
            const counts = new Map<string, ReturnType<typeof read.spaceBadge>>()
            for (const space of org.spaces) counts.set(`${org.id}/${space.id}`, read.spaceBadge(org.id, space.id, false))
            for (const dm of org.directs) counts.set(`${org.id}/${dm.id}`, read.spaceBadge(org.id, dm.id, true))
            return counts
        },
    }
})
vi.mock('@/hooks/use-space-members', async importOriginal => ({
    ...await importOriginal<typeof import('@/hooks/use-space-members')>(),
    prefetchMembers: vi.fn(), useSelfDisplayName: () => 'Me',
    useOrgRoster: () => [{ id: 'p0', displayName: 'Person 0', kind: 'human' }, { id: 'p1', displayName: 'Person 1', kind: 'human' }, { id: 'claude', displayName: 'Claude', kind: 'agent', ownerId: 'me', agentKind: 'claude-code' }],
}))
vi.mock('@/components/spaces-view', () => ({}))
vi.mock('@/components/spaces/atoms', () => ({ MemberAvatar: ({ name, online }: { name: string; online?: boolean }) => <span data-testid={`avatar-${name}`} data-online={online} />, MemberStatus: () => null }))
vi.mock('@/components/spaces/new-chat-dialog', () => ({ NewChatDialog: ({ open, start }: { open: boolean; start?: string }) => open ? <div role="dialog" aria-label="New chat" data-start={start} /> : null }))
vi.mock('@/components/spaces/personal-link-dialog', () => ({ PersonalLinkDialog: ({ open }: { open: boolean }) => open ? <div role="dialog" aria-label="Your link" /> : null }))
vi.mock('@/components/spaces/remove-server-dialog', () => ({ RemoveServerDialog: () => null }))
vi.mock('@/lib/spaces-direct', () => ({
    directAvatarId: (dm: { participants: string[] }) => dm.participants[1], isSelfDirect: () => false, isSelfDirectUnsupported: () => false,
    markSelfDirectUnsupported: vi.fn(), selfDirectFailureMessage: () => '', selfDirectRefused: () => false,
    spaceDisplayName: (_org: unknown, dm: { name: string }) => dm.name,
}))
beforeEach(() => {
    applyMemberPresence(org.id, 'p0', true)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    vi.stubGlobal('ipc', { on: vi.fn(() => () => {}), invoke: vi.fn(async () => ({ threads: [], spaces: [] })) })
})
afterEach(() => {
    cleanup()
    sessionStorage.clear()
    localStorage.clear()
    forgetOrg(org.id)
    for (const key of Object.keys(activity)) delete activity[key]
    vi.unstubAllGlobals()
})

const nav = (props: Partial<Parameters<typeof ServerSpaceNavigation>[0]> = {}) =>
    render(<SidebarProvider><ServerSpaceNavigation org={org as unknown as OrgWithSpaces} spaceId="main" onOpenSpace={vi.fn()} showDiscussions={false} {...props} /></SidebarProvider>)
// A section's rows: a group row also carries its ⋯ options button, a header its +.
const names = (section: string) => within(screen.getByRole('region', { name: section })).getAllByRole('button')
    .filter((b) => { const label = b.getAttribute('aria-label') ?? ''; return !label.startsWith('Options for') && !label.startsWith('View all') })
    .map((b) => b.textContent?.replace(/you$|opening…$/, '').replace(/^(Agents)\d+$/, '$1').trim())


describe('the chat list', () => {
    it('splits chats into Agents, Groups and People, each newest activity first, the self row last among people', () => {
        activity.dm1 = '2026-10-03'
        activity.founders = '2026-10-02'
        activity.main = '2026-10-01'
        nav({ onOpenAgents: vi.fn() })
        expect(names('Agents')).toEqual(['Claude', 'Add an agent'])
        expect(names('Spaces')).toEqual(['founders', 'main', 'New space'])
        expect(names('People')).toEqual(['Person 1', 'Person 0', 'Me', 'New message'])
    })

    it('leads with New space, then Activity, Threads and the Agents section, and pins your link to the foot', () => {
        const openActivity = vi.fn()
        const openAgents = vi.fn()
        nav({ onOpenActivity: openActivity, onOpenAgents: openAgents, onOpenThreads: vi.fn() })
        const order = [/^New space$/, 'Activity', 'Threads', 'View all agents', 'Share your link'].map((name) => screen.getAllByRole('button', { name })[0])
        for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        fireEvent.click(order[1])
        expect(openActivity).toHaveBeenCalledWith(org.id)
        fireEvent.click(order[3])
        expect(openAgents).toHaveBeenCalledWith(org.id)
        fireEvent.click(screen.getByRole('button', { name: 'Add an agent' }))
        expect(openAgents).toHaveBeenCalledTimes(2)
    })

    it('opens the new-chat sheet on the screen the click meant: New space on the space form, New message on the picker', () => {
        nav()
        fireEvent.click(screen.getAllByRole('button', { name: /^New space$/ })[0])
        expect(screen.getByRole('dialog', { name: 'New chat' })).toHaveAttribute('data-start', 'group')
        cleanup()
        nav()
        fireEvent.click(screen.getByRole('button', { name: 'New message' }))
        expect(screen.getByRole('dialog', { name: 'New chat' })).toHaveAttribute('data-start', 'message')
    })

    it('shares your link from the foot row', () => {
        nav()
        fireEvent.click(screen.getByRole('button', { name: 'Share your link' }))
        expect(screen.getByRole('dialog', { name: 'Your link' })).toBeInTheDocument()
    })

    it('folds archived groups under one row at the foot', () => {
        const withArchived = { ...org, spaces: [...org.spaces, { id: 'old', name: 'old', createdAt: '2026-08-01', archived: true }] }
        render(<SidebarProvider><ServerSpaceNavigation org={withArchived as unknown as OrgWithSpaces} spaceId="main" onOpenSpace={vi.fn()} showDiscussions={false} /></SidebarProvider>)
        const archived = screen.getByRole('button', { name: 'Archived (1)' })
        expect(archived).toHaveAttribute('aria-expanded', 'false')
        expect(screen.getByText('old').closest('[data-open]')).toHaveAttribute('inert')
        fireEvent.click(archived)
        expect(archived).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByText('old').closest('[data-open]')).not.toHaveAttribute('inert')
    })

    it('opens rename from the row’s options button as well as the context menu', () => {
        nav()
        fireEvent.keyDown(screen.getByRole('button', { name: 'Options for founders' }), { key: 'Enter' })
        fireEvent.click(screen.getByRole('menuitem', { name: 'Rename space' }))
        expect(screen.getByDisplayValue('founders')).toBeInTheDocument()
    })

    it('opens settings for the selected space from its options menu', () => {
        const onOpenSettings = vi.fn()
        nav({ onOpenSettings })
        fireEvent.keyDown(screen.getByRole('button', { name: 'Options for founders' }), { key: 'Enter' })
        fireEvent.click(screen.getByRole('menuitem', { name: 'Space settings' }))
        expect(onOpenSettings).toHaveBeenCalledTimes(1)
        expect(onOpenSettings.mock.calls[0][0]).toBe(org.id)
        expect(onOpenSettings.mock.calls[0][1]).toBe(org.spaces.find(s => s.name === 'founders')!.id)
    })

    it('nests and expands discussions under a group', () => {
        const onOpenDiscussion = vi.fn()
        nav({ showDiscussions: true, onOpenDiscussion, activeDiscussionCount: 0, renderActiveDiscussions: () => null })
        const founders = screen.getByText('founders').closest('li')!
        expect(within(founders).queryByText('Discussion 3')).toBeNull()
        fireEvent.click(screen.getByLabelText('Expand #founders'))
        fireEvent.click(within(founders).getByText('View all'))
        fireEvent.click(within(founders).getByText('Discussion 0'))
        expect(onOpenDiscussion).toHaveBeenCalledWith('founders', { kind: 'thread', rootMessageId: 'root0' })
        expect(screen.queryByText('Archived discussion')).toBeNull()
    })

    it('marks the online participant of a direct message', () => {
        nav()
        expect(screen.getByTestId('avatar-Person 0')).toHaveAttribute('data-online', 'true')
        expect(screen.getByTestId('avatar-Person 1')).toHaveAttribute('data-online', 'false')
    })
})

it('updates the People sidebar when live online status changes', () => {
    nav()
    for (const online of [true, false, true]) {
        act(() => applyMemberPresence(org.id, 'p0', online))
        expect(screen.getByTestId('avatar-Person 0')).toHaveAttribute('data-online', String(online))
    }
})
