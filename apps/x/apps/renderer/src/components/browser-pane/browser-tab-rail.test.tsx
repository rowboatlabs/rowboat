import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserTabRail } from './browser-tab-rail'
import { closeOtherBrowserTabs } from './browser-tab-actions'
import type { BrowserTabState } from '@x/shared/dist/browser-control.js'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
const originalIpc = Object.getOwnPropertyDescriptor(window, 'ipc')
afterEach(() => {
  cleanup()
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
  else Reflect.deleteProperty(navigator, 'clipboard')
  if (originalIpc) Object.defineProperty(window, 'ipc', originalIpc)
  else Reflect.deleteProperty(window, 'ipc')
})

const tabs: BrowserTabState[] = ['First', 'Second', 'Third'].map((title) => ({
  id: title, title, url: `https://example.com/${title}`, favicon: null,
  canGoBack: false, canGoForward: false, loading: false,
}))

function setup(items = tabs) {
  const callbacks = {
    onTogglePin: vi.fn(), onSwitchTab: vi.fn(), onCloseTab: vi.fn(), onCloseOtherTabs: vi.fn(), onNewTab: vi.fn(),
    onReloadTab: vi.fn(), onDuplicateTab: vi.fn(),
  }
  render(<BrowserTabRail {...callbacks} tabs={items} activeTabId="First" open />)
  return callbacks
}

describe('browser tab menus', () => {
  it.each(['Close tab', 'Close other tabs'])('targets the inactive tab for %s without switching on right-click', (name) => {
    const callbacks = setup()
    fireEvent.contextMenu(screen.getByTitle('Second'), { button: 2 })
    expect(callbacks.onSwitchTab).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('menuitem', { name }))
    expect(name === 'Close tab' ? callbacks.onCloseTab : callbacks.onCloseOtherTabs).toHaveBeenCalledExactlyOnceWith('Second')
    expect(callbacks.onSwitchTab).not.toHaveBeenCalled()
  })

  it('disables closing the last tab and copying an empty URL', () => {
    const callbacks = setup([{ ...tabs[0], url: '' }])
    fireEvent.contextMenu(screen.getByTitle('First'), { button: 2 })
    for (const name of ['Close tab', 'Close other tabs', 'Copy URL', 'Duplicate tab']) {
      const item = screen.getByRole('menuitem', { name })
      expect(item).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(item)
    }
    expect(callbacks.onCloseTab).not.toHaveBeenCalled()
    expect(callbacks.onCloseOtherTabs).not.toHaveBeenCalled()
  })

  it('copies the clicked tab URL', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    setup()
    fireEvent.contextMenu(screen.getByTitle('Second'), { button: 2 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy URL' }))
    expect(writeText).toHaveBeenCalledExactlyOnceWith(tabs[1].url)
  })

  it.each(['Reload', 'Duplicate tab'])('routes %s for the inactive tab', (name) => {
    const callbacks = setup()
    fireEvent.contextMenu(screen.getByTitle('Second'), { button: 2 })
    fireEvent.click(screen.getByRole('menuitem', { name }))
    expect(name === 'Reload' ? callbacks.onReloadTab : callbacks.onDuplicateTab)
      .toHaveBeenCalledExactlyOnceWith(name === 'Reload' ? 'Second' : tabs[1].url)
    expect(callbacks.onSwitchTab).not.toHaveBeenCalled()
  })
})

describe('closing other native browser tabs', () => {
  function mockIpc(activeTabId = 'First', switched = true) {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'browser:getState') return { activeTabId, tabs }
      return { ok: channel === 'browser:switchTab' ? switched : true }
    })
    Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } })
    return invoke
  }

  it('activates the surviving tab before sequentially closing the others', async () => {
    const invoke = mockIpc()
    await closeOtherBrowserTabs('Second')
    expect(invoke.mock.calls).toEqual([
      ['browser:getState', null],
      ['browser:switchTab', { tabId: 'Second' }],
      ['browser:closeTab', { tabId: 'First' }],
      ['browser:closeTab', { tabId: 'Third' }],
    ])
  })

  it('does not close anything if the requested survivor no longer exists', async () => {
    const invoke = mockIpc()
    await closeOtherBrowserTabs('Gone')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('stops if activating the surviving tab fails', async () => {
    const invoke = mockIpc('First', false)
    await expect(closeOtherBrowserTabs('Second')).rejects.toThrow('Could not activate')
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual(['browser:getState', 'browser:switchTab'])
  })
})
