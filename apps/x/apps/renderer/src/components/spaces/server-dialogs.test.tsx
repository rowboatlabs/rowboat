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
    ['Create a free server', 'Create a server'],
    ['Join a server', 'Join a server'],
])('routes %s from the chooser to the existing dialog', async (label, destination) => {
    render(<DialogFlow />)
    expect(screen.getByRole('dialog', { name: 'Add a server' })).toBeVisible()
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }))
    })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: destination })).toBeVisible()
    expect(screen.queryByRole('dialog', { name: 'Add a server' })).toBeNull()
})

it('dismisses the chooser without entering either flow', () => {
    render(<DialogFlow />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
})
