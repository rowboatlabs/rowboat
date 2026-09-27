import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copySpaceFile, downloadSpaceFile, spaceFileCopyLabel } from './space-file-actions'
import { toast } from './toast'

vi.mock('./toast', () => ({ toast: vi.fn() }))
const ref = { orgId: 'org', spaceId: 'space', assetId: 'file' }
const blob = (mime: string) => ({ hash: 'a'.repeat(64), size: 12, mime })
const invoke = vi.fn()
const writeText = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  window.ipc = { ...window.ipc, invoke } as typeof window.ipc
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  writeText.mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllGlobals())

describe('copyable space files', () => {
  it.each([
    ['notes.MD', undefined, 'Copy Markdown'],
    ['notes.markdown', blob('text/markdown'), 'Copy Markdown'],
    ['notes.txt', undefined, 'Copy content'],
    ['script.py', blob('application/octet-stream'), 'Copy content'],
    ['data.json', blob('application/json'), 'Copy content'],
    ['data.csv', blob('text/csv; charset=utf-8'), 'Copy content'],
    ['page.html', blob('text/html'), 'Copy content'],
    ['LICENSE', blob('application/octet-stream'), 'Copy content'],
    ['unknown.custom', blob('text/plain'), 'Copy content'],
    ['image.png', blob('image/png'), null],
    ['drawing.svg', blob('image/svg+xml'), null],
    ['report.pdf', blob('application/pdf'), null],
    ['report.docx', blob('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), null],
    ['archive.zip', blob('application/octet-stream'), null],
    ['misleading.md', blob('image/png'), null],
    ['file.unknown', blob('application/octet-stream'), null],
  ] as const)('labels %s with %s correctly', (path, fileBlob, expected) => {
    expect(spaceFileCopyLabel({ path, blob: fileBlob })).toBe(expected)
  })

  it('copies fresh Markdown source, preserving frontmatter and relative links', async () => {
    const content = '---\ntitle: Café\n---\n# Hello\n![pic](./pic.png)\n'
    invoke.mockResolvedValue({ path: 'notes.md', content })
    await copySpaceFile(ref)
    expect(invoke).toHaveBeenCalledWith('spaces:readAsset', ref)
    expect(writeText).toHaveBeenCalledWith(content)
    expect(toast).toHaveBeenCalledWith('Markdown copied', 'success')
  })

  it('copies uploaded text from its blob instead of the empty inline field', async () => {
    invoke.mockResolvedValue({ path: 'notes.txt', content: '', blob: blob('text/plain') })
    const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => 'Uploaded café\n' })
    vi.stubGlobal('fetch', fetch)
    await copySpaceFile(ref)
    expect(fetch).toHaveBeenCalledWith(`app://space-blob/org/space/${'a'.repeat(64)}`)
    expect(writeText).toHaveBeenCalledWith('Uploaded café\n')
  })

  it('reports a failed blob read without overwriting the clipboard', async () => {
    invoke.mockResolvedValue({ path: 'notes.txt', content: '', blob: blob('text/plain') })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    await copySpaceFile(ref)
    expect(writeText).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith('Could not load file contents', 'error')
  })

  it('rechecks copyability after a file changes to binary', async () => {
    invoke.mockResolvedValue({ path: 'notes.md', content: '', blob: blob('application/pdf') })
    await copySpaceFile(ref)
    expect(writeText).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith('This file cannot be copied as text', 'error')
  })

  it('handles clipboard rejection', async () => {
    invoke.mockResolvedValue({ path: 'notes.txt', content: '' })
    writeText.mockRejectedValueOnce(new Error('Clipboard unavailable'))
    await copySpaceFile(ref)
    expect(toast).toHaveBeenCalledWith('Clipboard unavailable', 'error')
  })
})

describe('download feedback', () => {
  it('saves by identity and confirms success', async () => {
    invoke.mockResolvedValue({ saved: true, path: '/downloads/notes.md' })
    await downloadSpaceFile(ref)
    expect(invoke).toHaveBeenCalledWith('spaces:saveAsset', ref)
    expect(toast).toHaveBeenCalledWith('Saved', 'success')
  })

  it('does not report cancellation as success or failure', async () => {
    invoke.mockResolvedValue({ saved: false })
    await downloadSpaceFile(ref)
    expect(toast).not.toHaveBeenCalled()
  })

  it('reports save errors', async () => {
    invoke.mockRejectedValueOnce(new Error('Disk full'))
    await downloadSpaceFile(ref)
    expect(toast).toHaveBeenCalledWith('Disk full', 'error')
  })
})
