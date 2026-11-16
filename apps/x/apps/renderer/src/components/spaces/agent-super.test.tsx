import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import { SuperAgentSection } from './agent-super'

const boss: spaces.Member = { id: 'boss', displayName: 'Boss', kind: 'agent', ownerId: 'harsh' }
const invoke = vi.fn(async () => ({ agent: boss }))
const onChanged = vi.fn(async () => {})

afterEach(cleanup)
beforeEach(() => {
    invoke.mockClear()
    ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: () => () => {} }
})

// Super agents (Harbor spec §4 Agent members, 2026-11-02; the owner's switch since 2026-11-09), with two per-agent choices.
describe('SuperAgentSection', () => {
    it('lets the owner make an agent a super agent, asking permission for both by default', async () => {
        render(<SuperAgentSection orgId="org-1" agent={boss} canSwitch ownerName="Harsh" onChanged={onChanged} />)
        expect(screen.queryByRole('switch', { name: 'Ask permission before creating agents' })).toBeNull()
        fireEvent.click(screen.getByRole('switch', { name: 'Super agent' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:setAgentSuper', { orgId: 'org-1', agentId: 'boss', superAgent: { askBeforeCreate: true, askBeforeDelete: true } }))
    })

    it('changes each choice on its own, and turns it off with null', async () => {
        const agent = { ...boss, superAgent: { askBeforeCreate: true, askBeforeDelete: true } }
        render(<SuperAgentSection orgId="org-1" agent={agent} canSwitch ownerName="Harsh" onChanged={onChanged} />)
        fireEvent.click(screen.getByRole('switch', { name: 'Ask permission before deleting agents it creates' }))
        await waitFor(() => expect(invoke).toHaveBeenLastCalledWith('spaces:setAgentSuper', { orgId: 'org-1', agentId: 'boss', superAgent: { askBeforeCreate: true, askBeforeDelete: false } }))
        fireEvent.click(screen.getByRole('switch', { name: 'Ask permission before creating agents' }))
        await waitFor(() => expect(invoke).toHaveBeenLastCalledWith('spaces:setAgentSuper', { orgId: 'org-1', agentId: 'boss', superAgent: { askBeforeCreate: false, askBeforeDelete: true } }))
        fireEvent.click(screen.getByRole('switch', { name: 'Super agent' }))
        await waitFor(() => expect(invoke).toHaveBeenLastCalledWith('spaces:setAgentSuper', { orgId: 'org-1', agentId: 'boss', superAgent: null }))
    })

    it('shows everyone else what it may do, and nothing for an ordinary agent', () => {
        render(<SuperAgentSection orgId="org-1" agent={{ ...boss, superAgent: { askBeforeCreate: false, askBeforeDelete: true } }} canSwitch={false} ownerName="Harsh" onChanged={onChanged} />)
        expect(screen.queryByRole('switch')).toBeNull()
        expect(screen.getByText('Lets it create agents for Harsh and hand them work.')).toBeInTheDocument()
        expect(screen.getByText('Ask permission before creating agents: off')).toBeInTheDocument()
        expect(screen.getByText('Ask permission before deleting agents it creates: on')).toBeInTheDocument()
        cleanup()
        const { container } = render(<SuperAgentSection orgId="org-1" agent={boss} canSwitch={false} ownerName="Harsh" onChanged={onChanged} />)
        expect(container).toBeEmptyDOMElement()
    })
})
