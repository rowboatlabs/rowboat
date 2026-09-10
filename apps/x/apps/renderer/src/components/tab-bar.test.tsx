import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TabBar } from './tab-bar'

afterEach(cleanup)

function renderTabs(tabs = ['First', 'Second', 'Third'], allowSingleTabClose = false) {
  const onSwitchTab = vi.fn()
  const onCloseTab = vi.fn()
  const onCloseTabs = vi.fn()
  render(
    <TabBar
      tabs={tabs}
      activeTabId={tabs[0]}
      getTabId={(tab) => tab}
      getTabTitle={(tab) => tab}
      isProcessing={() => true}
      onSwitchTab={onSwitchTab}
      onCloseTab={onCloseTab}
      onCloseTabs={onCloseTabs}
      allowSingleTabClose={allowSingleTabClose}
    />,
  )
  return { onSwitchTab, onCloseTab, onCloseTabs }
}

function openMenu(title: string) {
  fireEvent.contextMenu(screen.getByRole('button', { name: title }), {
    button: 2, clientX: 100, clientY: 100,
  })
}

describe('TabBar context menu', () => {
  it('closes the right-clicked inactive, busy tab without switching to it', () => {
    const { onSwitchTab, onCloseTab, onCloseTabs } = renderTabs()
    openMenu('Second')
    expect(onSwitchTab).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close tab' }))
    expect(onCloseTab).toHaveBeenCalledExactlyOnceWith('Second')
    expect(onCloseTabs).not.toHaveBeenCalled()
    expect(onSwitchTab).not.toHaveBeenCalled()
  })

  it('closes all other tabs in one callback, keeping the clicked tab', () => {
    const { onCloseTabs, onCloseTab } = renderTabs()
    openMenu('Second')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close other tabs' }))
    expect(onCloseTabs).toHaveBeenCalledExactlyOnceWith(['First', 'Third'])
    expect(onCloseTab).not.toHaveBeenCalled()
  })

  it('closes only tabs to the right in their displayed order', () => {
    const { onCloseTabs } = renderTabs()
    openMenu('First')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close tabs to the right' }))
    expect(onCloseTabs).toHaveBeenCalledExactlyOnceWith(['Second', 'Third'])
  })

  it('disables closing to the right of the last tab', () => {
    const { onCloseTabs } = renderTabs()
    openMenu('Third')
    const item = screen.getByRole('menuitem', { name: 'Close tabs to the right' })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(item)
    expect(onCloseTabs).not.toHaveBeenCalled()
  })

  it.each([false, true])('respects allowSingleTabClose=%s', (allowClose) => {
    const { onCloseTab, onCloseTabs } = renderTabs(['First'], allowClose)
    fireEvent.contextMenu(screen.getByText('First'), { button: 2 })
    const close = screen.getByRole('menuitem', { name: 'Close tab' })
    expect(close.getAttribute('aria-disabled')).toBe(allowClose ? null : 'true')
    for (const name of ['Close other tabs', 'Close tabs to the right']) {
      const item = screen.getByRole('menuitem', { name })
      expect(item).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(item)
    }
    fireEvent.click(close)
    expect(onCloseTab).toHaveBeenCalledTimes(allowClose ? 1 : 0)
    expect(onCloseTabs).not.toHaveBeenCalled()
  })

  it('keeps the existing close button from switching tabs', () => {
    const { onSwitchTab, onCloseTab } = renderTabs()
    fireEvent.click(screen.getAllByRole('button', { name: 'Close tab' })[1])
    expect(onCloseTab).toHaveBeenCalledExactlyOnceWith('Second')
    expect(onSwitchTab).not.toHaveBeenCalled()
  })
})
