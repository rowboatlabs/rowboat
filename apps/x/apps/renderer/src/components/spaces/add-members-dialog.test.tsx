import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import { AddMembersDialog } from './add-members-dialog'

afterEach(cleanup)

const ram = { id: 'ramnique', displayName: 'Ramnique', kind: 'human' } as spaces.Member
const harsh = { id: 'harsh', displayName: 'Harsh', kind: 'human' } as spaces.Member
const replicas = { id: '01HREPL', displayName: 'Replicas', kind: 'agent', ownerId: 'ramnique' } as spaces.Member
const theirs = { id: '01HTHEIRS', displayName: 'Scout', kind: 'agent', ownerId: 'harsh' } as spaces.Member
const space = { id: 'S1', name: 'payments', kind: 'shared', createdAt: '' } as spaces.Space
const org = { id: 'org-1', name: 'Rowboat Labs', spaces: [space], directs: [], memberId: 'ramnique' } as unknown as OrgWithSpaces

const invoke = vi.fn(async (channel: string, args: { memberIds?: string[] }) => {
    if (channel === 'spaces:listContacts') return { members: [harsh, ram, replicas, theirs] }
    if (channel === 'spaces:listMembers') return { members: [ram] }
    if (channel === 'spaces:addMembers') return { memberships: (args.memberIds ?? []).map((memberId) => ({ spaceId: 'S1', memberId, joinedAt: '' })) }
    throw new Error(`unexpected ${channel}`)
})

beforeEach(() => {
    invoke.mockClear()
    ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: () => () => {} }
})

// "Add people" (2026-09-29; 2026-11-09): your contacts minus who is already in
// the space, several at once, agents marked — your own agents only, with a seat.
describe('AddMembersDialog', () => {
    it('offers everyone not already in the space and your own agents, marks agents, and adds the picked ones with a seat', async () => {
        const onOpenChange = vi.fn()
        render(<AddMembersDialog org={org} space={space} members={[ram]} open onOpenChange={onOpenChange} />)
        await waitFor(() => expect(screen.getByRole('checkbox', { name: /Harsh/ })).toBeInTheDocument())
        expect(screen.queryByRole('checkbox', { name: /Ramnique/ })).not.toBeInTheDocument()
        expect(screen.getByRole('checkbox', { name: /Replicas/ })).toHaveTextContent('Agent')
        // Someone else's agent is never offered: only its owner adds it (2026-11-09).
        expect(screen.queryByRole('checkbox', { name: /Scout/ })).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('checkbox', { name: /Replicas/ }))
        fireEvent.click(screen.getByRole('checkbox', { name: /Harsh/ }))
        expect(screen.getByRole('checkbox', { name: /Harsh/ })).toHaveAttribute('aria-checked', 'true')
        // An agent among the picks asks who may ask it there; everyone by default.
        fireEvent.click(screen.getByRole('radio', { name: 'Only me' }))
        fireEvent.click(screen.getByRole('button', { name: 'Add 2' }))

        await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
        expect(invoke).toHaveBeenCalledWith('spaces:addMembers', { orgId: 'org-1', spaceId: 'S1', memberIds: ['01HREPL', 'harsh'], invocableBy: 'owner' })
    })

    it('never offers a deleted account (2026-10-13)', async () => {
        const gone = { id: 'gone', displayName: 'Gone', kind: 'human', deactivatedAt: '2026-10-13T00:00:00.000Z' } as spaces.Member
        invoke.mockImplementationOnce(async (channel: string) => {
            if (channel === 'spaces:listContacts') return { members: [gone, harsh, ram] }
            throw new Error(`unexpected ${channel}`)
        })
        const org2 = { ...org, id: 'org-2' } as OrgWithSpaces
        render(<AddMembersDialog org={org2} space={space} members={[ram]} open onOpenChange={vi.fn()} />)
        await waitFor(() => expect(screen.getByRole('checkbox', { name: /Harsh/ })).toBeInTheDocument())
        expect(screen.queryByRole('checkbox', { name: /Gone/ })).not.toBeInTheDocument()
    })

    it('adds nobody until someone is picked', async () => {
        render(<AddMembersDialog org={org} space={space} members={[ram]} open onOpenChange={vi.fn()} />)
        await waitFor(() => expect(screen.getByRole('checkbox', { name: /Harsh/ })).toBeInTheDocument())
        expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    })
})
