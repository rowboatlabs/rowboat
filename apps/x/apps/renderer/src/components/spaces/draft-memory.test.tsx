import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { FileColumn } from './files-tab'
import { clearSpaceDrafts } from '@/lib/space-drafts'

// Stand-in for the rich editor over the same content/onChange contract, so the
// test drives the draft the way typing does.
vi.mock('@/components/markdown-editor', () => ({
  MarkdownEditor: ({ content, onChange }: { content: string; onChange: (text: string) => void }) => (
    <textarea aria-label="editor" value={content} onChange={(e) => onChange(e.target.value)} />
  ),
}))
vi.mock('@/components/rich-markdown-viewer', () => ({ RichMarkdownViewer: () => null }))
vi.mock('./document-viewer', () => ({ SpaceDocumentViewer: () => null }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

const org = { id: 'org', address: 'spaces.example.com' } as OrgWithSpaces
const space = { id: 'space', name: 'Team' } as spaces.Space
const invoke = vi.fn()

const asset = (id: string) => ({ id, version: 1, recentHistory: [], path: `${id}.md`, content: '# Original' })

beforeEach(() => {
  clearSpaceDrafts()
  vi.clearAllMocks()
  invoke.mockImplementation(async (channel: string, args: { assetId: string }) => {
    if (channel === 'spaces:readAsset') return asset(args.assetId)
    if (channel === 'spaces:proposeChange') return { outcome: 'applied', version: 2 }
    throw new Error(`Unexpected channel ${channel}`)
  })
  window.ipc = { ...window.ipc, invoke } as typeof window.ipc
})
afterEach(() => { cleanup(); clearSpaceDrafts() })

// Entries carry the path, as the space's listing does — so the first frame
// already knows this is markdown and renders the editor, not the raw textarea.
const open = (assetId = 'notes') =>
  render(<FileColumn org={org} space={space} assetId={assetId} entries={[{ ...asset(assetId), updatedAt: '' }]}
    memberNames={new Map()} refreshTick={0} onChanged={vi.fn()} />)

/** Open the file, enter edit mode, and type — the state a reader navigates away from. */
async function typeADraft(assetId = 'notes') {
  const view = open(assetId)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  fireEvent.change(screen.getByLabelText('editor'), { target: { value: '# Original plus my edit' } })
  return view
}

describe('unsaved drafts across navigation', () => {
  it('reopens in edit mode on the text as it stood', async () => {
    const { unmount } = await typeADraft()
    unmount()

    open()
    // Edit mode is back before the read resolves — from memory, not the server.
    expect(screen.getByLabelText('editor')).toHaveValue('# Original plus my edit')
    expect(await screen.findByRole('button', { name: /Apply/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('keeps each file to its own draft', async () => {
    const { unmount } = await typeADraft('notes')
    unmount()

    open('other')
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.queryByLabelText('editor')).toBeNull()
  })

  it('does not resurrect a discarded draft', async () => {
    const { unmount } = await typeADraft()
    fireEvent.click(screen.getByRole('button', { name: /Discard/ }))
    unmount()

    open()
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.queryByLabelText('editor')).toBeNull()
  })

  it('does not resurrect an applied draft', async () => {
    const { unmount } = await typeADraft()
    fireEvent.click(screen.getByRole('button', { name: /Apply/ }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:proposeChange', expect.anything()))
    await waitFor(() => expect(screen.queryByLabelText('editor')).toBeNull())
    unmount()

    open()
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.queryByLabelText('editor')).toBeNull()
  })
})
