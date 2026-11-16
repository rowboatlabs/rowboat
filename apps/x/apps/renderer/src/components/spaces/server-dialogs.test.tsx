import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ServerDialogs } from './server-dialogs'
import { consumeServerDialog, openServerDialog } from '@/lib/server-dialog'

// Joining with a link (2026-11-09: the one server dialog left — there is no
// server to create): the card names the group, or the person whose link it
// is, and Join lands there.

vi.mock('@/hooks/use-spaces', () => ({
    useSpacesAccountState: () => ({ hasSession: true }),
    refreshSpacesOrgs: vi.fn(async () => {}),
}))

beforeEach(() => {
    vi.stubGlobal('ipc', { invoke: vi.fn(async () => ({})) })
})
afterEach(() => {
    cleanup()
    consumeServerDialog()
    vi.unstubAllGlobals()
})

it('joining an invite that lands nowhere opens the last chat', async () => {
    const onDone = vi.fn()
    const invoke = vi.fn(async (channel: string) => {
        if (channel === 'spaces:resolveInviteLink') return { baseUrl: 'https://acme.test', resolved: { state: 'ok' } }
        if (channel === 'spaces:joinInvite') return { org: { id: 'server', name: 'Spaces' } }
        return { orgs: [] }
    })
    vi.stubGlobal('ipc', { invoke })
    render(<ServerDialogs onDone={onDone} />)
    await act(async () => {
        openServerDialog({ kind: 'join', inviteUrl: 'https://acme.test/join/tok', autoJoin: true })
    })
    await act(async () => {})
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith('server', undefined))
})

// Back from a sign-in that Join started (the web app, 2026-10-15): the card
// joins without a second click; any other opening waits for one.
it.each([
    [true, 1],
    [false, 0],
])('with autoJoin %s, joins %i time(s) once the invite resolves', async (autoJoin, joins) => {
    const invoke = vi.fn(async (channel: string) => {
        if (channel === 'spaces:resolveInviteLink') return { baseUrl: 'https://acme.test', resolved: { state: 'ok', space: { id: 's', name: 'launch' }, invitedBy: 'Gagan' } }
        if (channel === 'spaces:joinInvite') return { org: { id: 'server', name: 'Spaces' }, space: { id: 's', name: 'launch' } }
        return {}
    })
    vi.stubGlobal('ipc', { invoke })
    render(<ServerDialogs onDone={vi.fn()} />)
    await act(async () => {
        openServerDialog({ kind: 'join', inviteUrl: 'https://acme.test/join/tok', autoJoin })
    })
    await act(async () => {})
    expect(invoke.mock.calls.filter(([channel]) => channel === 'spaces:joinInvite')).toHaveLength(joins)
    // An invite is to one group (2026-11-09): the card names it and who sent it.
    if (!autoJoin) {
        expect(screen.getByText('#launch')).toBeVisible()
        expect(screen.getByText('Gagan invited you to this space')).toBeVisible()
    }
})

it('a person’s link says whose direct message it opens', async () => {
    const invoke = vi.fn(async (channel: string) => {
        if (channel === 'spaces:resolveInviteLink') return { baseUrl: 'https://acme.test', resolved: { state: 'ok', direct: { id: 'g', displayName: 'Gagan' } } }
        return {}
    })
    vi.stubGlobal('ipc', { invoke })
    render(<ServerDialogs onDone={vi.fn()} />)
    await act(async () => {
        openServerDialog({ kind: 'join', inviteUrl: 'https://acme.test/join/tok' })
    })
    await act(async () => {})
    expect(screen.getByText('Gagan')).toBeVisible()
    expect(screen.getByText(/Opens a direct message with them/)).toBeVisible()
})
