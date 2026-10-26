import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ServerDialogs } from './server-dialogs'
import { consumeServerDialog, openServerDialog } from '@/lib/server-dialog'
import { AddServerDialog } from './add-server-dialog'
import { useState } from 'react'

function DialogFlow() {
    const [choosing, setChoosing] = useState(true)
    return <>
        {choosing && <AddServerDialog onClose={() => setChoosing(false)} onChoose={(kind) => {
            setChoosing(false)
            openServerDialog({ kind })
        }} />}
        <ServerDialogs onDone={vi.fn()} />
    </>
}

vi.mock('@/hooks/use-spaces', () => ({
    useSpacesAccountState: () => ({ hasSession: true }),
    refreshSpacesAccountState: vi.fn(),
    refreshSpacesOrgs: vi.fn(async () => {}),
}))

beforeEach(() => {
    vi.stubGlobal('ipc', { invoke: vi.fn(async () => ({ apexDomain: 'spaces.example.com' })) })
})
afterEach(() => {
    cleanup()
    consumeServerDialog()
    vi.unstubAllGlobals()
})

it.each([
    ['Create a group chat', 'Create a group chat'],
    ['Join a server', 'Join a server'],
])('routes %s from the chooser to the existing dialog', async (label, destination) => {
    render(<DialogFlow />)
    expect(screen.getByRole('dialog', { name: 'New group chat' })).toBeVisible()
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }))
    })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: destination })).toBeVisible()
    expect(screen.queryByRole('dialog', { name: 'New group chat' })).toBeNull()
})

it('dismisses the chooser without entering either flow', () => {
    render(<DialogFlow />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
})

it('joining an invite that lands nowhere opens the server', async () => {
    const onDone = vi.fn()
    const invoke = vi.fn(async (channel: string) => {
        if (channel === 'spaces:resolveInviteLink') return { baseUrl: 'https://acme.test', resolved: { state: 'ok', org: { name: 'Acme' }, spaces: [] } }
        if (channel === 'spaces:joinInvite') return { org: { id: 'o', name: 'Acme' } }
        return { orgs: [] }
    })
    vi.stubGlobal('ipc', { invoke })
    render(<ServerDialogs onDone={onDone} />)
    await act(async () => {
        openServerDialog({ kind: 'join', inviteUrl: 'https://acme.test/join/tok', autoJoin: true })
    })
    await act(async () => {})
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith('o', undefined))
})

// Back from a sign-in that Join started (the web app, 2026-10-15): the card
// joins without a second click; any other opening waits for one.
it.each([
    [true, 1],
    [false, 0],
])('with autoJoin %s, joins %i time(s) once the invite resolves', async (autoJoin, joins) => {
    const invoke = vi.fn(async (channel: string) => {
        if (channel === 'spaces:resolveInviteLink') return { baseUrl: 'https://acme.test', resolved: { state: 'ok', org: { name: 'Acme' }, space: { name: 'launch' }, spaces: [{ name: 'launch' }, { name: 'general' }] } }
        if (channel === 'spaces:joinInvite') return { org: { id: 'o', name: 'Acme' }, space: { id: 's', name: 'launch' } }
        return {}
    })
    vi.stubGlobal('ipc', { invoke })
    render(<ServerDialogs onDone={vi.fn()} />)
    await act(async () => {
        openServerDialog({ kind: 'join', inviteUrl: 'https://acme.test/join/tok', autoJoin })
    })
    await act(async () => {})
    expect(invoke.mock.calls.filter(([channel]) => channel === 'spaces:joinInvite')).toHaveLength(joins)
    // An invite is to the org (2026-10-19): the card names it, then every space it joins.
    if (!autoJoin) expect(screen.getByText('You’ll join launch and general')).toBeVisible()
})
