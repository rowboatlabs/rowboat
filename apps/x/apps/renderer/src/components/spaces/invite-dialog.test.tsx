import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { InviteDialog } from './invite-dialog'

// The org invite (harbor, 2026-10-19): defaults are named, not offered; the
// spaces you are in are offered; the link is minted on Create, with what it
// admits read back from the invite.

const space = (id: string, name: string, extra: Partial<spaces.Space> = {}): spaces.Space => ({
    id, name, createdAt: '2026-10-19T00:00:00.000Z', kind: 'shared', visibility: 'open', archived: false, isDefault: false, ...extra,
})

const org = {
    id: 'o', name: 'Acme', memberId: 'me',
    spaces: [space('lobby', 'lobby', { isDefault: true }), space('launch', 'launch'), space('ops', 'ops', { visibility: 'private' }), space('old', 'old', { archived: true })],
    directs: [], directLabels: {},
} as unknown as OrgWithSpaces

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
})

it('offers the spaces you are in, names the defaults, and mints the link with your choice', async () => {
    const invoke = vi.fn(async (channel: string, args?: unknown) => {
        if (channel === 'spaces:browseSpaces') return { supported: true, spaces: [{ space: space('welcome', 'welcome', { isDefault: true }), joined: false }] }
        if (channel === 'spaces:createInvite') return { token: 't'.repeat(32), link: `https://acme.test/join/${'t'.repeat(32)}` }
        if (channel === 'spaces:resolveInviteLink') return { baseUrl: 'https://acme.test', resolved: { state: 'ok', org: { name: 'Acme' }, spaces: [{ name: 'ops' }, { name: 'lobby' }, { name: 'welcome' }] } }
        return { args }
    })
    vi.stubGlobal('ipc', { invoke })
    await act(async () => { render(<InviteDialog org={org} open onOpenChange={vi.fn()} />) })

    expect(screen.getByText(/Everyone you invite joins #lobby and #welcome/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /launch/ })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /lobby/ })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /old/ })).toBeNull()
    expect(invoke.mock.calls.some(([channel]) => channel === 'spaces:createInvite')).toBe(false)

    fireEvent.click(screen.getByRole('checkbox', { name: /ops/ }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create invite link' })) })

    expect(invoke).toHaveBeenCalledWith('spaces:createInvite', { orgId: 'o', spaceIds: ['ops'] })
    expect(await screen.findByText('Anyone with it can join Acme and #ops, #lobby and #welcome.')).toBeInTheDocument()

    // A new choice takes the link away until it is created again.
    fireEvent.click(screen.getByRole('checkbox', { name: /launch/ }))
    expect(screen.getByRole('button', { name: 'Create invite link' })).toBeInTheDocument()
})
