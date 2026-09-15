import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
    it.each(['create', 'join'] as const)('asks the app-level host for the %s dialog', (kind) => {
        setup()
        fireEvent.click(screen.getByRole('menuitem', { name: kind === 'create' ? 'Create a server' : 'Join a server' }))
        expect(openServerDialog).toHaveBeenCalledWith({ kind })
    })
})
