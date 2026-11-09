import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServerSpaceNavigation } from './spaces-sidebar-section'
import { SidebarProvider } from '@/components/ui/sidebar'
import { forgetOrg } from '@/lib/spaces-read-state'
import type { OrgWithSpaces } from '@/hooks/use-spaces'

// The chat list (spec §10, 2026-11-09): one list, newest activity first, with
// chips to narrow it; New chat behind the +; your link at the foot. The app
// sidebar carries one Spaces row with the unread across every chat.

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
vi.mock('@/hooks/use-space-members', () => ({
    prefetchMembers: vi.fn(), usePeopleOnline: () => new Set(['p0']), useSelfDisplayName: () => 'Me',
    useOrgRoster: () => [{ id: 'p0', displayName: 'Person 0', kind: 'human' }, { id: 'p1', displayName: 'Person 1', kind: 'human' }, { id: 'claude', displayName: 'Claude', kind: 'agent', ownerId: 'me', agentKind: 'claude-code' }],
}))
vi.mock('@/components/spaces-view', () => ({}))
vi.mock('@/components/spaces/atoms', () => ({ MemberAvatar: ({ name, online }: { name: string; online?: boolean }) => <span data-testid={`avatar-${name}`} data-online={online} />, MemberStatus: () => null }))
vi.mock('@/components/spaces/new-chat-dialog', () => ({ NewChatDialog: ({ open }: { open: boolean }) => open ? <div role="dialog" aria-label="New chat" /> : null }))
vi.mock('@/components/spaces/personal-link-dialog', () => ({ PersonalLinkDialog: ({ open }: { open: boolean }) => open ? <div role="dialog" aria-label="Your link" /> : null }))
vi.mock('@/components/spaces/remove-server-dialog', () => ({ RemoveServerDialog: () => null }))
vi.mock('@/lib/spaces-direct', () => ({
    directAvatarId: (dm: { participants: string[] }) => dm.participants[1], isSelfDirect: () => false, isSelfDirectUnsupported: () => false,
    markSelfDirectUnsupported: vi.fn(), selfDirectFailureMessage: () => '', selfDirectRefused: () => false,
    spaceDisplayName: (_org: unknown, dm: { name: string }) => dm.name,
}))
beforeEach(() => {
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
// The rows' own buttons: a group row also carries its ⋯ options button.
const chatNames = () => within(screen.getByRole('tablist', { name: 'Show' }).nextElementSibling as HTMLElement).getAllByRole('button')
    .filter((b) => !b.getAttribute('aria-label')?.startsWith('Options for')).map((b) => b.textContent?.replace(/you$|opening…$/, '').trim())


describe('the chat list', () => {
    it('is one list, newest activity first, groups and people alike, with the self row waiting at the end', () => {
        activity.dm1 = '2026-10-03'
        activity.founders = '2026-10-02'
        activity.main = '2026-10-01'
        nav()
        expect(chatNames()).toEqual(['Person 1', 'founders', 'main', 'Claude', 'Person 0', 'Me'])
    })

    it('narrows by chip — groups, people, your agents — and remembers the chip', () => {
        nav()
        fireEvent.click(screen.getByRole('tab', { name: 'Groups' }))
        expect(chatNames()).toEqual(['founders', 'main'])
        fireEvent.click(screen.getByRole('tab', { name: 'People' }))
        expect(chatNames()).toEqual(['Person 1', 'Person 0', 'Me'])
        fireEvent.click(screen.getByRole('tab', { name: 'Agents' }))
        expect(chatNames()).toEqual(['Claude'])
        expect(localStorage.getItem('spaces:chatFilter')).toBe('agents')
        cleanup()
        nav()
        expect(screen.getByRole('tab', { name: 'Agents' })).toHaveAttribute('aria-selected', 'true')
    })

    it('leads with Activity, Threads and Agents, and pins your link to the foot', () => {
        const openActivity = vi.fn()
        nav({ onOpenActivity: openActivity, onOpenAgents: vi.fn(), onOpenThreads: vi.fn() })
        const order = ['Activity', 'Threads', 'Agents', 'New chat', 'Share your link'].map((name) => screen.getByRole('button', { name }))
        for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        fireEvent.click(order[0])
        expect(openActivity).toHaveBeenCalledWith(org.id)
        fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
        expect(screen.getByRole('dialog', { name: 'New chat' })).toBeInTheDocument()
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
        fireEvent.click(screen.getByRole('menuitem', { name: 'Rename group' }))
        expect(screen.getByDisplayValue('founders')).toBeInTheDocument()
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
