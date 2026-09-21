// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { BrowserViewManager } from '../../../main/src/browser/view'
import { ElectronBrowserControlService } from '../../../main/src/browser/control-service'

vi.mock('../../../main/src/browser/view', () => ({ browserViewManager: {} }))
vi.mock('@x/core/dist/application/browser-skills/index.js', () => ({ ensureLoaded: vi.fn(), matchSkillsForUrl: vi.fn() }))

function setup() {
  let active = 'A'
  const existing = new Set(['A', 'B'])
  let finish!: () => void
  const pending = new Promise<void>((resolve) => { finish = resolve })
  const manager = {
    getState: () => ({ activeTabId: active, tabs: [] }),
    resolveTabId: vi.fn((id?: string) => {
      const target = id ?? active
      if (!existing.has(target)) throw new Error(`Browser tab ${target} is no longer available.`)
      return target
    }),
    ensureActiveTabReady: vi.fn(async (_signal: unknown, id: string) => {
      if (!existing.has(id)) throw new Error(`Browser tab ${id} is no longer available.`)
    }),
    navigate: vi.fn(async () => { await pending; return { ok: true } }),
    newTab: vi.fn(async () => { await pending; return { ok: true, tabId: 'A' } }),
    readPage: vi.fn(async ({ tabId }: { tabId: string }) => ({
      ok: true, page: { tabId, snapshotId: 'snapshot', url: `https://example.com/${tabId}`, title: tabId, loading: false, text: '', elements: [] },
    })),
    reload: vi.fn(() => ({ ok: false, error: 'Reload rejected' })),
  }
  const service = new ElectronBrowserControlService(manager as unknown as BrowserViewManager, async () => undefined)
  return { service, manager, finish, existing, switchTab: () => { active = 'B' } }
}

describe('browser tool tab targeting', () => {
  it('captures the legacy active tab before navigation and observes that tab afterward', async () => {
    const { service, manager, finish, switchTab } = setup()
    const pending = service.execute({ action: 'navigate', target: 'https://example.com' })
    switchTab()
    finish()
    const result = await pending
    expect(manager.navigate).toHaveBeenCalledWith('https://example.com', 'A')
    expect(result.page?.tabId).toBe('A')
    expect(result.browser.activeTabId).toBe('B')
  })

  it('honors an explicit inactive tab instead of silently using the active one', async () => {
    const { service, manager, finish } = setup()
    const pending = service.execute({ action: 'navigate', tabId: 'B', target: 'https://example.com' })
    finish()
    expect((await pending).page?.tabId).toBe('B')
    expect(manager.navigate).toHaveBeenCalledWith('https://example.com', 'B')
  })

  it('uses the new tab id returned by creation even if the user switches tabs', async () => {
    const { service, finish, switchTab } = setup()
    const pending = service.execute({ action: 'new-tab', target: 'https://example.com' })
    switchTab()
    finish()
    expect((await pending).page?.tabId).toBe('A')
  })

  it('returns an error when a target closes during the operation', async () => {
    const { service, manager, finish, existing, switchTab } = setup()
    const pending = service.execute({ action: 'navigate', target: 'https://example.com' })
    existing.delete('A')
    switchTab()
    finish()
    expect(await pending).toMatchObject({ success: false, error: 'Browser tab A is no longer available.' })
    expect(manager.readPage).not.toHaveBeenCalled()
  })

  it('rejects unknown ids and does not turn reload errors into success', async () => {
    const { service, manager } = setup()
    expect(await service.execute({ action: 'navigate', tabId: 'gone', target: 'https://example.com' })).toMatchObject({ success: false })
    expect(manager.navigate).not.toHaveBeenCalled()
    expect(await service.execute({ action: 'reload', tabId: 'A' })).toMatchObject({ success: false, error: 'Reload rejected' })
    expect(manager.readPage).not.toHaveBeenCalled()
  })
})
