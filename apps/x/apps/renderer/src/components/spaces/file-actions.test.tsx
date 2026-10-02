import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { FileColumn, FileTree } from './files-tab'

vi.mock('@/components/markdown-editor', () => ({ MarkdownEditor: () => null }))
vi.mock('@/components/rich-markdown-viewer', () => ({ RichMarkdownViewer: () => null }))
vi.mock('./document-viewer', () => ({ SpaceDocumentViewer: () => null }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

const org = { id: 'org', address: 'spaces.example.com' } as OrgWithSpaces
const space = { id: 'space', name: 'Team' } as spaces.Space
const invoke = vi.fn()
const writeText = vi.fn()
const ref = { orgId: org.id, spaceId: space.id, assetId: 'file' }

beforeEach(() => {
  vi.clearAllMocks()
  window.ipc = { ...window.ipc, invoke } as typeof window.ipc
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const files = [
  { path: 'notes.md', content: '# Original source', label: 'Copy Markdown' },
  { path: 'notes.txt', content: 'Original text', label: 'Copy content' },
  { path: 'report.pdf', content: '', blob: { hash: 'a'.repeat(64), size: 12, mime: 'application/pdf' }, label: null },
  { path: 'archive.zip', content: '', blob: { hash: 'b'.repeat(64), size: 12, mime: 'application/zip' }, label: null },
]

for (const surface of ['list context menu', 'list actions', 'open file actions'] as const) {
  describe(surface, () => {
    async function openMenu(file: typeof files[number]) {
      const asset = { id: 'file', version: 1, recentHistory: [], ...file }
      invoke.mockImplementation(async (channel: string) => {
        if (channel === 'spaces:readAsset') return asset
        if (channel === 'spaces:saveAsset') return { saved: true }
        throw new Error(`Unexpected channel ${channel}`)
      })
      if (surface === 'open file actions') {
        render(<FileColumn org={org} space={space} assetId="file" memberNames={new Map()} refreshTick={0} onChanged={vi.fn()} />)
      } else {
        render(<FileTree orgId={org.id} orgAddress={org.address} spaceId={space.id}
          entries={[{ ...asset, updatedAt: '' }]} selectedAssetId={null} unreadAssetIds={new Set()}
          onOpenFile={vi.fn()} creating={null} onCreateFile={vi.fn()} onCancelCreate={vi.fn()} />)
      }
      if (surface === 'list context menu') {
        fireEvent.contextMenu(screen.getByRole('button', { name: new RegExp(file.path) }), { button: 2 })
      } else {
        fireEvent.keyDown(await screen.findByRole('button', { name: 'File actions' }), { key: 'Enter' })
      }
    }

    it.each(files)('offers Download for $path and only applicable copy actions', async (file) => {
      await openMenu(file)
      expect(screen.queryByRole('menuitem', { name: 'Copy Markdown' }) !== null).toBe(file.label === 'Copy Markdown')
      expect(screen.queryByRole('menuitem', { name: 'Copy content' }) !== null).toBe(file.label === 'Copy content')
      fireEvent.click(screen.getByRole('menuitem', { name: 'Download' }))
      await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:saveAsset', ref))
    })

    it('copies the contents without opening the file first', async () => {
      await openMenu(files[0])
      fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Markdown' }))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('# Original source'))
    })
  })
}
