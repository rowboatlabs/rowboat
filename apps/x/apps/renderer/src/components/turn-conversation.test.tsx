import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { TurnConversation } from './turn-conversation'
import type { ConversationItem } from '@/lib/chat-conversation'

// Streamdown / collapsibles want these in jsdom.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const streamingItem: ConversationItem = {
  id: 'turn-1:a0',
  role: 'assistant',
  content: 'Hello wor',
  streaming: true,
  timestamp: 1,
}

const durableItem: ConversationItem = {
  id: 'turn-1:a0',
  role: 'assistant',
  content: 'Hello world, all done.',
  timestamp: 1,
}

describe('TurnConversation — streaming → durable identity', () => {
  it('keeps the assistant message DOM node across the swap (no remount flash)', () => {
    const { rerender } = render(<TurnConversation items={[streamingItem]} />)
    const before = document.querySelector('[data-message-id="turn-1:a0"]')
    expect(before).not.toBeNull()

    rerender(<TurnConversation items={[durableItem]} />)
    const after = document.querySelector('[data-message-id="turn-1:a0"]')
    // The exact same mounted element — a remount here replays Streamdown's
    // async highlighting and mermaid/chart rendering as a visible flash.
    expect(after).toBe(before)
    expect(after?.textContent).toContain('Hello world, all done.')
  })

  it('never renders the message twice at completion, and leaves no stale synthetic', () => {
    const { rerender } = render(<TurnConversation items={[streamingItem]} />)
    rerender(<TurnConversation items={[durableItem]} />)
    expect(document.querySelectorAll('[data-message-id="turn-1:a0"]')).toHaveLength(1)
  })

  it('renders durable messages directly (no smoothed reveal lag)', () => {
    render(<TurnConversation items={[durableItem]} />)
    const node = document.querySelector('[data-message-id="turn-1:a0"]')
    expect(node?.textContent).toContain('Hello world, all done.')
  })
})
