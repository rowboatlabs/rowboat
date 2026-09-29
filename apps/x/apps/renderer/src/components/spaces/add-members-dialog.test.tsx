import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import { AddMembersDialog } from './add-members-dialog'

afterEach(cleanup)

const ram = { id: 'ramnique', displayName: 'Ramnique', role: 'member', kind: 'human' } as spaces.Member
const harsh = { id: 'harsh', displayName: 'Harsh', role: 'member', kind: 'human' } as spaces.Member
const replicas = { id: '01HREPL', displayName: 'Replicas', role: 'member', kind: 'agent' } as spaces.Member
const space = { id: 'S1', name: 'payments', kind: 'shared', visibility: 'private', createdAt: '' } as spaces.Space
const org = { id: 'org-1', name: 'Rowboat Labs', spaces: [space], directs: [], memberId: 'ramnique' } as unknown as OrgWithSpaces

const invoke = vi.fn(async (channel: string, args: { memberIds?: string[] }) => {
    if (channel === 'spaces:listOrgMembers') return { members: [harsh, ram, replicas] }
    if (channel === 'spaces:listMembers') return { members: [ram] }
    if (channel === 'spaces:addMembers') return { memberships: (args.memberIds ?? []).map((memberId) => ({ spaceId: 'S1', memberId, joinedAt: '' })) }
    throw new Error(`unexpected ${channel}`)
})

beforeEach(() => {
    invoke.mockClear()
    ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: () => () => {} }
})

// "Add people" (2026-09-29): the org roster minus who is already in the space,
// several at once, agents marked.
describe('AddMembersDialog', () => {
    it('offers everyone not already in the space, marks agents, and adds the picked ones', async () => {
        const onOpenChange = vi.fn()
        render(<AddMembersDialog org={org} space={space} members={[ram]} open onOpenChange={onOpenChange} />)
        await waitFor(() => expect(screen.getByRole('checkbox', { name: /Harsh/ })).toBeInTheDocument())
        expect(screen.queryByRole('checkbox', { name: /Ramnique/ })).not.toBeInTheDocument()
        expect(screen.getByRole('checkbox', { name: /Replicas/ })).toHaveTextContent('agent')

        fireEvent.click(screen.getByRole('checkbox', { name: /Replicas/ }))
        fireEvent.click(screen.getByRole('checkbox', { name: /Harsh/ }))
        expect(screen.getByRole('checkbox', { name: /Harsh/ })).toHaveAttribute('aria-checked', 'true')
        fireEvent.click(screen.getByRole('button', { name: 'Add 2' }))

        await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
        expect(invoke).toHaveBeenCalledWith('spaces:addMembers', { orgId: 'org-1', spaceId: 'S1', memberIds: ['01HREPL', 'harsh'] })
    })

    it('adds nobody until someone is picked', async () => {
        render(<AddMembersDialog org={org} space={space} members={[ram]} open onOpenChange={vi.fn()} />)
        await waitFor(() => expect(screen.getByRole('checkbox', { name: /Harsh/ })).toBeInTheDocument())
        expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    })
})
