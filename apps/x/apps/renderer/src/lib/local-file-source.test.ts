import { afterEach, expect, it, vi } from 'vitest'
import { createLocalFileSource } from './local-file-source'
afterEach(() => vi.unstubAllGlobals())
it('reads the selected local file through the shared viewer source and keeps spreadsheet paging on that file', async () => {
  const invoke = vi.fn().mockResolvedValue({})
  Object.assign(window, { ipc: { invoke } })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }))
  const source = createLocalFileSource({ url: 'app://file-preview/token', path: '/outside/budget.xlsx', name: 'budget.xlsx', size: 3, mtimeMs: 123 })
  expect(source.readOnly).toBe(true)
  expect(await source.read({ path: 'budget.xlsx', encoding: 'base64' })).toMatchObject({ data: 'AQID' })
  await source.loadSheet({ path: 'budget.xlsx', offset: 0, limit: 100 })
  expect(invoke).toHaveBeenCalledWith('spreadsheet:load', { path: '/outside/budget.xlsx', offset: 0, limit: 100 })
  await expect(source.write({ path: 'budget.xlsx', data: 'bad' })).rejects.toThrow('read-only')
})
