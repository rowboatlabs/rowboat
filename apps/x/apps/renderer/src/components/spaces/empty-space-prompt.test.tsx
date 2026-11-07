import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { EmptySpacePrompt } from './empty-space-prompt'

vi.mock('@/components/spaces/agents-dialog', () => ({
    AgentsDialog: ({ open, start }: { open: boolean; start: { name: string } }) => open ? <div role="dialog" aria-label={`agents:${start.name}`} /> : null,
}))
vi.mock('@/components/spaces/invite-link', () => ({
    InviteLinkPanel: ({ spaceIds }: { spaceIds: string[] }) => <div>invite link for {spaceIds.join(',')}</div>,
}))
let policy: 'members' | 'admins' = 'members'
vi.mock('@/hooks/use-org-settings', () => ({
    useOrgSettings: () => ({ invitePolicy: policy }),
    canInvite: (settings: { invitePolicy: string }, isAdmin: boolean) => settings.invitePolicy === 'members' || isAdmin,
}))
afterEach(() => { cleanup(); policy = 'members' })

const org = { id: 'o', memberId: 'me', spaces: [], directs: [] } as unknown as OrgWithSpaces
const space = { id: 's', name: 'Weekend trip', kind: 'shared' } as unknown as spaces.Space
const me = { id: 'me', displayName: 'Priya', kind: 'human', role: 'member' } as spaces.Member
const ro = { id: 'ro', displayName: 'Ro', kind: 'agent', agentKind: 'jev' } as spaces.Member
const claude = { id: 'cc', displayName: 'Claude Code', kind: 'agent', agentKind: 'claude-code' } as spaces.Member

it('leads with Add agents, which opens the agent chooser, and keeps Invite people second', () => {
    render(<EmptySpacePrompt org={org} space={space} roster={[me, ro]} selfIsAdmin={false} writable />)
    expect(screen.getByRole('heading', { name: 'Add your agents' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Add agents' }))
    expect(screen.getByRole('dialog', { name: 'agents:choose' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Invite people' }))
    expect(screen.getByText('invite link for s')).toBeVisible()
})

it('hides Invite people when only admins may invite', () => {
    policy = 'admins'
    render(<EmptySpacePrompt org={org} space={space} roster={[me]} selfIsAdmin={false} writable />)
    expect(screen.getByRole('button', { name: 'Add agents' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Invite people' })).toBeNull()
})

it('once an agent is in, says how to give it work and still offers the next one', () => {
    render(<EmptySpacePrompt org={org} space={space} roster={[me, claude]} selfIsAdmin={false} writable />)
    expect(screen.getByRole('heading', { name: 'Claude Code is here' })).toBeVisible()
    expect(screen.getByText('Mention Claude Code to give it work.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Add another agent' }))
    expect(screen.getByRole('dialog', { name: 'agents:choose' })).toBeInTheDocument()
})

it('offers nothing to someone who can only read the space', () => {
    render(<EmptySpacePrompt org={org} space={space} roster={[me]} selfIsAdmin={false} writable={false} />)
    expect(screen.getByText('Nothing here yet.')).toBeVisible()
    expect(screen.queryByRole('button')).toBeNull()
})
