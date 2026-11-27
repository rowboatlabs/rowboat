// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserMetadataStore } from '../../../main/src/browser/metadata-store'

let root: string
let file: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rowboat-metadata-test-'))
  file = path.join(root, 'browser', 'metadata.json')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(root, { recursive: true, force: true })
})

describe('browser metadata persistence', () => {
  it('creates defaults without changing the existing browser partition', async () => {
    expect(await new BrowserMetadataStore(file).getSettings()).toEqual({ tabRailOpen: false })
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({
      version: 1,
      defaultProfile: { id: 'default', partition: 'persist:rowboat-browser' },
      settings: { tabRailOpen: false },
    })
  })

  it('imports the legacy preference once and keeps saved settings after restart', async () => {
    expect(await new BrowserMetadataStore(file).getSettings(true)).toEqual({ tabRailOpen: true })
    expect(await new BrowserMetadataStore(file).getSettings(false)).toEqual({ tabRailOpen: true })
  })

  it('serializes rapid changes without losing the last update', async () => {
    const store = new BrowserMetadataStore(file)
    await Promise.all([
      store.getSettings(false),
      store.updateSettings({ tabRailOpen: true }),
      store.updateSettings({ tabRailOpen: false }),
      store.updateSettings({ tabRailOpen: true }),
    ])
    expect(await new BrowserMetadataStore(file).getSettings()).toEqual({ tabRailOpen: true })
    expect(await fs.readdir(path.dirname(file))).toEqual(['metadata.json'])
  })

  it.each(['{broken', '{"version":2,"settings":{"tabRailOpen":true}}', '{"version":1}'])(
    'preserves unreadable or unsupported data: %s', async (original) => {
      await fs.mkdir(path.dirname(file))
      await fs.writeFile(file, original)
      const store = new BrowserMetadataStore(file)
      await expect(store.getSettings()).rejects.toThrow('preserved')
      await expect(store.updateSettings({ tabRailOpen: false })).rejects.toThrow('preserved')
      expect(await fs.readFile(file, 'utf8')).toBe(original)
    },
  )

  it('preserves the previous file after a failed replacement and permits retry', async () => {
    const store = new BrowserMetadataStore(file)
    await store.getSettings(false)
    const original = await fs.readFile(file, 'utf8')
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('simulated disk failure'))
    await expect(store.updateSettings({ tabRailOpen: true })).rejects.toThrow('simulated disk failure')
    expect(await fs.readFile(file, 'utf8')).toBe(original)
    expect(await fs.readdir(path.dirname(file))).toEqual(['metadata.json'])
    await store.updateSettings({ tabRailOpen: true })
    expect(await new BrowserMetadataStore(file).getSettings()).toEqual({ tabRailOpen: true })
  })
})
