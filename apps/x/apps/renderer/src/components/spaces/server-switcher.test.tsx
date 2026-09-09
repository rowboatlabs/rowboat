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
    getSpacesOrgs: () => servers,
}))
vi.mock('@/components/spaces/atoms', () => ({
    OrgMonogram: () => <span>RS</span>,
    AddOrgDialog: ({ open, initialAction, onAdded }: { open: boolean; initialAction: string; onAdded: (id: string, spaceId?: string) => void }) =>
        open ? <button onClick={() => onAdded('two', 'invited-space')}>Complete {initialAction}</button> : null,
}))
afterEach(cleanup)
function setup() {
    const onOpenSpace = vi.fn()
    render(<ServerSwitcher org={servers[0] as unknown as OrgWithSpaces} onOpenSpace={onOpenSpace} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Switch server: Rowboat' }), { key: 'Enter' })
    return onOpenSpace
}
describe('ServerSwitcher', () => {
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
    it.each(['create', 'join'])('opens the %s flow and navigates after success', async (action) => {
        const onOpenSpace = setup()
        fireEvent.click(screen.getByRole('menuitem', { name: action === 'create' ? 'Create a server' : 'Join a server' }))
        fireEvent.click(screen.getByText(`Complete ${action}`))
        await waitFor(() => expect(onOpenSpace).toHaveBeenCalledWith('two', 'invited-space'))
    })
})
