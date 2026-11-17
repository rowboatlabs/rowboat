import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SlackProfile } from './slack-profile'
import type { spaces } from '@x/shared'
vi.mock('./atoms', () => ({ MemberProfilePopover: ({ children }: { children: React.ReactNode }) => children }))
const invoke = vi.fn()
const message = { id: 'message', spaceId: 'space', author: { memberId: 'admin', slack: { name: 'Alex', userId: 'U1', workspace: 'team.slack.com', channelId: 'C1', timestamp: '1.000001' } } } as spaces.Message
beforeEach(() => {
    invoke.mockReset().mockImplementation(async (channel: string, args: { memberId?: string | null }) => {
        if (channel === 'spaces:listMembers') return { members: [{ id: 'admin', displayName: 'Admin', role: 'admin', kind: 'human' }, { id: 'person', displayName: 'Person', role: 'member', kind: 'human' }] }
        return { ...message.author.slack, memberId: channel === 'spaces:linkSlackProfile' ? args.memberId : null }
    })
    Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } })
})
afterEach(cleanup)
it('lets admins explicitly link and unlink, while retaining the Slack name', async () => {
    render(<SlackProfile message={message} orgId="server" selfMemberId="admin" />)
    fireEvent.click(screen.getByRole('button', { name: /Alex/ }))
    const select = await screen.findByLabelText('Rowboat profile')
    fireEvent.change(select, { target: { value: 'person' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile link' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:linkSlackProfile', { orgId: 'server', spaceId: 'space', messageId: 'message', memberId: 'person' }))
    await screen.findByRole('button', { name: 'Person' })
    fireEvent.change(select, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile link' }))
    await screen.findByText('No Rowboat profile linked.')
    expect(invoke).toHaveBeenCalledWith('spaces:linkSlackProfile', expect.objectContaining({ memberId: null }))
})
it('shows readers the profile without mapping controls', async () => {
    render(<SlackProfile message={message} orgId="server" selfMemberId="person" />)
    fireEvent.click(screen.getByRole('button', { name: /Alex/ }))
    await screen.findByText('No Rowboat profile linked.')
    expect(screen.queryByLabelText('Rowboat profile')).toBeNull()
})
