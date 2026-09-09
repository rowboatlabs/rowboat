import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantChatDock } from './assistant-chat-dock'

const sessions = vi.hoisted(() => new Map<string, { isProcessing: boolean; isWaitingOnHuman: boolean }>())
vi.mock('@/hooks/useSessionChat', () => ({ useSessionChat: (sessionId: string) => ({ chatState: sessions.get(sessionId) }) }))
vi.mock('@/lib/session-title', () => ({ useSessionTitle: () => undefined }))

beforeEach(() => {
  sessions.clear()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const tabs = [
  { id: 'first', chatId: 'first', runId: 'first' },
  { id: 'second', chatId: 'second', runId: 'second' },
]
const baseProps = { tabs, activeId: 'first', expanded: true, getTitle: (tab: { id: string }) => tab.id, onSelect: vi.fn(), onClose: vi.fn(), onNew: vi.fn() }

describe('AssistantChatDock', () => {
  it('keeps a single minimized tab compact instead of filling the dock', () => {
    render(<AssistantChatDock {...baseProps} tabs={[tabs[0]]} expanded={false} />)
    const tab = screen.getByRole('button', { name: 'first' })
    expect(tab).toHaveAttribute('aria-expanded', 'false')
    expect(tab.parentElement?.parentElement).toHaveClass('flex-[0_1_240px]')
    expect(tab.parentElement?.parentElement).not.toHaveClass('flex-1')
  })

  it('opens, closes and creates tabs with separate accessible controls', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const onNew = vi.fn()
    render(<AssistantChatDock {...baseProps} onSelect={onSelect} onClose={onClose} onNew={onNew} />)
    expect(screen.getByRole('button', { name: 'first' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'second' }))
    expect(onSelect).toHaveBeenCalledWith(tabs[1])
    fireEvent.click(screen.getByRole('button', { name: 'Close tab: second' }))
    expect(onClose).toHaveBeenCalledWith('second')
    expect(onSelect).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'New assistant chat' }))
    expect(onNew).toHaveBeenCalledOnce()
    expect(onNew).toHaveBeenCalledWith()
  })

  it('marks background completion unread without opening it, then clears on reading', () => {
    sessions.set('second', { isProcessing: true, isWaitingOnHuman: false })
    const onSelect = vi.fn()
    const { rerender } = render(<AssistantChatDock {...baseProps} onSelect={onSelect} />)
    expect(screen.getByRole('button', { name: 'second — Working' })).toBeVisible()
    sessions.set('second', { isProcessing: false, isWaitingOnHuman: false })
    rerender(<AssistantChatDock {...baseProps} onSelect={onSelect} />)
    expect(screen.getByRole('button', { name: 'second — Unread response' })).toBeVisible()
    expect(onSelect).not.toHaveBeenCalled()
    rerender(<AssistantChatDock {...baseProps} onSelect={onSelect} activeId="second" />)
    expect(screen.getByRole('button', { name: 'second' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows pending input and keeps the active chat visible when tabs overflow', () => {
    sessions.set('last', { isProcessing: true, isWaitingOnHuman: true })
    const manyTabs = [...tabs, { id: 'third', chatId: 'third', runId: 'third' }, { id: 'last', chatId: 'last', runId: 'last' }]
    render(<AssistantChatDock {...baseProps} tabs={manyTabs} activeId="last" />)
    expect(screen.getByRole('button', { name: 'last — Needs your input' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'More chats (1)' })).toBeVisible()
  })
})
