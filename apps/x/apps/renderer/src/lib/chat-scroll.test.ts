import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AT_BOTTOM_EPSILON_PX,
  ChatScrollController,
  NEAR_BOTTOM_PX,
  resetChatScrollMemory,
  type ChatScrollSnapshot,
} from './chat-scroll'

// jsdom has no ResizeObserver; the stub records instances so tests can fire
// resize ticks (the controller does its follow/spacer work inside them).
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
  for (const instance of ResizeObserverStub.instances) {
    instance.callback([], instance as unknown as ResizeObserver)
  }
}

interface Harness {
  container: HTMLDivElement
  content: HTMLDivElement
  spacer: HTMLDivElement
  state: { contentHeight: number; clientHeight: number }
  /** Browser-faithful user scroll: set scrollTop, then the scroll event. */
  scrollTo(top: number): void
  wheel(deltaY: number): void
  /** Content growth (streaming, images, expansion) → resize tick. */
  grow(by: number): void
  /** Content shrink with the browser's clamp of scrollTop + scroll event. */
  shrinkAtBottom(by: number): void
  /** Max scrollTop excluding spacer slack (the content's live edge). */
  maxTop(): number
  spacerHeight(): number
}

function createHarness(
  { contentHeight = 2000, clientHeight = 600 } = {}
): Harness {
  const state = { contentHeight, clientHeight }
  const container = document.createElement('div')
  const content = document.createElement('div')
  const spacer = document.createElement('div')
  container.appendChild(content)
  container.appendChild(spacer)
  document.body.appendChild(container)

  const spacerHeight = () => Number.parseFloat(spacer.style.height || '0') || 0
  Object.defineProperty(container, 'scrollHeight', {
    configurable: true,
    get: () => state.contentHeight + spacerHeight(),
  })
  Object.defineProperty(container, 'clientHeight', {
    configurable: true,
    get: () => state.clientHeight,
  })
  // Browser-faithful scrollTop: writes clamp against the scroll range (jsdom
  // would otherwise store any value, hiding clamp-dependent behavior).
  let scrollTopValue = 0
  Object.defineProperty(container, 'scrollTop', {
    configurable: true,
    get: () => scrollTopValue,
    set: (value: number) => {
      const max = Math.max(
        0,
        state.contentHeight + spacerHeight() - state.clientHeight
      )
      scrollTopValue = Math.max(0, Math.min(value, max))
    },
  })

  return {
    container,
    content,
    spacer,
    state,
    scrollTo(top: number) {
      container.scrollTop = top
      container.dispatchEvent(new Event('scroll'))
    },
    wheel(deltaY: number) {
      container.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true }))
    },
    grow(by: number) {
      state.contentHeight += by
      triggerResize()
    },
    shrinkAtBottom(by: number) {
      state.contentHeight -= by
      const clamped = Math.max(
        0,
        state.contentHeight + spacerHeight() - state.clientHeight
      )
      container.scrollTop = Math.min(container.scrollTop, clamped)
      container.dispatchEvent(new Event('scroll'))
      triggerResize()
    },
    maxTop: () => Math.max(0, state.contentHeight - state.clientHeight),
    spacerHeight,
  }
}

function attach(
  harness: Harness,
  options: ConstructorParameters<typeof ChatScrollController>[0] = {}
) {
  const controller = new ChatScrollController(options)
  controller.attach({
    container: harness.container,
    content: harness.content,
    spacer: harness.spacer,
  })
  return controller
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
  ResizeObserverStub.instances = []
  vi.unstubAllGlobals()
  resetChatScrollMemory()
  document.body.innerHTML = ''
})

