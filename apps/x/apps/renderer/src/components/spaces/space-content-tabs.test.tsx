import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type { RailSelection } from '@/lib/spaces-selection'
import { SpaceContentTabs } from './space-content-tabs'

vi.mock('@/lib/spaces-read-state', () => ({
    useReadStateVersion: () => 0,
    streamBadge: () => ({ unread: 4, forYou: 1 }),
    threadBadge: (_org: string, _space: string, root: string, direct: boolean) => root === 'root-new' ? { unread: 3, forYou: direct ? 3 : 2 } : { unread: 0, forYou: 0 },
}))
afterEach(cleanup)

const topics = [
    { id: 'old', rootMessageId: 'root-old', title: 'Older discussion', lastActivityAt: '2026-09-10T10:00:00Z', archived: false },
    { id: 'archived', rootMessageId: 'root-new', title: 'Archived discussion', lastActivityAt: '2026-09-16T10:00:00Z', archived: true },
    { id: 'new', rootMessageId: 'root-new', title: 'Recent discussion', lastActivityAt: '2026-09-15T10:00:00Z', archived: false },
] as spaces.TopicListing[]
const entries: spaces.SpacesAssetEntry[] = [
    { id: 'old', path: 'README.md', version: 1, updatedAt: '2026-09-10T10:00:00Z' },
    { id: 'new', path: 'decisions/launch.md', version: 2, updatedAt: '2026-09-15T10:00:00Z' },
    { id: 'deleted', path: 'deleted.md', version: 3, updatedAt: '2026-09-16T10:00:00Z', state: 'deleted' },
]
function mount({ direct = false, selection = { kind: 'general' } as RailSelection } = {}) {
    const onSelect = vi.fn()
    render(<SpaceContentTabs orgId="org" spaceId="space" direct={direct} topics={topics} entries={entries}
        unreadAssetIds={new Set(['new', 'deleted'])} selection={selection} onSelect={onSelect} />)
    return onSelect
}
const tab = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}`) })

describe('space content tabs', () => {
    it('navigates straight to each view, with no hover menu', () => {
        const onSelect = mount()
        fireEvent.pointerEnter(tab('Threads'), { pointerType: 'mouse' })
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        fireEvent.click(tab('Threads'))
        expect(onSelect).toHaveBeenLastCalledWith({ kind: 'discussions' })
        fireEvent.click(tab('Files'))
        expect(onSelect).toHaveBeenLastCalledWith({ kind: 'files' })
        fireEvent.click(tab('Messages'))
        expect(onSelect).toHaveBeenLastCalledWith({ kind: 'general' })
    })

    it('badges count live discussions and live unread files only', () => {
        mount()
        expect(tab('Messages')).toHaveAccessibleName('Messages 4 unread · 1 for you')
        expect(tab('Threads')).toHaveAccessibleName('Threads 3 unread · 2 for you')
        expect(tab('Files')).toHaveAccessibleName('Files 1 unread · none for you')
    })

    it('uses DM badges in a direct conversation', () => {
        mount({ direct: true })
        expect(tab('Threads')).toHaveAccessibleName('Threads 3 unread · all for you')
    })

    it.each([
        [{ kind: 'general' }, 'Messages'],
        [{ kind: 'thread', rootMessageId: 'root-old' }, 'Threads'],
        [{ kind: 'whiteboard', assetId: 'board' }, 'Files'],
    ] as [RailSelection, string][])('marks the view %o belongs to as current', (selection, label) => {
        mount({ selection })
        expect(tab(label)).toHaveAttribute('aria-current', 'page')
        expect(screen.getAllByRole('button').filter((button) => button.getAttribute('aria-current') === 'page')).toHaveLength(1)
    })
})
