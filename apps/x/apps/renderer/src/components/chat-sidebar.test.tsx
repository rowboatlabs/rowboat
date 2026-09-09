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
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const props = {
  chatTabs: [{ id: 'first', chatId: 'first', runId: null }, { id: 'second', chatId: 'second', runId: null }],
  activeChatTabId: 'first', getChatTabTitle: () => 'Chat', onNewChatTab: vi.fn(),
  conversation: [], currentAssistantMessage: '', isProcessing: false, onSubmit: vi.fn(),
  keepMounted: true, floating: true,
}

describe('floating ChatSidebar', () => {
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
