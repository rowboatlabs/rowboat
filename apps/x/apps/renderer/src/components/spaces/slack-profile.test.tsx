import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSlackSender } from '@/hooks/use-slack-sender'
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
    Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke, on: vi.fn(() => () => {}) } })
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

function Sender({ item = message }: { item?: spaces.Message }) {
    const mapped = useSlackSender('server', item)
    return <div data-testid="sender" data-member={mapped ?? ''}>
        <SlackProfile message={item} orgId="server" selfMemberId="admin" mappedMemberId={mapped} mappedName={mapped === 'person' ? 'Person' : 'Alex'} />
    </div>
}

it('updates every visible message by the same sender and restores legacy names on unlink', async () => {
    render(<><Sender /><Sender item={{ ...message, id: 'reply' }} /></>)
    await waitFor(() => expect(invoke.mock.calls.filter(([channel]) => channel === 'spaces:getSlackProfile')).toHaveLength(1))
    fireEvent.click(screen.getAllByRole('button', { name: /Alex/ })[0])
    const select = await screen.findByLabelText('Rowboat profile')
    fireEvent.change(select, { target: { value: 'person' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile link' }))
    await waitFor(() => expect(screen.getAllByTestId('sender').map(el => el.dataset.member)).toEqual(['person', 'person']))
    expect(screen.getAllByRole('button', { name: 'Sender mapping', hidden: true })).toHaveLength(2)
    fireEvent.change(select, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile link' }))
    await waitFor(() => expect(screen.getAllByTestId('sender').map(el => el.dataset.member)).toEqual(['', '']))
})

it('resolves saved mappings on mount without opening the legacy dialog', async () => {
    invoke.mockResolvedValue({ ...message.author.slack, memberId: 'person' })
    render(<Sender />)
    await screen.findByRole('button', { name: 'Person' })
    expect(screen.queryByRole('button', { name: /Alex/ })).toBeNull()
    expect(invoke).not.toHaveBeenCalledWith('spaces:listMembers', expect.anything())
})

it('applies remote mapping events only to the matching space and source', async () => {
    render(<Sender />)
    await waitFor(() => expect(invoke).toHaveBeenCalled())
    const receive = vi.mocked(window.ipc.on).mock.calls[0][1]
    const frame = { kind: 'event', spaceId: 'space', event: { type: 'slack_profile_linked', workspace: 'team.slack.com', userId: 'U1', memberId: 'person' } }
    const { act } = await import('@testing-library/react')
    await act(async () => { receive({ orgId: 'other', frame } as never) })
    expect(screen.getByTestId('sender').dataset.member).toBe('')
    await act(async () => { receive({ orgId: 'server', frame } as never) })
    await screen.findByRole('button', { name: 'Person' })
})
