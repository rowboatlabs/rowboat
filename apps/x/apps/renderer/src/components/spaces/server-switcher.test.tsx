import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServerSwitcher } from './server-switcher'
import type { OrgWithSpaces } from '@/hooks/use-spaces'

const { servers } = vi.hoisted(() => ({ servers: [
    { id: 'one', name: 'Rowboat', address: 'one.test', spaces: [{ id: 'main' }], directs: [] },
    { id: 'two', name: 'Founders', address: 'two.test', spaces: [{ id: 'main' }], directs: [] },
    { id: 'empty', name: 'New server', address: 'new.test', spaces: [], directs: [] },
] }))
vi.mock('@/hooks/use-spaces', () => ({
    useSpacesOrgs: () => ({ orgs: servers, refresh: async () => {} }),
}))
vi.mock('@/components/spaces/atoms', () => ({
    OrgMonogram: () => <span>RS</span>,
}))
// The dialogs are hosted once in App; the switcher only asks for one by intent.
const { openServerDialog } = vi.hoisted(() => ({ openServerDialog: vi.fn() }))
vi.mock('@/lib/server-dialog', () => ({ openServerDialog }))
afterEach(cleanup)
function setup() {
    const onOpenSpace = vi.fn()
    render(<ServerSwitcher org={servers[0] as unknown as OrgWithSpaces} onOpenSpace={onOpenSpace} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Switch server: Rowboat' }), { key: 'Enter' })
    return onOpenSpace
}
describe('ServerSwitcher', () => {
    it('hosts removal in the org menu and allows cancelling', () => {
        setup()
        fireEvent.click(screen.getByRole('menuitem', { name: 'Remove server' }))
        expect(screen.getByRole('alertdialog')).toBeVisible()
        expect(screen.getByText('Remove Rowboat?')).toBeVisible()
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
        expect(screen.queryByRole('alertdialog')).toBeNull()
        fireEvent.keyDown(screen.getByRole('button', { name: 'Switch server: Rowboat' }), { key: 'Enter' })
        expect(screen.getByRole('menuitem', { name: 'Remove server' })).toBeVisible()
    })
    it('switches servers even when their space IDs match', () => {
        const onOpenSpace = setup()
        fireEvent.click(screen.getByRole('menuitem', { name: /Founders/ }))
        expect(onOpenSpace).toHaveBeenCalledWith('two', 'main')
    })
    it('allows selecting an empty server', () => {
        const onOpenSpace = setup()
        fireEvent.click(screen.getByRole('menuitem', { name: /New server/ }))
        expect(onOpenSpace).toHaveBeenCalledWith('empty', '')
    })
    it('lets a group chat add its first channel, then opens it', async () => {
        const invoke = vi.fn(async () => ({ space: { id: 'design', name: 'design' } }))
        vi.stubGlobal('ipc', { invoke })
        const onOpenSpace = setup()
        fireEvent.click(screen.getByRole('menuitem', { name: 'Add a channel' }))
        fireEvent.change(screen.getByRole('textbox', { name: 'Channel name' }), { target: { value: ' design ' } })
        fireEvent.click(screen.getByRole('button', { name: 'Add channel' }))
        await waitFor(() => expect(onOpenSpace).toHaveBeenCalledWith('one', 'design'))
        expect(invoke).toHaveBeenCalledWith('spaces:createSpace', { orgId: 'one', name: 'design' })
        vi.unstubAllGlobals()
    })
    it('offers Add a channel only to a group chat', () => {
        render(<ServerSwitcher org={servers[2] as unknown as OrgWithSpaces} onOpenSpace={vi.fn()} />)
        fireEvent.keyDown(screen.getByRole('button', { name: 'Switch server: New server' }), { key: 'Enter' })
        expect(screen.queryByRole('menuitem', { name: 'Add a channel' })).toBeNull()
    })
    it.each(['create', 'join'] as const)('asks the app-level host for the %s dialog', (kind) => {
        setup()
        fireEvent.click(screen.getByRole('menuitem', { name: kind === 'create' ? 'Create a group chat' : 'Join a server' }))
        expect(openServerDialog).toHaveBeenCalledWith({ kind })
    })
})
