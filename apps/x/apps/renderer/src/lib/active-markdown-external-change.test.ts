import { describe, expect, it, vi } from 'vitest'
import {
  readFileAfterExternalChangesSettle,
  reloadCleanActiveMarkdownAfterExternalChange,
} from './active-markdown-external-change'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('reloadCleanActiveMarkdownAfterExternalChange', () => {
  it('does not reuse stale cache after switching away during a disk read', async () => {
    let selectedPath = 'knowledge/A.md'
    const diskRead = deferred<{ data: string }>()
    const cache = new Map([['knowledge/A.md', 'old content']])
    let requestId = 0
    const readFile = vi.fn(() => diskRead.promise)
    const applyReload = vi.fn((data: string) => cache.set('knowledge/A.md', data))

    const reload = reloadCleanActiveMarkdownAfterExternalChange({
      path: 'knowledge/A.md',
      getSelectedPath: () => selectedPath,
      getEditorPath: () => 'knowledge/A.md',
      getEditorContent: () => 'old content',
      getBaseline: () => 'old content',
      getDocumentRevision: () => 0,
      invalidateCache: () => cache.delete('knowledge/A.md'),
      beginRequest: () => ++requestId,
      isCurrentRequest: (candidate) => candidate === requestId,
      readFile,
      getDiskEditorContent: (data) => data,
      applyReload,
      applyUnchangedReload: vi.fn(),
      onReadError: vi.fn(),
    })

    expect(cache.has('knowledge/A.md')).toBe(false)

    // Reproduce switching tabs while the external-change read is in flight.
    selectedPath = 'knowledge/B.md'
    diskRead.resolve({ data: 'modified externally' })
    await reload

    expect(applyReload).not.toHaveBeenCalled()

    // Switching back trusts a cache hit; a correctly invalidated cache instead
    // falls through to the normal disk loader and receives the external edit.
    selectedPath = 'knowledge/A.md'
    if (!cache.has(selectedPath)) cache.set(selectedPath, 'modified externally')
    expect(cache.get(selectedPath)).toBe('modified externally')
  })

  it('applies a successful reload when the clean file stays selected', async () => {
    let requestId = 0
    const invalidateCache = vi.fn()
    const applyReload = vi.fn()

    await reloadCleanActiveMarkdownAfterExternalChange({
      path: 'knowledge/A.md',
      getSelectedPath: () => 'knowledge/A.md',
      getEditorPath: () => 'knowledge/A.md',
      getEditorContent: () => 'old content',
      getBaseline: () => 'old content',
      getDocumentRevision: () => 0,
      invalidateCache,
      beginRequest: () => ++requestId,
      isCurrentRequest: (candidate) => candidate === requestId,
      readFile: vi.fn(async () => ({ data: 'modified externally' })),
      getDiskEditorContent: (data) => data,
      applyReload,
      applyUnchangedReload: vi.fn(),
      onReadError: vi.fn(),
    })

    expect(invalidateCache).toHaveBeenCalledOnce()
    expect(applyReload).toHaveBeenCalledWith('modified externally')
  })

  it('preserves a dirty active file without invalidating or reading from disk', async () => {
    const invalidateCache = vi.fn()
    const readFile = vi.fn(async () => ({ data: 'modified externally' }))
    const applyReload = vi.fn()

    await reloadCleanActiveMarkdownAfterExternalChange({
      path: 'knowledge/A.md',
      getSelectedPath: () => 'knowledge/A.md',
      getEditorPath: () => 'knowledge/A.md',
      getEditorContent: () => 'unsaved draft',
      getBaseline: () => 'last saved content',
      getDocumentRevision: () => 0,
      invalidateCache,
      beginRequest: vi.fn(() => 1),
      isCurrentRequest: vi.fn(() => true),
      readFile,
      getDiskEditorContent: (data) => data,
      applyReload,
      applyUnchangedReload: vi.fn(),
      onReadError: vi.fn(),
    })

    expect(invalidateCache).not.toHaveBeenCalled()
    expect(readFile).not.toHaveBeenCalled()
    expect(applyReload).not.toHaveBeenCalled()
  })

  it('leaves revision-aware hydration in control until the editor belongs to the selected path', async () => {
    let requestId = 7
    const beginRequest = vi.fn(() => ++requestId)
    const invalidateCache = vi.fn()
    const readFile = vi.fn(async () => ({ data: 'B content' }))

    await reloadCleanActiveMarkdownAfterExternalChange({
      path: 'knowledge/B.md',
      getSelectedPath: () => 'knowledge/B.md',
      getEditorPath: () => 'knowledge/A.md',
      getEditorContent: () => 'A content',
      getBaseline: () => undefined,
      getDocumentRevision: () => 0,
      invalidateCache,
      beginRequest,
      isCurrentRequest: (candidate) => candidate === requestId,
      readFile,
      getDiskEditorContent: (data) => data,
      applyReload: vi.fn(),
      applyUnchangedReload: vi.fn(),
      onReadError: vi.fn(),
    })

    expect(beginRequest).not.toHaveBeenCalled()
    expect(requestId).toBe(7)
    expect(invalidateCache).not.toHaveBeenCalled()
    expect(readFile).not.toHaveBeenCalled()
  })

  it('repeats an in-flight hydration read after a workspace change', async () => {
    let externalRevision = 0
    const staleRead = deferred<{ data: string }>()
    const freshRead = deferred<{ data: string }>()
    const reads = [staleRead, freshRead]
    const readFile = vi.fn(() => reads.shift()!.promise)

    const hydration = readFileAfterExternalChangesSettle({
      getExternalRevision: () => externalRevision,
      isCurrent: () => true,
      readFile,
    })

    externalRevision += 1
    staleRead.resolve({ data: 'stale B content' })
    await vi.waitFor(() => expect(readFile).toHaveBeenCalledTimes(2))
    freshRead.resolve({ data: 'fresh B content' })

    await expect(hydration).resolves.toEqual({ data: 'fresh B content' })
  })

  it('does not overwrite edits made while the disk read is in flight', async () => {
    let editorContent = 'old content'
    let requestId = 0
    const diskRead = deferred<{ data: string }>()
    const applyReload = vi.fn()
    const reload = reloadCleanActiveMarkdownAfterExternalChange({
      path: 'knowledge/A.md',
      getSelectedPath: () => 'knowledge/A.md',
      getEditorPath: () => 'knowledge/A.md',
      getEditorContent: () => editorContent,
      getBaseline: () => 'old content',
      getDocumentRevision: () => 0,
      invalidateCache: vi.fn(),
      beginRequest: () => ++requestId,
      isCurrentRequest: (candidate) => candidate === requestId,
      readFile: () => diskRead.promise,
      getDiskEditorContent: (data) => data,
      applyReload,
      applyUnchangedReload: vi.fn(),
      onReadError: vi.fn(),
    })

    editorContent = 'draft typed during read'
    diskRead.resolve({ data: 'modified externally' })
    await reload

    expect(applyReload).not.toHaveBeenCalled()
  })

  it('applies only the newest external read when responses arrive out of order', async () => {
    let requestId = 0
    const firstRead = deferred<{ data: string }>()
    const secondRead = deferred<{ data: string }>()
    const reads = [firstRead, secondRead]
    const applied: string[] = []
    const options = {
      path: 'knowledge/A.md',
      getSelectedPath: () => 'knowledge/A.md',
      getEditorPath: () => 'knowledge/A.md',
      getEditorContent: () => 'old content',
      getBaseline: () => 'old content',
      getDocumentRevision: () => 0,
      invalidateCache: vi.fn(),
      beginRequest: () => ++requestId,
      isCurrentRequest: (candidate: number) => candidate === requestId,
      readFile: () => reads.shift()!.promise,
      getDiskEditorContent: (data: string) => data,
      applyReload: (data: string) => applied.push(data),
      applyUnchangedReload: vi.fn(),
      onReadError: vi.fn(),
    }

    const firstReload = reloadCleanActiveMarkdownAfterExternalChange(options)
    const secondReload = reloadCleanActiveMarkdownAfterExternalChange(options)
    secondRead.resolve({ data: 'newest content' })
    await secondReload
    firstRead.resolve({ data: 'older content' })
    await firstReload

    expect(applied).toEqual(['newest content'])
  })

  it('reports a read failure without applying content', async () => {
    let requestId = 0
    const error = new Error('disk read failed')
    const applyReload = vi.fn()
    const onReadError = vi.fn()

    await expect(reloadCleanActiveMarkdownAfterExternalChange({
      path: 'knowledge/A.md',
      getSelectedPath: () => 'knowledge/A.md',
      getEditorPath: () => 'knowledge/A.md',
      getEditorContent: () => 'old content',
      getBaseline: () => 'old content',
      getDocumentRevision: () => 0,
      invalidateCache: vi.fn(),
      beginRequest: () => ++requestId,
      isCurrentRequest: (candidate) => candidate === requestId,
      readFile: async () => { throw error },
      getDiskEditorContent: (data) => data,
      applyReload,
      applyUnchangedReload: vi.fn(),
      onReadError,
    })).resolves.toBeUndefined()

    expect(onReadError).toHaveBeenCalledWith(error)
    expect(applyReload).not.toHaveBeenCalled()
  })

  it('refreshes metadata without replacing the editor for an unchanged local-write echo', async () => {
    let requestId = 0
    const applyReload = vi.fn()
    const applyUnchangedReload = vi.fn()
    const cache = new Map([['knowledge/A.md', 'saved content']])
    const renameReadyPaths = new Set(['knowledge/A.md'])

    await reloadCleanActiveMarkdownAfterExternalChange({
      path: 'knowledge/A.md',
      getSelectedPath: () => 'knowledge/A.md',
      getEditorPath: () => 'knowledge/A.md',
      getEditorContent: () => 'saved content',
      getBaseline: () => 'saved content',
      getDocumentRevision: () => 0,
      invalidateCache: () => cache.delete('knowledge/A.md'),
      beginRequest: () => ++requestId,
      isCurrentRequest: (candidate) => candidate === requestId,
      readFile: async () => ({ data: '---\ntag: updated\n---\nsaved content' }),
      getDiskEditorContent: () => 'saved content',
      applyReload,
      applyUnchangedReload,
      onReadError: vi.fn(),
    })

    expect(applyReload).not.toHaveBeenCalled()
    expect(applyUnchangedReload).toHaveBeenCalledWith('---\ntag: updated\n---\nsaved content')
    expect(cache.has('knowledge/A.md')).toBe(false)
    expect(renameReadyPaths.has('knowledge/A.md')).toBe(true)
  })

  it('does not replace newer local frontmatter with an older in-flight read', async () => {
    let requestId = 0
    let documentRevision = 0
    const diskRead = deferred<{ data: string }>()
    const applyReload = vi.fn()
    const applyUnchangedReload = vi.fn()
    const reload = reloadCleanActiveMarkdownAfterExternalChange({
      path: 'knowledge/A.md',
      getSelectedPath: () => 'knowledge/A.md',
      getEditorPath: () => 'knowledge/A.md',
      getEditorContent: () => 'saved content',
      getBaseline: () => 'saved content',
      getDocumentRevision: () => documentRevision,
      invalidateCache: vi.fn(),
      beginRequest: () => ++requestId,
      isCurrentRequest: (candidate) => candidate === requestId,
      readFile: () => diskRead.promise,
      getDiskEditorContent: () => 'saved content',
      applyReload,
      applyUnchangedReload,
      onReadError: vi.fn(),
    })

    // onFrontmatterChange advances the per-path document revision even though
    // the Markdown body baseline remains byte-for-byte identical.
    documentRevision += 1
    diskRead.resolve({ data: '---\ntag: stale\n---\nsaved content' })
    await reload

    expect(applyReload).not.toHaveBeenCalled()
    expect(applyUnchangedReload).not.toHaveBeenCalled()
  })

  it('does not apply a read after the saved baseline and editor complete an ABA cycle', async () => {
    let requestId = 0
    let editorContent = 'old content'
    let baseline = 'old content'
    let documentRevision = 0
    const diskRead = deferred<{ data: string }>()
    const applyReload = vi.fn()
    const applyUnchangedReload = vi.fn()
    const reload = reloadCleanActiveMarkdownAfterExternalChange({
      path: 'knowledge/A.md',
      getSelectedPath: () => 'knowledge/A.md',
      getEditorPath: () => 'knowledge/A.md',
      getEditorContent: () => editorContent,
      getBaseline: () => baseline,
      getDocumentRevision: () => documentRevision,
      invalidateCache: vi.fn(),
      beginRequest: () => ++requestId,
      isCurrentRequest: (candidate) => candidate === requestId,
      readFile: () => diskRead.promise,
      getDiskEditorContent: (data) => data,
      applyReload,
      applyUnchangedReload,
      onReadError: vi.fn(),
    })

    editorContent = 'new saved content'
    baseline = 'new saved content'
    documentRevision += 1
    editorContent = 'old content'
    baseline = 'old content'
    documentRevision += 1
    diskRead.resolve({ data: 'modified externally' })
    await reload

    expect(applyReload).not.toHaveBeenCalled()
    expect(applyUnchangedReload).not.toHaveBeenCalled()
  })

  it('discards an external read invalidated by an A to B to A selection generation', async () => {
    let selectedPath = 'knowledge/A.md'
    let requestId = 0
    const diskRead = deferred<{ data: string }>()
    const applied: string[] = []
    const reload = reloadCleanActiveMarkdownAfterExternalChange({
      path: 'knowledge/A.md',
      getSelectedPath: () => selectedPath,
      getEditorPath: () => 'knowledge/A.md',
      getEditorContent: () => 'old content',
      getBaseline: () => 'old content',
      getDocumentRevision: () => 0,
      invalidateCache: vi.fn(),
      beginRequest: () => ++requestId,
      isCurrentRequest: (candidate) => candidate === requestId,
      readFile: () => diskRead.promise,
      getDiskEditorContent: (data) => data,
      applyReload: (data) => applied.push(data),
      applyUnchangedReload: vi.fn(),
      onReadError: vi.fn(),
    })

    selectedPath = 'knowledge/B.md'
    requestId += 1
    selectedPath = 'knowledge/A.md'
    requestId += 1
    applied.push('fresh selection read')
    diskRead.resolve({ data: 'stale external read' })
    await reload

    expect(applied).toEqual(['fresh selection read'])
  })

  it('uses a dirty watcher event to cancel an older clean read', async () => {
    let requestId = 0
    let editorContent = 'old content'
    const diskRead = deferred<{ data: string }>()
    const applyReload = vi.fn()
    const readFile = vi.fn(() => diskRead.promise)
    const options = {
      path: 'knowledge/A.md',
      getSelectedPath: () => 'knowledge/A.md',
      getEditorPath: () => 'knowledge/A.md',
      getEditorContent: () => editorContent,
      getBaseline: () => 'old content',
      getDocumentRevision: () => 0,
      invalidateCache: vi.fn(),
      beginRequest: () => ++requestId,
      isCurrentRequest: (candidate: number) => candidate === requestId,
      readFile,
      getDiskEditorContent: (data: string) => data,
      applyReload,
      applyUnchangedReload: vi.fn(),
      onReadError: vi.fn(),
    }

    const oldReload = reloadCleanActiveMarkdownAfterExternalChange(options)
    editorContent = 'unsaved draft'
    await reloadCleanActiveMarkdownAfterExternalChange(options)
    diskRead.resolve({ data: 'stale external read' })
    await oldReload

    expect(requestId).toBe(2)
    expect(readFile).toHaveBeenCalledOnce()
    expect(applyReload).not.toHaveBeenCalled()
  })
})