describe('ChatScrollController — following the live edge', () => {
  it('lands at the bottom on attach and follows content growth', () => {
    const h = createHarness()
    const controller = attach(h)
    expect(h.container.scrollTop).toBe(h.maxTop())
    expect(controller.snapshot()).toEqual({ nearBottom: true, following: true })

    h.grow(250)
    expect(h.container.scrollTop).toBe(h.maxTop())
    h.grow(15)
    expect(h.container.scrollTop).toBe(h.maxTop())
    expect(controller.snapshot().following).toBe(true)
  })

  it('follows container resizes (composer growth, window resize)', () => {
    const h = createHarness()
    attach(h)
    h.state.clientHeight -= 120
    triggerResize()
    expect(h.container.scrollTop).toBe(h.maxTop())
  })

  it('stops following when the user scrolls upward, and stays put', () => {
    const h = createHarness()
    const controller = attach(h)
    h.scrollTo(h.maxTop() - 400)
    expect(controller.snapshot().following).toBe(false)
    expect(controller.snapshot().nearBottom).toBe(false)

    const readingTop = h.container.scrollTop
    h.grow(500)
    expect(h.container.scrollTop).toBe(readingTop)
    expect(controller.snapshot().following).toBe(false)
  })

  it('stops following on an upward wheel even before any scroll event', () => {
    const h = createHarness()
    const controller = attach(h)
    h.wheel(-40)
    expect(controller.snapshot().following).toBe(false)
    h.grow(300)
    expect(controller.snapshot().following).toBe(false)
  })

  it('ignores downward wheels and wheels when content fits the viewport', () => {
    const h = createHarness()
    const controller = attach(h)
    h.wheel(40)
    expect(controller.snapshot().following).toBe(true)

    const fits = createHarness({ contentHeight: 300, clientHeight: 600 })
    const fitsController = attach(fits)
    fits.wheel(-40)
    expect(fitsController.snapshot().following).toBe(true)
  })

  it('re-engages following when the user scrolls back into the near-bottom band', () => {
    const h = createHarness()
    const controller = attach(h)
    h.scrollTo(h.maxTop() - 500)
    expect(controller.snapshot().following).toBe(false)

    h.scrollTo(h.maxTop() - NEAR_BOTTOM_PX + 10)
    expect(controller.snapshot().following).toBe(true)
    expect(controller.snapshot().nearBottom).toBe(true)

    h.grow(200)
    expect(h.container.scrollTop).toBe(h.maxTop())
  })

  it('does not re-engage when an upward scroll merely ends inside the band', () => {
    const h = createHarness()
    const controller = attach(h)
    h.scrollTo(h.maxTop() - (NEAR_BOTTOM_PX - 20))
    expect(controller.snapshot().following).toBe(false)

    const readingTop = h.container.scrollTop
    h.grow(300)
    expect(h.container.scrollTop).toBe(readingTop)
  })

  it('keeps following through a clamp when content shrinks at the bottom', () => {
    const h = createHarness()
    const controller = attach(h)
    h.shrinkAtBottom(300)
    expect(controller.snapshot().following).toBe(true)
    expect(h.container.scrollTop).toBe(h.maxTop())
  })

  it('jumpToLatest returns to the live edge and resumes following', () => {
    const h = createHarness()
    const controller = attach(h)
    h.scrollTo(100)
    expect(controller.snapshot().following).toBe(false)

    controller.jumpToLatest()
    expect(h.container.scrollTop).toBe(h.maxTop())
    expect(controller.snapshot()).toEqual({ nearBottom: true, following: true })

    h.grow(150)
    expect(h.container.scrollTop).toBe(h.maxTop())
  })
})

describe('ChatScrollController — smooth jump', () => {
  it('animates via scrollTo, re-targets on growth, then resumes instant follow', () => {
    const h = createHarness()
    const scrollTo = vi.fn((options: ScrollToOptions) => {
      h.container.scrollTop = options.top ?? 0
    })
    h.container.scrollTo = scrollTo as unknown as typeof h.container.scrollTo
    const controller = attach(h)
    h.scrollTo(100)

    controller.jumpToLatest('smooth')
    expect(scrollTo).toHaveBeenLastCalledWith({ top: h.maxTop(), behavior: 'smooth' })
    expect(controller.snapshot().following).toBe(true)

    // Growth mid-animation re-targets the animation instead of snapping.
    h.grow(200)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: h.maxTop(), behavior: 'smooth' })

    // Arrival at the bottom settles the animation; further growth snaps.
    h.scrollTo(h.maxTop())
    scrollTo.mockClear()
    h.grow(100)
    expect(scrollTo).not.toHaveBeenCalled()
    expect(h.container.scrollTop).toBe(h.maxTop())
  })

  it('an upward wheel cancels the animation and the follow intent', () => {
    const h = createHarness()
    const scrollTo = vi.fn()
    h.container.scrollTo = scrollTo as unknown as typeof h.container.scrollTo
    const controller = attach(h)
    h.scrollTo(100)
    controller.jumpToLatest('smooth')

    h.wheel(-30)
    expect(controller.snapshot().following).toBe(false)
    const top = h.container.scrollTop
    h.grow(200)
    expect(h.container.scrollTop).toBe(top)
  })
})

