import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import { createSpaceFileSource } from './space-file-source'

const blob = { hash: 'a'.repeat(64), size: 4, mime: 'application/octet-stream' }
const asset = (path = 'report.docx', version = 3) => ({ path, version, content: '', blob, recentHistory: [] }) as spaces.ReadAssetResult
const invoke = vi.fn()
beforeEach(() => {
  window.ipc = { ...window.ipc, invoke } as typeof window.ipc
  invoke.mockReset()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer })))
})
function handlers(result: unknown) {
  invoke.mockImplementation(async (channel) => {
    if (channel === 'spaces:readAsset') return asset()
    if (channel === 'spaces:uploadBlob') return { blob: { ...blob, hash: 'b'.repeat(64) } }
    if (channel === 'spaces:proposeChange') return result
    throw new Error(`Unexpected channel ${channel}`)
  })
}
describe('space document storage', () => {
  it('reads binary bytes and advances the Word edit base after successful saves', async () => {
    handlers({ outcome: 'applied', version: 4 })
    const changed = vi.fn()
    const source = createSpaceFileSource('org', 'space', asset(), changed)
    expect(await source.read({ path: 'report.docx', encoding: 'base64' })).toMatchObject({ data: 'AQIDBA==', etag: '3' })
    await source.write({ path: 'report.docx', data: 'BQ==', opts: { encoding: 'base64' } })
    expect(invoke).toHaveBeenLastCalledWith('spaces:proposeChange', expect.objectContaining({ input: expect.objectContaining({ baseVersion: 3, blob: 'b'.repeat(64) }) }))
    await source.write({ path: 'report.docx', data: 'Bg==', opts: { encoding: 'base64' } })
    expect(invoke).toHaveBeenLastCalledWith('spaces:proposeChange', expect.objectContaining({ input: expect.objectContaining({ baseVersion: 4 }) }))
    expect(changed).toHaveBeenCalledTimes(2)
  })
  it('keeps the old edit base on conflict so retry cannot overwrite concurrent changes', async () => {
    handlers({ outcome: 'conflict', currentVersion: 8 })
    const changed = vi.fn()
    const source = createSpaceFileSource('org', 'space', asset(), changed)
    for (let i = 0; i < 2; i++) await expect(source.write({ path: 'report.docx', data: 'AA==', opts: { encoding: 'base64' } })).rejects.toThrow('ETag mismatch')
    expect(invoke.mock.calls.filter(([channel]) => channel === 'spaces:proposeChange').map(([, args]) => args.input.baseVersion)).toEqual([3, 3])
    expect(changed).not.toHaveBeenCalled()
  })
  it('uses the PowerPoint snapshot etag even after a newer read', async () => {
    handlers({ outcome: 'applied', version: 4 })
    const source = createSpaceFileSource('org', 'space', asset('slides.pptx'), vi.fn())
    await source.read({ path: 'slides.pptx', encoding: 'base64' })
    await source.write({ path: 'slides.pptx', data: 'AA==', opts: { encoding: 'base64', expectedEtag: '2' } })
    expect(invoke).toHaveBeenLastCalledWith('spaces:proposeChange', expect.objectContaining({ input: expect.objectContaining({ assetPath: 'slides.pptx', baseVersion: 2 }) }))
  })
  it('pins spreadsheet paging and search to the same space and version', async () => {
    invoke.mockResolvedValue({})
    const source = createSpaceFileSource('org', 'space', asset('budget.xlsx'), vi.fn())
    await source.loadSheet({ path: 'budget.xlsx', offset: 500, limit: 500 })
    await source.findCells({ path: 'budget.xlsx', query: 'Total' })
    for (const [, args] of invoke.mock.calls) expect(args.space).toEqual({ orgId: 'org', spaceId: 'space', version: 3 })
  })
  it('notifies editors about external versions but ignores their own save echo', async () => {
    handlers({ outcome: 'applied', version: 4 })
    const source = createSpaceFileSource('org', 'space', asset(), vi.fn())
    const listener = vi.fn()
    const unsubscribe = source.subscribe!(listener)
    source.notifyChanged!(3)
    await source.write({ path: 'report.docx', data: 'AA==', opts: { encoding: 'base64' } })
    source.notifyChanged!(4)
    expect(listener).not.toHaveBeenCalled()
    source.notifyChanged!(5)
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
    source.notifyChanged!(6)
    expect(listener).toHaveBeenCalledOnce()
  })
  it('uses encoded space URLs for HTML and blob URLs for media', () => {
    expect(createSpaceFileSource('org', 'space', asset('web/my page.html'), vi.fn()).url('')).toBe('app://space-document/org/space/web/my%20page.html')
    expect(createSpaceFileSource('org', 'space', asset('report.pdf'), vi.fn()).url('')).toBe(`app://space-blob/org/space/${blob.hash}`)
  })
})
