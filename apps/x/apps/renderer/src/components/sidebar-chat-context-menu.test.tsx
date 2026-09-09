import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SidebarChatContextMenu } from './sidebar-chat-context-menu'

afterEach(cleanup)

describe('sidebar chat context menu', () => {
  it.each(['Open chat', 'Pin', 'Rename', 'Delete'])('routes %s without opening the chat on right-click', (action) => {
    const onOpen = vi.fn()
    const onTogglePin = vi.fn()
    const onRename = vi.fn()
    const onRequestDelete = vi.fn()
    render(<SidebarChatContextMenu pinned={false} {...{ onOpen, onTogglePin, onRename, onRequestDelete }}>
      <button onClick={onOpen}>My chat</button>
    </SidebarChatContextMenu>)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'My chat' }), { button: 2 })
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('menuitem', { name: action }))
    const callbacks = { 'Open chat': onOpen, Pin: onTogglePin, Rename: onRename, Delete: onRequestDelete }
    for (const [name, callback] of Object.entries(callbacks)) {
      expect(callback).toHaveBeenCalledTimes(name === action ? 1 : 0)
    }
  })

  it('offers Unpin for pinned chats and omits unavailable actions', () => {
    const onTogglePin = vi.fn()
    render(<SidebarChatContextMenu pinned onTogglePin={onTogglePin}><button>Chat</button></SidebarChatContextMenu>)
    fireEvent.contextMenu(screen.getByRole('button'), { button: 2 })
    expect(screen.getAllByRole('menuitem')).toHaveLength(1)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unpin' }))
    expect(onTogglePin).toHaveBeenCalledOnce()
  })
})
