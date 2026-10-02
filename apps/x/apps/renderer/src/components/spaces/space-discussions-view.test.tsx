import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import { SpaceDiscussionsView } from './space-discussions-view'
import { refreshSpaceFeed } from '@/hooks/use-spaces'
import { toast } from '@/lib/toast'

vi.mock('@/hooks/use-spaces', () => ({ refreshSpaceFeed: vi.fn(async () => {}) }))
vi.mock('@/hooks/use-space-chat', () => ({ prefetchThread: vi.fn() }))
vi.mock('@/lib/spaces-read-state', () => ({ useReadStateVersion: () => 0, threadBadge: () => ({ unread: 0, forYou: 0 }) }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
const invoke = vi.fn(async () => ({}))
beforeEach(() => { Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })
const topics = [
    { id: 'live', rootMessageId: 'root-live', title: 'Launch', archived: false, lastActivityAt: '2026-09-15T10:00:00Z' },
    { id: 'archived', rootMessageId: 'root-archived', title: 'Old launch', archived: true, lastActivityAt: '2026-09-14T10:00:00Z' },
] as spaces.TopicListing[]
function mount() {
    const onOpen = vi.fn()
    render(<SpaceDiscussionsView orgId="org" orgAddress="spaces.example.com" spaceId="dm" direct topics={topics} loaded memberNames={new Map()} spaceNames={new Map()}
        presence={{ working: new Map(), typing: new Map(), here: [] }} onOpen={onOpen} />)
    return onOpen
}
function openOptions(name: string) {
    fireEvent.pointerDown(screen.getByRole('button', { name }), { button: 0, ctrlKey: false })
}
describe('all discussions', () => {
    it('separates active and archived discussions while preserving their destinations', () => {
        const onOpen = mount()
        expect(screen.queryByText('Old launch')).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /^Launch 0 replies/ }))
        expect(onOpen).toHaveBeenCalledWith('root-live')
        fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
        expect(screen.queryByText('Launch', { exact: true })).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /^Old launch 0 replies/ }))
        expect(onOpen).toHaveBeenLastCalledWith('root-archived')
    })
    it('keeps the existing archive action scoped to the selected DM topic', async () => {
        mount()
        openOptions('Options for Launch')
        fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:manageTopic', { orgId: 'org', spaceId: 'dm', topicId: 'live', action: { action: 'archive' } }))
        await waitFor(() => expect(refreshSpaceFeed).toHaveBeenCalledWith('org', 'dm'))
    })
    it('reports a failed lifecycle action instead of hiding the discussion', async () => {
        invoke.mockRejectedValueOnce(new Error('Could not reach server'))
        mount()
        openOptions('Options for Launch')
        fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }))
        await waitFor(() => expect(toast).toHaveBeenCalledWith('Could not reach server', 'error'))
        expect(screen.getByText('Launch', { exact: true })).toBeInTheDocument()
        expect(refreshSpaceFeed).not.toHaveBeenCalled()
    })
})
