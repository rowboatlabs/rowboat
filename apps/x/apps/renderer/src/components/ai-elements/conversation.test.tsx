import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from './conversation'
import { resetChatScrollMemory, SEND_ANCHOR_PEEK_PX } from '@/lib/chat-scroll'

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = []
  callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    ResizeObserverStub.instances.push(this)
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function triggerResize() {
  act(() => {
    for (const instance of ResizeObserverStub.instances) {
      instance.callback([], instance as unknown as ResizeObserver)
    }
  })
}

interface Setup {
  scroller: HTMLElement
  state: { contentHeight: number; clientHeight: number }
  rerender: (ui: React.ReactElement) => void
  grow(by: number): void
  userScroll(top: number): void
  maxTop(): number
}

function setup(ui: React.ReactElement): Setup {
  const view = render(ui)
  const scroller = screen.getByRole('log').firstElementChild as HTMLElement
  const state = { contentHeight: 2000, clientHeight: 600 }
  const spacer = scroller.lastElementChild as HTMLElement
  Object.defineProperty(scroller, 'scrollHeight', {
    configurable: true,
    get: () =>
      state.contentHeight + (Number.parseFloat(spacer.style.height || '0') || 0),
  })
  Object.defineProperty(scroller, 'clientHeight', {
    configurable: true,
    get: () => state.clientHeight,
  })
  const maxTop = () => Math.max(0, state.contentHeight - state.clientHeight)
  return {
    scroller,
    state,
    rerender: view.rerender,
    grow(by: number) {
      state.contentHeight += by
      triggerResize()
    },
    userScroll(top: number) {
      scroller.scrollTop = top
      fireEvent.scroll(scroller)
    },
    maxTop,
  }
}

const ui = (props: Partial<React.ComponentProps<typeof Conversation>> = {}) => (
  <Conversation {...props}>
    <ConversationContent>
      <div data-message-id="m-1">hello</div>
      <div data-message-id="m-2">world</div>
    </ConversationContent>
    <ConversationScrollButton />
  </Conversation>
)

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
  cleanup()
  ResizeObserverStub.instances = []
  vi.unstubAllGlobals()
  resetChatScrollMemory()
})

const jumpButton = () =>
  screen.queryByRole('button', { name: /scroll to latest message/i })

describe('Conversation scroll wiring', () => {
  it('lands at the bottom, hides the jump button, and follows growth', () => {
    const s = setup(ui())
    triggerResize()
    expect(s.scroller.scrollTop).toBe(s.maxTop())
    expect(jumpButton()).toBeNull()

    s.grow(400)
    expect(s.scroller.scrollTop).toBe(s.maxTop())
    expect(jumpButton()).toBeNull()
  })

  it('shows the jump button after the user scrolls away, without yanking them back', () => {
    const s = setup(ui())
    triggerResize()
    s.userScroll(s.maxTop() - 500)
    expect(jumpButton()).not.toBeNull()

    const readingTop = s.scroller.scrollTop
    s.grow(600)
    expect(s.scroller.scrollTop).toBe(readingTop)
    expect(jumpButton()).not.toBeNull()
  })

  it('the jump button returns to the live edge and resumes following', () => {
    const s = setup(ui())
    triggerResize()
    // Model the browser's smooth scroll as an instantly-completing animation.
    s.scroller.scrollTo = ((options: ScrollToOptions) => {
      s.scroller.scrollTop = options.top ?? 0
    }) as typeof s.scroller.scrollTo
    s.userScroll(200)
    fireEvent.click(jumpButton()!)
    expect(s.scroller.scrollTop).toBe(s.maxTop())
    expect(jumpButton()).toBeNull()

    s.grow(250)
    expect(s.scroller.scrollTop).toBe(s.maxTop())
  })

  it('chat mode anchors a sent message at the viewport top', () => {
    const s = setup(ui({ anchorRequestKey: 0, anchorMessageId: null }))
    triggerResize()

    const message = screen.getByText('world').closest('[data-message-id]') as HTMLElement
    s.scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
    message.getBoundingClientRect = () =>
      ({ top: 1800 - s.scroller.scrollTop } as DOMRect)

    s.rerender(ui({ anchorRequestKey: 1, anchorMessageId: 'm-2' }))
    const target = 1800 - SEND_ANCHOR_PEEK_PX
    expect(s.scroller.scrollTop).toBe(target)
    const spacer = s.scroller.lastElementChild as HTMLElement
    expect(spacer.style.height).toBe(`${target - 1400}px`)
    // Streaming growth stays below the fold — no movement.
    s.grow(300)
    expect(s.scroller.scrollTop).toBe(target)
  })

  it('code mode jumps sends to the live edge and follows the run', () => {
    const s = setup(
      ui({ scrollMode: 'code', anchorRequestKey: 0, anchorMessageId: null })
    )
    triggerResize()
    s.userScroll(100)

    s.rerender(
      ui({ scrollMode: 'code', anchorRequestKey: 1, anchorMessageId: 'm-2' })
    )
    expect(s.scroller.scrollTop).toBe(s.maxTop())

    s.grow(500)
    expect(s.scroller.scrollTop).toBe(s.maxTop())
  })

  it('ignores the mount-time anchor request (remounts restore, not re-anchor)', () => {
    const s = setup(ui({ anchorRequestKey: 7, anchorMessageId: 'm-1' }))
    triggerResize()
    expect(s.scroller.scrollTop).toBe(s.maxTop())
    const spacer = s.scroller.lastElementChild as HTMLElement
    expect(spacer.style.height || '0px').toBe('0px')
  })

  it('remounts with the same memory key restore the reading position', () => {
    const s = setup(ui({ scrollMemoryKey: 'chat-x' }))
    triggerResize()
    s.userScroll(700)
    s.rerender(<div />)

    const s2 = setup(ui({ scrollMemoryKey: 'chat-x' }))
    triggerResize()
    expect(s2.scroller.scrollTop).toBe(700)
    expect(jumpButton()).not.toBeNull()
  })
})
