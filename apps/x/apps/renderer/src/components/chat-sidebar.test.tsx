import { useState, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatSidebar } from './chat-sidebar'

vi.mock('@/components/ui/sidebar', () => ({ useSidebar: () => ({ state: 'collapsed' }) }))
vi.mock('@/lib/tab-meta', () => ({ useTabMeta: () => ({}) }))
vi.mock('@/components/chat-header', () => ({ ChatHeader: () => <div>Chat header</div> }))
vi.mock('@/components/code/code-session-header', () => ({ CodeSessionHeader: () => null }))
vi.mock('@/contexts/file-card-context', () => ({ FileCardProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/chat-session', () => ({
  ChatSessionPane: () => <div>Conversation</div>,
  ChatSessionComposer: ({ tab, isActive }: { tab: { id: string }; isActive: boolean }) => {
    const [text, setText] = useState('')
    return <input aria-label={tab.id} hidden={!isActive} value={text} onChange={(event) => setText(event.target.value)} />
  },
}))

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const props = {
  chatTabs: [{ id: 'first', chatId: 'first', runId: null }, { id: 'second', chatId: 'second', runId: null }],
  activeChatTabId: 'first', getChatTabTitle: () => 'Chat', onNewChatTab: vi.fn(),
  conversation: [], currentAssistantMessage: '', isProcessing: false, onSubmit: vi.fn(),
  keepMounted: true, floating: true,
}

describe('floating ChatSidebar', () => {
  it('resizes height, width and the corner with keyboard-accessible handles', () => {
    const onFloatingResize = vi.fn()
    render(<ChatSidebar {...props} floatingBounds={{ width: 420, height: 500, right: 12 }} onFloatingResize={onFloatingResize} />)
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize chat width' }), { key: 'ArrowLeft' })
    expect(onFloatingResize).toHaveBeenLastCalledWith({ width: 430, height: 500 })
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize chat height' }), { key: 'ArrowUp', shiftKey: true })
    expect(onFloatingResize).toHaveBeenLastCalledWith({ width: 420, height: 540 })
    fireEvent.keyDown(screen.getByLabelText('first'), { key: 'ArrowLeft', altKey: true })
    expect(onFloatingResize).toHaveBeenCalledTimes(2)
  })

  it('commits a pointer drag only when capture ends', () => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    const onFloatingResize = vi.fn()
    const { container } = render(<ChatSidebar {...props} onFloatingResize={onFloatingResize} />)
    const pane = container.querySelector('[data-chat-sidebar-root]')!
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ width: 400, height: 400 }))
    const handle = screen.getByRole('separator', { name: 'Resize chat width and height' })
    handle.setPointerCapture = vi.fn()
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 200 })
    fireEvent.pointerMove(handle, { clientX: 20, clientY: 150 })
    expect(onFloatingResize).not.toHaveBeenCalled()
    fireEvent.lostPointerCapture(handle)
    expect(onFloatingResize).toHaveBeenCalledWith({ width: 480, height: 450 })
  })

  it('animates expansion and minimizes accessibly without unmounting', () => {
    const { container, rerender } = render(<ChatSidebar {...props} isOpen={false} />)
    const pane = container.querySelector<HTMLElement>('[data-chat-sidebar-root]')!
    const animation = { cancel: vi.fn(), onfinish: null as (() => void) | null }
    pane.animate = vi.fn(() => animation as unknown as Animation)
    rerender(<ChatSidebar {...props} isOpen />)
    expect(pane.animate).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ duration: 170 }))
    rerender(<ChatSidebar {...props} isOpen={false} />)
    expect(pane).toHaveAttribute('inert')
    expect(pane).toHaveAttribute('aria-hidden', 'true')
    expect(pane.animate).toHaveBeenLastCalledWith(expect.any(Array), expect.objectContaining({ duration: 130 }))
    expect(screen.getByLabelText('first')).toBeInTheDocument()
  })

  it('respects reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { container, rerender } = render(<ChatSidebar {...props} isOpen={false} />)
    const pane = container.querySelector<HTMLElement>('[data-chat-sidebar-root]')!
    pane.animate = vi.fn()
    rerender(<ChatSidebar {...props} isOpen />)
    expect(pane.animate).not.toHaveBeenCalled()
    expect(pane.style.visibility).toBe('visible')
    rerender(<ChatSidebar {...props} isOpen={false} />)
    expect(pane.style.visibility).toBe('hidden')
  })

  it('preserves composer instances when minimized, switched and expanded', () => {
    const { rerender } = render(<ChatSidebar {...props} isOpen />)
    fireEvent.change(screen.getByLabelText('first'), { target: { value: 'Unsent draft' } })
    rerender(<ChatSidebar {...props} isOpen={false} />)
    expect(screen.getByLabelText('first')).toHaveValue('Unsent draft')
    expect(screen.getByLabelText('first')).not.toBeVisible()
    rerender(<ChatSidebar {...props} isOpen activeChatTabId="second" />)
    fireEvent.change(screen.getByLabelText('second'), { target: { value: 'Independent draft' } })
    rerender(<ChatSidebar {...props} isOpen floating={false} isMaximized />)
    expect(screen.getByLabelText('first')).toHaveValue('Unsent draft')
    expect(screen.getByLabelText('second')).toHaveValue('Independent draft')
  })

  it('minimizes via Escape without closing or stopping the conversation', () => {
    const onMinimize = vi.fn()
    const onCloseTab = vi.fn()
    const onStop = vi.fn()
    render(<ChatSidebar {...props} isOpen onMinimize={onMinimize} onCloseTab={onCloseTab} onStop={onStop} />)
    fireEvent.keyDown(screen.getByLabelText('first'), { key: 'Escape' })
    expect(onMinimize).toHaveBeenCalledOnce()
    expect(onCloseTab).not.toHaveBeenCalled()
    expect(onStop).not.toHaveBeenCalled()
  })
})
