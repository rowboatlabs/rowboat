import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import { FileTree } from './files-tab'
import { SpaceFilesView } from './space-files-view'

vi.mock('@/components/markdown-editor', () => ({ MarkdownEditor: () => null }))
vi.mock('@/components/rich-markdown-viewer', () => ({ RichMarkdownViewer: () => null }))
vi.mock('./document-viewer', () => ({ SpaceDocumentViewer: () => null }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

afterEach(cleanup)

const entry = (path: string) => ({ id: path, path, version: 1, updatedAt: '' }) as spaces.SpacesAssetEntry
const entries = [entry('README.md'), entry('notes.md'), entry('docs/guide.md'), ...Array.from({ length: 30 }, (_, i) => entry(`file-${i}.md`))]

function renderTree(creating: { prefix: string }) {
    return render(<FileTree orgId="org" orgAddress="spaces.example.com" spaceId="space" entries={entries}
        selectedAssetId={null} unreadAssetIds={new Set()} onOpenFile={vi.fn()}
        creating={creating} onCreateFile={vi.fn()} onCancelCreate={vi.fn()} />)
}

const precedes = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('new file name input', () => {
    it('opens focused at the top of the tree, not below every file', () => {
        renderTree({ prefix: '' })
        const input = screen.getByPlaceholderText('path/to/file.md')
        expect(document.activeElement).toBe(input)
        expect(precedes(input, screen.getByRole('button', { name: /README\.md/ }))).toBe(true)
    })

    it("opens inside the folder it was asked from, above that folder's files", () => {
        renderTree({ prefix: 'docs/' })
        const input = screen.getByPlaceholderText('path/to/file.md') as HTMLInputElement
        expect(input.value).toBe('docs/')
        expect(document.activeElement).toBe(input)
        expect(precedes(screen.getByRole('button', { name: 'docs' }), input)).toBe(true)
        expect(precedes(input, screen.getByRole('button', { name: /guide\.md/ }))).toBe(true)
    })

    it.each(['New file', 'New todo list'])('keeps focus after the New menu closes (%s)', async (item) => {
        const props = { orgId: 'org', orgAddress: 'spaces.example.com', spaceId: 'space', entries, draftFolders: [],
            unreadAssetIds: new Set<string>(), selection: { kind: 'none' } as never, onSelect: vi.fn(),
            onCreateFile: vi.fn(), onCreateBoard: vi.fn(), onCreateTodoList: vi.fn(), onUploadFiles: vi.fn(),
            onOpenTrash: vi.fn(), onAddFolder: vi.fn(), onRemoveFolder: vi.fn() }
        render(<SpaceFilesView {...props} />)
        fireEvent.keyDown(screen.getByRole('button', { name: 'Add to files' }), { key: 'Enter' })
        fireEvent.click(await screen.findByRole('menuitem', { name: item }))
        const input = await screen.findByPlaceholderText(item === 'New file' ? 'path/to/file.md' : 'Todo list name…')
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
        expect(document.activeElement).toBe(input)
    })
})
