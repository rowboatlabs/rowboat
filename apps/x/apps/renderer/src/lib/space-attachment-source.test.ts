import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSpaceAttachmentSource } from './space-attachment-source'

const hash = 'a'.repeat(64)
const src = `app://space-blob/org/space/${hash}`
const invoke = vi.fn()
beforeEach(() => {
  window.ipc = { ...window.ipc, invoke } as typeof window.ipc
  invoke.mockReset()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer }))
})
afterEach(() => vi.unstubAllGlobals())

describe('message attachment document storage', () => {
  it('reads an immutable attachment without looking up or creating an asset', async () => {
    const source = createSpaceAttachmentSource(src, 'notes.docx')
    expect(source.readOnly).toBe(true)
    expect(await source.read({ path: 'notes.docx', encoding: 'base64' })).toMatchObject({ data: 'AQIDBA==', etag: hash })
    expect(await source.stat({ path: 'notes.docx' })).toMatchObject({ size: 4 })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(invoke).not.toHaveBeenCalled()
    await expect(source.write({ path: 'notes.docx', data: 'changed' })).rejects.toThrow('Save this attachment')
    expect(invoke).not.toHaveBeenCalled()
  })
  it('pins spreadsheet paging and search to the attachment hash', async () => {
    invoke.mockResolvedValue({})
    const source = createSpaceAttachmentSource(src, 'budget.xlsx')
    await source.loadSheet({ path: 'budget.xlsx', offset: 500, limit: 500 })
    await source.findCells({ path: 'budget.xlsx', query: 'Total' })
    for (const [, args] of invoke.mock.calls) {
      expect(args.attachment).toEqual({ orgId: 'org', spaceId: 'space', hash })
      expect(args.space).toBeUndefined()
    }
  })
})
