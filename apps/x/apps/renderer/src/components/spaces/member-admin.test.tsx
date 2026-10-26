import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import { MemberAdminActions, MemberAdminProvider } from './member-admin'

// An admin's acts on a member (harbor admin controls, 2026-10-19): the rows a
// profile popover shows, and the confirmations they open.

afterEach(cleanup)

const self = { id: 'ramnique', displayName: 'Ramnique', role: 'admin', kind: 'human' } as spaces.Member
const harsh = { id: 'harsh', displayName: 'Harsh', role: 'member', kind: 'human' } as spaces.Member
const agent = { id: 'bot', displayName: 'Bot', role: 'member', kind: 'agent' } as spaces.Member
const gone = { ...harsh, id: 'gone', removedAt: '2026-10-19T00:00:00Z' } as spaces.Member
const space = { id: 'S1', name: 'payments', kind: 'shared', visibility: 'private', createdAt: '' } as spaces.Space

const invoke = vi.fn(async (_channel: string, _args: unknown) => ({}))
beforeEach(() => {
    invoke.mockClear()
    ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: () => () => {} }
})

function renderFor(member: spaces.Member, opts: { isAdmin?: boolean; inSpace?: boolean } = {}) {
    return render(
        <MemberAdminProvider orgId="org-1" orgName="Rowboat Labs" selfId="ramnique" isAdmin={opts.isAdmin ?? true}
            space={space} spaceMemberIds={opts.inSpace === false ? ['ramnique'] : ['ramnique', member.id]}>
            <MemberAdminActions member={member} onAct={() => {}} />
        </MemberAdminProvider>,
    )
}

describe('MemberAdminActions', () => {
    it('shows an admin every act on a person in the space', () => {
        renderFor(harsh)
        expect(screen.getByRole('button', { name: /Make admin/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Remove from payments/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Remove from Rowboat Labs/ })).toBeInTheDocument()
    })

    it('shows nothing to a member, and nothing for someone already removed', () => {
        renderFor(harsh, { isAdmin: false })
        expect(screen.queryByRole('button')).not.toBeInTheDocument()
        cleanup()
        renderFor(gone)
        expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('never offers an agent the admin role, and yourself only stepping down', () => {
        renderFor(agent)
        expect(screen.queryByRole('button', { name: /admin/i })).not.toBeInTheDocument()
        cleanup()
        renderFor(self)
        expect(screen.getByRole('button', { name: /Step down as admin/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Remove from/ })).not.toBeInTheDocument()
    })

    it('leaves out removal from the space for someone not in it', () => {
        renderFor(harsh, { inSpace: false })
        expect(screen.queryByRole('button', { name: /Remove from payments/ })).not.toBeInTheDocument()
    })

    it('promotes in one click, and removes from the org after a confirmation', async () => {
        renderFor(harsh)
        fireEvent.click(screen.getByRole('button', { name: /Make admin/ }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:setMemberRole', { orgId: 'org-1', memberId: 'harsh', role: 'admin' }))

        fireEvent.click(screen.getByRole('button', { name: /Remove from Rowboat Labs/ }))
        expect(screen.getByText('Remove Harsh from Rowboat Labs?')).toBeInTheDocument()
        expect(invoke).not.toHaveBeenCalledWith('spaces:removeOrgMember', expect.anything())
        fireEvent.click(screen.getByRole('button', { name: 'Remove from server' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:removeOrgMember', { orgId: 'org-1', memberId: 'harsh' }))
    })

    it('removes from the space after a confirmation', async () => {
        renderFor(harsh)
        fireEvent.click(screen.getByRole('button', { name: /Remove from payments/ }))
        fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:removeMember', { orgId: 'org-1', spaceId: 'S1', memberId: 'harsh' }))
    })
})
