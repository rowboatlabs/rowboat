import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import { SpaceContentTabs } from './space-content-tabs'

vi.mock('@/hooks/use-space-chat', () => ({ prefetchThread: vi.fn() }))
vi.mock('@/lib/spaces-read-state', () => ({
    useReadStateVersion: () => 0,
    streamBadge: () => ({ unread: 4, forYou: 1 }),
    threadBadge: (_org: string, _space: string, root: string, direct: boolean) => root === 'root-new' ? { unread: 3, forYou: direct ? 3 : 2 } : { unread: 0, forYou: 0 },
}))
afterEach(() => { cleanup(); vi.useRealTimers() })

const topics = [
    { id: 'old', rootMessageId: 'root-old', title: 'Older discussion', lastActivityAt: '2026-09-10T10:00:00Z', archived: false },
    { id: 'archived', rootMessageId: 'root-archived', title: 'Archived discussion', lastActivityAt: '2026-09-16T10:00:00Z', archived: true },
    { id: 'new', rootMessageId: 'root-new', title: 'Recent discussion', lastActivityAt: '2026-09-15T10:00:00Z', archived: false },
] as spaces.TopicListing[]
const entries: spaces.SpacesAssetEntry[] = [
    { id: 'old', path: 'README.md', version: 1, updatedAt: '2026-09-10T10:00:00Z' },
    { id: 'new', path: 'decisions/launch.md', version: 2, updatedAt: '2026-09-15T10:00:00Z' },
    { id: 'deleted', path: 'deleted.md', version: 3, updatedAt: '2026-09-16T10:00:00Z', state: 'deleted' },
]
function mount(direct = false, spaceId = 'space') {
    const onSelect = vi.fn()
    render(<SpaceContentTabs orgId="org" orgAddress="spaces.example.com" spaceId={spaceId} direct={direct} topics={topics} entries={entries}
        unreadAssetIds={new Set(['new', 'deleted'])} selection={{ kind: 'general' }} memberNames={new Map()} spaceNames={new Map()}
        onSelect={onSelect} topicsLoaded filesLoaded filesError={null} />)
    return onSelect
}
function hover(label: string) {
    const button = screen.getByRole('button', { name: new RegExp(`^${label}`) })
    fireEvent.pointerEnter(button, { pointerType: 'mouse' })
    act(() => { vi.advanceTimersByTime(120) })
    return button
}

describe('space content menus', () => {
    it.each(['two-person-dm', 'self-dm'])('exposes discussions and files for %s with DM badges', (spaceId) => {
        vi.useFakeTimers()
        const onSelect = mount(true, spaceId)
        const discussions = hover('Discussions')
        expect(within(discussions).getByLabelText('3 unread · all for you')).toBeInTheDocument()
        fireEvent.click(discussions)
        expect(onSelect).toHaveBeenLastCalledWith({ kind: 'discussions' })
        const files = hover('Files')
        expect(screen.getByRole('dialog', { name: 'Recent files' })).toHaveTextContent('launch.md')
        fireEvent.click(files)
        expect(onSelect).toHaveBeenLastCalledWith({ kind: 'files' })
    })

    it('clicking a hovered tab opens the full view, not the menu', () => {
        vi.useFakeTimers()
        const onSelect = mount()
        const button = hover('Discussions')
        expect(onSelect).not.toHaveBeenCalled()
        const menu = screen.getByRole('dialog', { name: 'Recent discussions' })
        const rows = within(menu).getAllByRole('button')
        expect(rows[0]).toHaveTextContent('Recent discussion')
        expect(within(menu).queryByText('Archived discussion')).not.toBeInTheDocument()
        fireEvent.click(button)
        expect(onSelect).toHaveBeenCalledExactlyOnceWith({ kind: 'discussions' })
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('keeps the menu open while crossing into it and selects the exact discussion', () => {
        vi.useFakeTimers()
        const onSelect = mount()
        const button = hover('Discussions')
        fireEvent.pointerLeave(button, { pointerType: 'mouse' })
        act(() => { vi.advanceTimersByTime(100) })
        const menu = screen.getByRole('dialog')
        fireEvent.pointerEnter(menu, { pointerType: 'mouse' })
        act(() => { vi.advanceTimersByTime(300) })
        fireEvent.click(within(menu).getByRole('button', { name: /^Recent discussion/ }))
        expect(onSelect).toHaveBeenCalledExactlyOnceWith({ kind: 'thread', rootMessageId: 'root-new' })
    })

    it('shows recently updated live files and badges, with direct full-view click access', () => {
        vi.useFakeTimers()
        const onSelect = mount()
        const button = hover('Files')
        expect(button).toHaveAccessibleName('Files 1 unread · none for you')
        const menu = screen.getByRole('dialog', { name: 'Recent files' })
        expect(within(menu).getAllByRole('button')[0]).toHaveTextContent('launch.md')
        expect(within(menu).queryByText('deleted.md')).not.toBeInTheDocument()
        fireEvent.click(within(menu).getByRole('button', { name: /launch.md/ }))
        expect(onSelect).toHaveBeenCalledWith({ kind: 'file', assetId: 'new' })
        fireEvent.click(button)
        expect(onSelect).toHaveBeenLastCalledWith({ kind: 'files' })
    })

    it('ignores incidental pointer passes and touch hover', () => {
        vi.useFakeTimers()
        mount()
        const button = screen.getByRole('button', { name: /^Files/ })
        fireEvent.pointerEnter(button, { pointerType: 'mouse' })
        fireEvent.pointerLeave(button, { pointerType: 'mouse' })
        act(() => { vi.advanceTimersByTime(400) })
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        fireEvent.pointerEnter(button, { pointerType: 'touch' })
        act(() => { vi.advanceTimersByTime(400) })
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('opens with Arrow Down and cancels pending hover when clicking', () => {
        vi.useFakeTimers()
        const onSelect = mount()
        const button = screen.getByRole('button', { name: /^Files/ })
        fireEvent.keyDown(button, { key: 'ArrowDown' })
        expect(screen.getByRole('dialog', { name: 'Recent files' })).toBeInTheDocument()
        fireEvent.click(button)
        fireEvent.pointerEnter(button, { pointerType: 'mouse' })
        fireEvent.click(button)
        act(() => { vi.advanceTimersByTime(400) })
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(onSelect).toHaveBeenLastCalledWith({ kind: 'files' })
    })
})
