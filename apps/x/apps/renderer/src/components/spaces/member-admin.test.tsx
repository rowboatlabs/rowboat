import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import { MemberAdminActions, MemberAdminProvider } from './member-admin'

// A space admin's acts on a member (harbor spec §4 Roles; per space since
// 2026-11-09): the rows a profile popover shows, and the confirmation they open.

afterEach(cleanup)

const row = (member: spaces.Member, role: 'admin' | 'member' = 'member'): spaces.SpaceMember => ({ ...member, role, joinedAt: '2026-11-09T00:00:00Z' })
const self = { id: 'ramnique', displayName: 'Ramnique', kind: 'human' } as spaces.Member
const harsh = { id: 'harsh', displayName: 'Harsh', kind: 'human' } as spaces.Member
const agent = { id: 'bot', displayName: 'Bot', kind: 'agent', ownerId: 'harsh' } as spaces.Member
const gone = { ...harsh, id: 'gone', removedAt: '2026-10-19T00:00:00Z' } as spaces.Member
const space = { id: 'S1', name: 'payments', kind: 'shared', createdAt: '' } as spaces.Space

const invoke = vi.fn(async (_channel: string, _args: unknown) => ({}))
beforeEach(() => {
    invoke.mockClear()
    ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: () => () => {} }
})

function renderFor(member: spaces.Member, opts: { isAdmin?: boolean; inSpace?: boolean; role?: 'admin' | 'member' } = {}) {
    const rows = [row(self, 'admin'), ...(opts.inSpace === false || member.id === self.id ? [] : [row(member, opts.role)])]
    return render(
        <MemberAdminProvider orgId="org-1" selfId="ramnique" isAdmin={opts.isAdmin ?? true} space={space} spaceMembers={rows}>
            <MemberAdminActions member={member} onAct={() => {}} />
        </MemberAdminProvider>,
    )
}

describe('MemberAdminActions', () => {
    it('shows a space admin every act on a person in the space', () => {
        renderFor(harsh)
        expect(screen.getByRole('button', { name: /Make admin of payments/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Remove from payments/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Remove from Rowboat/ })).not.toBeInTheDocument()
    })

    it('shows nothing to a member, and nothing for someone already gone', () => {
        renderFor(harsh, { isAdmin: false })
        expect(screen.queryByRole('button')).not.toBeInTheDocument()
        cleanup()
        renderFor(gone)
        expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('never offers an agent the admin role, and yourself only stepping down', () => {
        renderFor(agent)
        expect(screen.queryByRole('button', { name: /admin/i })).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Remove from payments/ })).toBeInTheDocument()
        cleanup()
        renderFor(self)
        expect(screen.getByRole('button', { name: /Step down as admin of payments/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Remove from/ })).not.toBeInTheDocument()
    })

    it('shows nothing for someone not in the space', () => {
        renderFor(harsh, { inSpace: false })
        expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('promotes and demotes in one click, on this space', async () => {
        renderFor(harsh)
        fireEvent.click(screen.getByRole('button', { name: /Make admin of payments/ }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:setMemberRole', { orgId: 'org-1', spaceId: 'S1', memberId: 'harsh', role: 'admin' }))
        cleanup()
        renderFor(harsh, { role: 'admin' })
        fireEvent.click(screen.getByRole('button', { name: /Remove admin of payments/ }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:setMemberRole', { orgId: 'org-1', spaceId: 'S1', memberId: 'harsh', role: 'member' }))
    })

    it('removes from the space after a confirmation', async () => {
        renderFor(harsh)
        fireEvent.click(screen.getByRole('button', { name: /Remove from payments/ }))
        expect(screen.getByText(/their agents leave with them/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:removeMember', { orgId: 'org-1', spaceId: 'S1', memberId: 'harsh' }))
    })
})
