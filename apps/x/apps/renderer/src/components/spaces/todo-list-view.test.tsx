import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { FileColumn } from './files-tab'

vi.mock('@/components/markdown-editor', () => ({ MarkdownEditor: () => null }))
vi.mock('./document-viewer', () => ({ SpaceDocumentViewer: () => null }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
vi.mock('react-tweet', () => ({ Tweet: () => null }))

const org = { id: 'org', address: 'spaces.example.com' } as OrgWithSpaces
const space = { id: 'space', name: 'Team' } as spaces.Space
const invoke = vi.fn()
const original = '## Backlog\n- [ ] Draft pricing\n- [ ] Fix replicas\n\n## Doing\n- [ ] Mobile files\n'
let asset: spaces.ReadAssetResult

beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    asset = { id: 'list', path: 'todos/launch.md', version: 3, content: original, recentHistory: [] }
    invoke.mockImplementation(async (channel, args) => {
        if (channel === 'spaces:readAsset') return { ...asset }
        if (channel === 'spaces:listMembers') return { members: [] }
        if (channel === 'spaces:proposeChange') {
            asset = { ...asset, content: args.input.newContent, version: asset.version + 1 }
            return { outcome: 'applied', version: asset.version }
        }
        throw new Error(`Unexpected channel ${channel}`)
    })
    window.ipc = { ...window.ipc, invoke } as typeof window.ipc
})
afterEach(cleanup)

const column = () => <FileColumn org={org} space={space} assetId="list" memberNames={new Map()} refreshTick={0} onChanged={vi.fn()} />

describe('todo list files', () => {
    it('opens in the todo editor with its sections and items', async () => {
        render(column())
        expect(await screen.findByRole('heading', { name: 'Backlog' })).toBeInTheDocument()
        expect(screen.getByRole('heading', { name: 'Doing' })).toBeInTheDocument()
        expect(screen.getByText('Mobile files')).toBeInTheDocument()
        expect(screen.getByRole('radio', { name: /Document/ })).toHaveAttribute('aria-checked', 'true')
    })

    it('ticks an item by rewriting only its line', async () => {
        render(column())
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Mark "Fix replicas" done' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:proposeChange', {
            orgId: 'org', spaceId: 'space',
            input: { assetId: 'list', baseVersion: 3, newContent: original.replace('- [ ] Fix replicas', '- [x] Fix replicas') },
        }))
    })

    it('adds an item to a section', async () => {
        render(column())
        await screen.findByRole('heading', { name: 'Doing' })
        fireEvent.click(screen.getAllByRole('button', { name: /Add item/ })[1]!)
        const input = screen.getByRole('textbox', { name: 'New item' })
        fireEvent.change(input, { target: { value: 'Ship it' } })
        fireEvent.keyDown(input, { key: 'Enter' })
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:proposeChange', {
            orgId: 'org', spaceId: 'space',
            input: { assetId: 'list', baseVersion: 3, newContent: `${original}- [ ] Ship it\n` },
        }))
    })

    it('re-applies the action to the current text after a conflict', async () => {
        const theirs = original.replace('## Doing\n', '## Doing\n- [ ] Their new item\n')
        let first = true
        invoke.mockImplementation(async (channel, args) => {
            if (channel === 'spaces:readAsset') return { ...asset }
            if (channel === 'spaces:listMembers') return { members: [] }
            if (channel === 'spaces:proposeChange') {
                if (first) {
                    first = false
                    return { outcome: 'conflict', currentVersion: 4, currentContent: theirs, regions: [], recentHistory: [] }
                }
                asset = { ...asset, content: args.input.newContent, version: 5 }
                return { outcome: 'applied', version: 5 }
            }
            throw new Error(`Unexpected channel ${channel}`)
        })
        render(column())
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Mark "Mobile files" done' }))
        await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:proposeChange', {
            orgId: 'org', spaceId: 'space',
            input: { assetId: 'list', baseVersion: 4, newContent: theirs.replace('- [ ] Mobile files', '- [x] Mobile files') },
        }))
        expect(await screen.findByText('Their new item')).toBeInTheDocument()
    })

    it('remembers the board view per reader, without touching the file', async () => {
        render(column())
        fireEvent.click(await screen.findByRole('radio', { name: /Board/ }))
        expect(screen.getByRole('radio', { name: /Board/ })).toHaveAttribute('aria-checked', 'true')
        expect(localStorage.getItem('spaces:todo-view:org/space/list')).toBe('board')
        expect(invoke).not.toHaveBeenCalledWith('spaces:proposeChange', expect.anything())
    })
})
