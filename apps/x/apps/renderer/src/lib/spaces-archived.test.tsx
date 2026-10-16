import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { JoinSpacePrompt, SpaceAccessContext, setSpaceArchived } from './spaces-access'
import { invokeSpace } from './spaces-invoke'

// An archived space (harbor #1186, 2026-10-14): members read and keep their
// read marks; writes are refused before IPC, the way the server would.

const invoke = vi.fn()
beforeEach(() => {
    vi.stubGlobal('ipc', { invoke })
    invoke.mockReset().mockResolvedValue({})
    setSpaceArchived('org', 'old', true)
})
afterEach(() => { cleanup(); setSpaceArchived('org', 'old', false) })

describe('archived space', () => {
    it('refuses writes before IPC but lets reads and read marks through', async () => {
        await expect(invokeSpace('spaces:postMessage', { orgId: 'org', spaceId: 'old', body: 'hi' })).rejects.toThrow('This space is archived')
        await expect(invokeSpace('spaces:addMembers', { orgId: 'org', spaceId: 'old', memberIds: ['x'] })).rejects.toThrow('This space is archived')
        expect(invoke).not.toHaveBeenCalled()
        await invokeSpace('spaces:listStream', { orgId: 'org', spaceId: 'old' })
        await invokeSpace('spaces:markRead', { orgId: 'org', spaceId: 'old', offset: 3 })
        expect(invoke).toHaveBeenCalledTimes(2)
    })
    it('writes again once unarchived', async () => {
        setSpaceArchived('org', 'old', false)
        await invokeSpace('spaces:postMessage', { orgId: 'org', spaceId: 'old', body: 'back' })
        expect(invoke).toHaveBeenCalledTimes(1)
    })
    it('replaces the composer with an archived notice, not a join button', () => {
        render(<SpaceAccessContext.Provider value={{ member: true, writable: false, archived: true, join: () => {}, joining: false }}><JoinSpacePrompt /></SpaceAccessContext.Provider>)
        expect(screen.getByText(/This space is archived/)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Join space' })).not.toBeInTheDocument()
    })
})
