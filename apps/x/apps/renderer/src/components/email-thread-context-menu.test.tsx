import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmailThreadContextMenu } from './email-thread-context-menu'

afterEach(cleanup)

function setup({ unread = true, section = 'important', categorizing = true }: {
  unread?: boolean
  section?: 'important' | 'other' | null
  categorizing?: boolean
} = {}) {
  const actions = {
    onMarkRead: vi.fn().mockResolvedValue(undefined),
    onSetImportance: vi.fn().mockResolvedValue(undefined),
    onSetCategory: vi.fn().mockResolvedValue(undefined),
    onArchive: vi.fn().mockResolvedValue(undefined),
    onTrash: vi.fn().mockResolvedValue(undefined),
  }
  const onOpen = vi.fn()
  render(
    <EmailThreadContextMenu
      {...actions}
      threadId="clicked-thread"
      unread={unread}
      section={section}
      category="newsletter"
      labels={[
        { id: 'newsletter', name: 'News', kind: 'builtin' },
        { id: 'customer', name: 'Customer', kind: 'custom' },
      ]}
      onSetCategory={categorizing ? actions.onSetCategory : undefined}
    >
      <div><button onClick={onOpen}>Email row</button></div>
    </EmailThreadContextMenu>,
  )
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Email row' }), { button: 2 })
  return { ...actions, onOpen }
}

describe('email thread context menu', () => {
  it.each([true, false])('toggles read state for unread=%s without opening the thread', (unread) => {
    const { onMarkRead, onOpen } = setup({ unread })
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('menuitem', { name: unread ? 'Mark as read' : 'Mark as unread' }))
    expect(onMarkRead).toHaveBeenCalledExactlyOnceWith('clicked-thread', unread)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it.each(['important', 'other'] as const)('toggles importance from %s', (section) => {
    const { onSetImportance } = setup({ section })
    fireEvent.click(screen.getByRole('menuitem', { name: section === 'important' ? 'Mark as not important' : 'Mark as important' }))
    expect(onSetImportance).toHaveBeenCalledExactlyOnceWith('clicked-thread', section === 'important' ? 'other' : 'important')
  })

  it('omits unavailable importance and category actions', () => {
    setup({ section: null, categorizing: false })
    expect(screen.queryByRole('menuitem', { name: /important/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Category' })).toBeNull()
  })

  it.each(['Archive', 'Delete'])('routes %s to the existing handler for the clicked thread', (name) => {
    const { onArchive, onTrash, onOpen } = setup()
    fireEvent.click(screen.getByRole('menuitem', { name }))
    expect(name === 'Archive' ? onArchive : onTrash).toHaveBeenCalledExactlyOnceWith('clicked-thread')
    expect(name === 'Archive' ? onTrash : onArchive).not.toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('shows the selected category and supports custom labels', async () => {
    const { onSetCategory } = setup()
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Category' }), { key: 'ArrowRight' })
    expect(await screen.findByRole('menuitemradio', { name: 'News' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Customer' }))
    expect(onSetCategory).toHaveBeenCalledExactlyOnceWith('clicked-thread', 'customer')
  })

  it('keeps menu typeahead from reaching document-level inbox shortcuts', () => {
    setup()
    const shortcut = vi.fn()
    document.addEventListener('keydown', shortcut)
    try {
      fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Archive' }), { key: 'e' })
      expect(shortcut).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', shortcut)
    }
  })
})
