import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageContextMenu } from './message-context-menu'
import { toast } from '@/lib/toast'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
afterEach(() => {
  window.getSelection()?.removeAllRanges()
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
  else Reflect.deleteProperty(navigator, 'clipboard')
})

function setup() {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  render(<>
    <MessageContextMenu text="Hello **world**"><div data-testid="message">Hello world</div></MessageContextMenu>
    <div data-testid="other">Other message</div>
  </>)
  return writeText
}

function select(node: HTMLElement, start: number, end: number) {
  const range = document.createRange()
  range.setStart(node.firstChild!, start)
  range.setEnd(node.firstChild!, end)
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(range)
}

describe('message context menu', () => {
  it('copies the source message, including markdown', async () => {
    const writeText = setup()
    fireEvent.contextMenu(screen.getByTestId('message'), { button: 2 })
    expect(screen.queryByRole('menuitem', { name: 'Copy selected text' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy message' }))
    expect(writeText).toHaveBeenCalledExactlyOnceWith('Hello **world**')
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Copied to clipboard', 'success'))
  })

  it('copies the selection captured before the menu takes focus', () => {
    const writeText = setup()
    select(screen.getByTestId('message'), 6, 11)
    fireEvent.contextMenu(screen.getByTestId('message'), { button: 2 })
    window.getSelection()?.removeAllRanges()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy selected text' }))
    expect(writeText).toHaveBeenCalledExactlyOnceWith('world')
  })

  it('ignores text selected in a different message', () => {
    setup()
    select(screen.getByTestId('other'), 0, 5)
    fireEvent.contextMenu(screen.getByTestId('message'), { button: 2 })
    expect(screen.queryByRole('menuitem', { name: 'Copy selected text' })).toBeNull()
  })

  it('reports clipboard failures', async () => {
    const writeText = setup()
    writeText.mockRejectedValue(new Error('Clipboard unavailable'))
    fireEvent.contextMenu(screen.getByTestId('message'), { button: 2 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy message' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Could not copy to clipboard', 'error'))
  })

  it('preserves the editing menu for embedded text inputs', () => {
    render(<MessageContextMenu text="message"><div><textarea aria-label="Editor" /></div></MessageContextMenu>)
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })
    fireEvent(screen.getByRole('textbox'), event)
    expect(event.defaultPrevented).toBe(false)
    expect(screen.queryByRole('menuitem')).toBeNull()
  })
})
