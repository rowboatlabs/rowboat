import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import { SuperAgentSection } from './agent-super'

const boss: spaces.Member = { id: 'boss', displayName: 'Boss', role: 'member', kind: 'agent', ownerId: 'harsh' }
const invoke = vi.fn(async () => ({ agent: boss }))
const onChanged = vi.fn(async () => {})

afterEach(cleanup)
beforeEach(() => {
    invoke.mockClear()
    ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: () => () => {} }
})

// Super agents (Harbor spec §4 Agent members, 2026-11-02): an admin's switch, with two per-agent choices.
describe('SuperAgentSection', () => {
    it('lets an admin make an agent a super agent, asking its owner first by default', async () => {
        render(<SuperAgentSection orgId="org-1" agent={boss} isAdmin ownerName="Harsh" onChanged={onChanged} />)
        expect(screen.queryByRole('switch', { name: 'Ask its owner first' })).toBeNull()
        fireEvent.click(screen.getByRole('switch', { name: 'Super agent' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:setAgentSuper', { orgId: 'org-1', agentId: 'boss', superAgent: { approval: 'always', canDelete: false } }))
    })

    it('changes each choice on its own, and turns it off with null', async () => {
        const agent = { ...boss, superAgent: { approval: 'always' as const, canDelete: false } }
        render(<SuperAgentSection orgId="org-1" agent={agent} isAdmin ownerName="Harsh" onChanged={onChanged} />)
        fireEvent.click(screen.getByRole('switch', { name: 'Can delete what it creates' }))
        await waitFor(() => expect(invoke).toHaveBeenLastCalledWith('spaces:setAgentSuper', { orgId: 'org-1', agentId: 'boss', superAgent: { approval: 'always', canDelete: true } }))
        fireEvent.click(screen.getByRole('switch', { name: 'Ask its owner first' }))
        await waitFor(() => expect(invoke).toHaveBeenLastCalledWith('spaces:setAgentSuper', { orgId: 'org-1', agentId: 'boss', superAgent: { approval: 'never', canDelete: false } }))
        fireEvent.click(screen.getByRole('switch', { name: 'Super agent' }))
        await waitFor(() => expect(invoke).toHaveBeenLastCalledWith('spaces:setAgentSuper', { orgId: 'org-1', agentId: 'boss', superAgent: null }))
    })

    it('shows everyone else what it may do, and nothing for an ordinary agent', () => {
        render(<SuperAgentSection orgId="org-1" agent={{ ...boss, superAgent: { approval: 'never', canDelete: true } }} isAdmin={false} ownerName="Harsh" onChanged={onChanged} />)
        expect(screen.queryByRole('switch')).toBeNull()
        expect(screen.getByText('It can create Hermes and Codex agents for Harsh, without asking first, and delete the ones it created.')).toBeInTheDocument()
        cleanup()
        const { container } = render(<SuperAgentSection orgId="org-1" agent={boss} isAdmin={false} ownerName="Harsh" onChanged={onChanged} />)
        expect(container).toBeEmptyDOMElement()
    })
})
