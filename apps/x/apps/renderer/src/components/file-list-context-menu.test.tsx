import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileListContextMenu } from './file-list-context-menu'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from './ui/context-menu'

afterEach(cleanup)
describe('file-list empty-space menu', () => {
  it('calls the current folder creation action', () => {
    const onSelect = vi.fn()
    render(<FileListContextMenu actions={[{ label: 'New folder', onSelect }]}><div data-testid="empty" /></FileListContextMenu>)
    fireEvent.contextMenu(screen.getByTestId('empty'), { button: 2 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'New folder' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
  it('gives a nested file menu priority over blank-space actions', () => {
    render(<FileListContextMenu actions={[{ label: 'New folder', onSelect: vi.fn() }]}><div>
      <ContextMenu><ContextMenuTrigger asChild><button>File</button></ContextMenuTrigger>
        <ContextMenuContent><ContextMenuItem>Rename</ContextMenuItem></ContextMenuContent>
      </ContextMenu>
    </div></FileListContextMenu>)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'File' }), { button: 2 })
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'New folder' })).toBeNull()
  })
  it('preserves input context menus', () => {
    render(<FileListContextMenu actions={[{ label: 'New folder', onSelect: vi.fn() }]}><div><input aria-label="Name" /></div></FileListContextMenu>)
    const event = new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true })
    fireEvent(screen.getByRole('textbox'), event)
    expect(event.defaultPrevented).toBe(false)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
