import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import { AgentsDialog } from './agents-dialog'

afterEach(cleanup)

const person = (id: string, displayName: string, role: 'admin' | 'member' = 'member') => ({ id, displayName, role, kind: 'human' }) as spaces.Member
const hermes = { id: 'hermes', displayName: 'Hermes', role: 'member', kind: 'agent', ownerId: 'me' } as spaces.Member
const scout = { id: 'scout', displayName: 'Scout', role: 'member', kind: 'agent', ownerId: 'harsh' } as spaces.Member
const key = (id: string, agentId: string, extra: Partial<spaces.AgentKey> = {}): spaces.AgentKey =>
    ({ id, agentId, createdBy: 'me', createdAt: '2026-09-29T10:00:00Z', ...extra })
const org = { id: 'org-1', name: 'Rowboat Labs', baseUrl: 'https://rowboat.example', spaces: [], directs: [], memberId: 'me' } as unknown as OrgWithSpaces

let roster: spaces.Member[]
let listing: spaces.AgentListing[]
const invoke = vi.fn(async (channel: string, args: Record<string, string>) => {
    switch (channel) {
        case 'spaces:listOrgMembers': return { members: roster }
        case 'spaces:listAgents': return { agents: listing }
        case 'spaces:addAgent': return { agent: { ...hermes, id: 'new', displayName: args.displayName }, key: { ...key('k9', 'new'), secret: 'rbk_secret-once' } }
        case 'spaces:createAgentKey': return { key: { ...key('k2', args.agentId!), secret: 'rbk_rotated' } }
        case 'spaces:revokeAgentKey': return { key: key(args.keyId!, args.agentId!, { revokedAt: '2026-09-29T11:00:00Z' }) }
    }
    throw new Error(`unexpected ${channel}`)
})

beforeEach(() => {
    invoke.mockClear()
    window.localStorage.clear()
    roster = [person('me', 'Ramnique'), person('harsh', 'Harsh')]
    listing = [{ agent: hermes, keys: [key('k1', 'hermes', { lastUsedAt: '2026-09-29T10:30:00Z' }), key('k0', 'hermes', { revokedAt: '2026-09-28T10:00:00Z' })] }]
    ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: () => () => {} }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } })
})

// The Agents dialog (2026-09-29): add an agent, see its key once, rotate and revoke.
describe('AgentsDialog', () => {
    it('adds an agent and shows its key once, with where to point it', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        fireEvent.change(screen.getByPlaceholderText(/Name/), { target: { value: 'Scout' } })
        fireEvent.click(screen.getByRole('button', { name: 'Add agent' }))
        await screen.findByText('rbk_secret-once')
        expect(invoke).toHaveBeenCalledWith('spaces:addAgent', { orgId: 'org-1', displayName: 'Scout' })
        expect(screen.getByText('https://rowboat.example/mcp')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Done' }))
        expect(screen.queryByText('rbk_secret-once')).not.toBeInTheDocument()
    })

    it('lists only live keys, mints a new one for your own agent, and revokes on a second click', async () => {
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Hermes')
        expect(screen.getAllByText(/Key made/)).toHaveLength(1)
        fireEvent.click(screen.getByRole('button', { name: /New key/ }))
        await screen.findByText('rbk_rotated')
        fireEvent.click(screen.getByRole('button', { name: 'Done' }))
        fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
        expect(invoke).not.toHaveBeenCalledWith('spaces:revokeAgentKey', expect.anything())
        fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:revokeAgentKey', { orgId: 'org-1', agentId: 'hermes', keyId: 'k1' }))
    })

    it('lets an admin revoke someone else’s agent’s key, but not mint one', async () => {
        roster = [person('me', 'Ramnique', 'admin'), person('harsh', 'Harsh')]
        listing = [{ agent: scout, keys: [key('k5', 'scout')] }]
        render(<AgentsDialog org={org} open onOpenChange={vi.fn()} />)
        await screen.findByText('Owned by Harsh')
        expect(screen.queryByRole('button', { name: /New key/ })).not.toBeInTheDocument()
        await waitFor(() => expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument())
    })
})