describe('ChatScrollController — send anchoring (chat mode)', () => {
  function setupAnchored(messageLayoutTop: number) {
    const h = createHarness()
    const controller = attach(h, { mode: 'chat' })
    const message = document.createElement('div')
    message.setAttribute('data-message-id', 'user-1')
    h.content.appendChild(message)
    h.container.getBoundingClientRect = () =>
      ({ top: 0 } as DOMRect)
    message.getBoundingClientRect = () =>
      ({ top: messageLayoutTop - h.container.scrollTop } as DOMRect)
    return { h, controller, message }
  }

  it('pins the sent message at the viewport top with spacer slack', () => {
    const { h, controller } = setupAnchored(1800)
    expect(controller.anchorToMessage('user-1')).toBe(true)

    // target 1800 needs 400px of slack beyond the 1400 natural max.
    expect(h.container.scrollTop).toBe(1800)
    expect(h.spacerHeight()).toBe(400)
    expect(controller.snapshot().following).toBe(false)
    // Nothing but blank slack below → nothing to jump to.
    expect(controller.snapshot().nearBottom).toBe(true)
  })

  it('consumes slack (shrink-only) as the response streams, without moving the view', () => {
    const { h, controller } = setupAnchored(1800)
    controller.anchorToMessage('user-1')

    h.grow(300)
    expect(h.spacerHeight()).toBe(100)
    expect(h.container.scrollTop).toBe(1800)

    h.grow(300)
    expect(h.spacerHeight()).toBe(0)
    expect(h.container.scrollTop).toBe(1800)
    // Content now extends below the fold → the jump affordance appears.
    expect(controller.snapshot().nearBottom).toBe(false)

    // Slack never comes back, even if layout above the anchor shifts.
    h.state.contentHeight -= 50
    triggerResize()
    expect(h.spacerHeight()).toBe(0)
  })

  it('returns false when the message is not in the DOM yet', () => {
    const h = createHarness()
    const controller = attach(h, { mode: 'chat' })
    expect(controller.anchorToMessage('missing')).toBe(false)
  })

  it('scrolling to the bottom mid-stream re-engages following', () => {
    const { h, controller } = setupAnchored(1800)
    controller.anchorToMessage('user-1')
    h.grow(700) // slack exhausted, response extends below the fold

    h.scrollTo(h.maxTop())
    expect(controller.snapshot().following).toBe(true)
    h.grow(120)
    expect(h.container.scrollTop).toBe(h.maxTop())
  })
})

describe('ChatScrollController — reading-position memory', () => {
  it('restores a mid-transcript position across remounts, re-asserting while content rebuilds', () => {
    const h = createHarness()
    const controller = attach(h, { memoryKey: 'chat-1' })
    h.scrollTo(900)
    expect(controller.snapshot().following).toBe(false)
    controller.detach()

    // Remount: content starts short (transcript re-renders asynchronously).
    const h2 = createHarness({ contentHeight: 400 })
    const controller2 = attach(h2, { memoryKey: 'chat-1' })
    expect(controller2.snapshot().following).toBe(false)

    h2.grow(1600)
    expect(h2.container.scrollTop).toBe(900)

    // Once the position is reachable the restore is done — later growth
    // leaves the reader alone.
    h2.grow(400)
    expect(h2.container.scrollTop).toBe(900)
  })

  it('a user scroll takes over from a pending restore', () => {
    const h = createHarness()
    const controller = attach(h, { memoryKey: 'chat-2' })
    h.scrollTo(900)
    controller.detach()

    // Remount mid-rebuild: content is tall enough to scroll but not yet tall
    // enough to hold the remembered position (the write clamps).
    const h2 = createHarness({ contentHeight: 1000 })
    attach(h2, { memoryKey: 'chat-2' })
    expect(h2.container.scrollTop).toBe(h2.maxTop())

    h2.scrollTo(50)
    h2.grow(1600)
    expect(h2.container.scrollTop).toBe(50)
  })

  it('a remount that was following lands back at the live edge', () => {
    const h = createHarness()
    const controller = attach(h, { memoryKey: 'chat-3' })
    expect(controller.snapshot().following).toBe(true)
    controller.detach()

    const h2 = createHarness({ contentHeight: 3000 })
    const controller2 = attach(h2, { memoryKey: 'chat-3' })
    expect(h2.container.scrollTop).toBe(h2.maxTop())
    expect(controller2.snapshot().following).toBe(true)
  })

  it('an unknown conversation lands at the bottom', () => {
    const h = createHarness()
    const controller = attach(h, { memoryKey: 'never-seen' })
    expect(h.container.scrollTop).toBe(h.maxTop())
    expect(controller.snapshot().following).toBe(true)
  })
})

describe('ChatScrollController — subscription and cleanup', () => {
  it('notifies subscribers of near-bottom/following changes', () => {
    const h = createHarness()
    const controller = attach(h)
    const seen: ChatScrollSnapshot[] = []
    const unsubscribe = controller.subscribe((snapshot) => seen.push(snapshot))
    expect(seen[0]).toEqual({ nearBottom: true, following: true })

    h.scrollTo(h.maxTop() - 500)
    expect(seen[seen.length - 1]).toEqual({ nearBottom: false, following: false })

    unsubscribe()
    const count = seen.length
    h.scrollTo(h.maxTop())
    expect(seen.length).toBe(count)
  })

  it('detach removes listeners and stops reacting', () => {
    const h = createHarness()
    const controller = attach(h)
    controller.detach()
    h.scrollTo(100)
    h.state.contentHeight += 500
    triggerResize()
    expect(h.container.scrollTop).toBe(100)
  })

  it('tolerates sub-pixel scroll positions at the bottom', () => {
    const h = createHarness()
    const controller = attach(h)
    h.scrollTo(h.maxTop() - AT_BOTTOM_EPSILON_PX / 2)
    expect(controller.snapshot().following).toBe(true)
    h.grow(100)
    expect(h.container.scrollTop).toBe(h.maxTop())
  })
})
