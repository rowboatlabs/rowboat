import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpaceAccessContext, canActInSpace, setSpacePreview } from './spaces-access'
import { invokeSpace } from './spaces-invoke'
import { dropSpaceReadState, forgetOrg, getSpaceReadState, markStreamRead, markThreadRead, noteStreamReadOffset, noteThread } from './spaces-read-state'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SpaceBrowser } from '@/components/spaces/space-browser'
import { JoinSpacePrompt } from './spaces-access'
import { getDirectorySpace, loadSpaceDirectory, updateDirectoryMembership } from '@/hooks/use-space-directory'
import type { spaces } from '@x/shared'

vi.mock('@/lib/spaces-feed', () => ({ subscribeSpacesFeed: () => () => {} }))
const open = { id: 'open', kind: 'shared', visibility: 'open', name: 'Design', createdAt: '2026-09-28T00:00:00Z' } as spaces.Space
const invoke = vi.fn()
beforeEach(() => {
    vi.stubGlobal('ipc', { invoke })
    invoke.mockReset().mockResolvedValue({})
    forgetOrg('preview')
    setSpacePreview('preview', 'open', true)
})
afterEach(() => { cleanup(); setSpacePreview('preview', 'open', false); vi.useRealTimers() })

describe('open-space preview boundary', () => {
    it('reads content but refuses retained mutation callbacks before IPC', async () => {
        await invokeSpace('spaces:listStream', { orgId: 'preview', spaceId: 'open' })
        expect(invoke).toHaveBeenCalledTimes(1)
        await expect(invokeSpace('spaces:postMessage', { orgId: 'preview', spaceId: 'open', body: 'hello' })).rejects.toThrow('Join this space')
        await expect(invokeSpace('spaces:whiteboard', { orgId: 'preview', spaceId: 'open', boardId: 'board', payload: { t: 'scene_request', clientId: 'client' } })).rejects.toThrow('Join this space')
        await expect(invokeSpace('spaces:addMembers', { orgId: 'preview', spaceId: 'open', memberIds: ['other'] })).rejects.toThrow('Join this space')
        expect(invoke).toHaveBeenCalledTimes(1)
    })
    it('does not manufacture personal state from content responses or marks', () => {
        noteStreamReadOffset('preview', 'open', 20)
        noteThread('preview', 'open', 'root', { following: true, readOffset: 20 })
        markStreamRead('preview', 'open', 30)
        markThreadRead('preview', 'open', 'root', 30)
        expect(getSpaceReadState('preview', 'open')).toBeUndefined()
        expect(invoke).not.toHaveBeenCalled()
    })
    it('cancels queued marks on removal and enables explicit join', async () => {
        vi.useFakeTimers()
        setSpacePreview('preview', 'open', false)
        markStreamRead('preview', 'open', 30)
        setSpacePreview('preview', 'open', true)
        dropSpaceReadState('preview', 'open')
        await vi.advanceTimersByTimeAsync(2000)
        expect(invoke).not.toHaveBeenCalled()
        updateDirectoryMembership('preview', open, true)
        await invokeSpace('spaces:postMessage', { orgId: 'preview', spaceId: 'open', body: 'joined' })
        expect(invoke).toHaveBeenCalledTimes(1)
    })
    it('does not expose a private space through the discovery cache after removal', () => {
        updateDirectoryMembership('preview', { ...open, visibility: 'private' }, false)
        expect(getDirectorySpace('preview', 'open')).toBeUndefined()
    })
    it('does not accept a discovery response that predates a join', async () => {
        let resolve!: (value: unknown) => void
        invoke.mockImplementationOnce(() => new Promise(r => { resolve = r }))
            .mockResolvedValue({ supported: true, spaces: [{ space: open, joined: true }] })
        const request = loadSpaceDirectory('race')
        updateDirectoryMembership('race', open, true)
        resolve({ supported: true, spaces: [{ space: open, joined: false }] })
        await request
        expect(canActInSpace('race', 'open')).toBe(true)
    })
    it('offers an explicit join action and disables it while pending', () => {
        const join = vi.fn()
        const { rerender } = render(<SpaceAccessContext.Provider value={{ member: false, join, joining: false }}><JoinSpacePrompt /></SpaceAccessContext.Provider>)
        fireEvent.click(screen.getByRole('button', { name: 'Join space' }))
        expect(join).toHaveBeenCalledTimes(1)
        rerender(<SpaceAccessContext.Provider value={{ member: false, join, joining: true }}><JoinSpacePrompt /></SpaceAccessContext.Provider>)
        expect(screen.getByRole('button', { name: 'Joining…' })).toBeDisabled()
    })
    it('searches the directory and opens a preview without joining', async () => {
        invoke.mockResolvedValue({ supported: true, spaces: [{ space: open, joined: false }, { space: { ...open, id: 'other', name: 'Engineering' }, joined: true }] })
        const onOpenSpace = vi.fn()
        await act(async () => { render(<SpaceBrowser orgId="browser" onOpenSpace={onOpenSpace} active />) })
        expect(screen.getByText('Joined')).toBeInTheDocument()
        fireEvent.change(screen.getByRole('textbox', { name: 'Search spaces' }), { target: { value: 'DESIGN' } })
        expect(screen.queryByText('Engineering')).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Design Preview' }))
        expect(onOpenSpace).toHaveBeenCalledWith('browser', 'open')
        expect(invoke.mock.calls.every(([channel]) => channel === 'spaces:browseSpaces')).toBe(true)
    })
})
