import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import { toast } from '@/lib/toast'
import { ApprovalCard } from './approval-card'

const names = new Map([['me', 'Ramnique'], ['harsh', 'Harsh'], ['hermes', 'Hermes']])

const open: spaces.Approval = {
    id: 'ap1',
    invocationId: 'inv1',
    agentId: 'hermes',
    conversation: { spaceId: 'S1', threadRootId: 'R1' },
    messageId: 'M1',
    requestKey: 'k1',
    title: 'Run a command',
    detail: 'rm -rf ./build',
    reason: 'It deletes files',
    choices: ['allow_once', 'allow_session', 'allow_always', 'deny'],
    state: 'open',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
}

const decided = (patch: Partial<spaces.Approval>): spaces.Approval => ({ ...open, decidedAt: '2026-10-01T10:01:00.000Z', updatedAt: '2026-10-01T10:01:00.000Z', ...patch })

let reply: spaces.Approval
const invoke = vi.fn<(channel: string, args: Record<string, unknown>) => Promise<{ approval: spaces.Approval }>>(async () => ({ approval: reply }))

afterEach(cleanup)
beforeEach(() => {
    invoke.mockClear()
    ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: () => () => {} }
})

// The agent's approval card (spec §8 part 4, 2026-10-01).
describe('ApprovalCard', () => {
    it('shows what the agent asks to do, why, and one button per choice it offers', () => {
        render(<ApprovalCard approval={{ ...open, choices: ['allow_once', 'deny'] }} orgId="org-1" selfMemberId="me" memberNames={names} />)
        expect(screen.getByText('Run a command')).toBeInTheDocument()
        expect(screen.getByText('rm -rf ./build')).toBeInTheDocument()
        expect(screen.getByText('Why: It deletes files')).toBeInTheDocument()
        expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Allow once', 'Deny'])
    })

    it('sends a decision and then says who made it', async () => {
        reply = decided({ state: 'allowed', decision: 'allow_session', decidedBy: 'me' })
        render(<ApprovalCard approval={open} orgId="org-1" selfMemberId="me" memberNames={names} />)
        fireEvent.click(screen.getByRole('button', { name: 'Allow in this thread' }))
        await screen.findByText(/Allowed in this thread by you/)
        expect(invoke).toHaveBeenCalledWith('spaces:decideApproval', { orgId: 'org-1', spaceId: 'S1', approvalId: 'ap1', decision: 'allow_session' })
        expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull()
    })

    it('denies with an optional note for the agent', async () => {
        reply = decided({ state: 'denied', decision: 'deny', decidedBy: 'me', note: 'use the clean script' })
        render(<ApprovalCard approval={open} orgId="org-1" selfMemberId="me" memberNames={names} />)
        fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
        fireEvent.change(screen.getByPlaceholderText('Tell Hermes why (optional)'), { target: { value: 'use the clean script' } })
        fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
        await screen.findByText(/Denied by you/)
        expect(invoke).toHaveBeenCalledWith('spaces:decideApproval', { orgId: 'org-1', spaceId: 'S1', approvalId: 'ap1', decision: 'deny', note: 'use the clean script' })
        expect(screen.getByText(/use the clean script/)).toBeInTheDocument()
    })

    it('says when someone else decided first, and keeps the buttons', async () => {
        invoke.mockRejectedValueOnce(new Error('this approval is already allowed'))
        render(<ApprovalCard approval={open} orgId="org-1" selfMemberId="me" memberNames={names} />)
        fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
        await waitFor(() => expect(toast).toHaveBeenCalledWith('this approval is already allowed', 'error'))
        expect(screen.getByRole('button', { name: 'Allow once' })).toBeEnabled()
    })

    it('shows a settled one as it stands: decided by someone, expired, or cancelled', () => {
        const { rerender } = render(<ApprovalCard approval={decided({ state: 'allowed', decision: 'allow_once', decidedBy: 'harsh' })} orgId="org-1" selfMemberId="me" memberNames={names} />)
        expect(screen.getByText(/Allowed once by Harsh/)).toBeInTheDocument()
        expect(screen.queryAllByRole('button')).toHaveLength(0)
        rerender(<ApprovalCard approval={decided({ state: 'expired' })} orgId="org-1" selfMemberId="me" memberNames={names} />)
        expect(screen.getByText(/Expired: Hermes stopped waiting/)).toBeInTheDocument()
        rerender(<ApprovalCard approval={decided({ state: 'cancelled' })} orgId="org-1" selfMemberId="me" memberNames={names} />)
        expect(screen.getByText(/Cancelled/)).toBeInTheDocument()
    })
})
