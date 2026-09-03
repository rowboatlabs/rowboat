import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANCHOR_TAIL_HEADROOM_PX,
  AT_BOTTOM_EPSILON_PX,
  ChatScrollController,
  NEAR_BOTTOM_PX,
  SEND_ANCHOR_PEEK_PX,
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
  /** Browser scroll-anchoring compensation: growth above the reader with a
   * position-preserving scrollTop adjustment and its scroll event. */
  anchorAdjust(by: number): void
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
    anchorAdjust(by: number) {
      // Native scroll anchoring compensating for growth above the reader's
      // anchor node: content and scrollTop grow together (distance from the
      // bottom is preserved), and the browser fires a scroll event with no
      // accompanying input event.
      state.contentHeight += by
      container.scrollTop = container.scrollTop + by
      container.dispatchEvent(new Event('scroll'))
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

  it('re-engages when a wheel gesture scrolls back into the near-bottom band', () => {
    const h = createHarness()
    const controller = attach(h)
    h.scrollTo(h.maxTop() - 500)
    expect(controller.snapshot().following).toBe(false)

    // Trackpad: the wheel event attributes the scroll that follows it.
    h.wheel(40)
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

describe('ChatScrollController — user-intent attribution', () => {
  it('end-of-turn repro: a browser anchoring adjustment near the bottom does not re-engage a parked reader', () => {
    const h = createHarness()
    const controller = attach(h)
    // Streaming, pinned. The reader scrolls up a small amount (scrollbar —
    // no input event) and parks 40px above the live edge.
    h.scrollTo(h.maxTop() - 40)
    expect(controller.snapshot().following).toBe(false)

    // A little more streams in below the fold — nothing moves.
    h.grow(20)
    const readingTop = h.container.scrollTop
    expect(h.container.scrollTop).toBe(readingTop)

    // Turn completes: the streaming bubble is replaced by the taller durable
    // message above/at the reader's anchor node, and native scroll anchoring
    // compensates — a downward scroll event, no user input, landing inside
    // the near-bottom band.
    h.anchorAdjust(60)
    expect(controller.snapshot().following).toBe(false)

    // Follow-up height changes (usage row, next paint) must not pin the
    // reader back to the bottom.
    const parkedTop = h.container.scrollTop
    h.grow(300)
    expect(h.container.scrollTop).toBe(parkedTop)
    expect(controller.snapshot().following).toBe(false)
  })

  it('a small upward wheel latches the disengage even when follow writes mask the scroll event', () => {
    const h = createHarness()
    const controller = attach(h)
    const bottom = h.container.scrollTop

    // The wheel latches before any scroll event can be observed…
    h.wheel(-5)
    expect(controller.snapshot().following).toBe(false)

    // …so an immediately-interleaved streaming tick no longer writes,
    // and the masked (zero-delta) scroll echo cannot undo the latch.
    h.grow(120)
    expect(h.container.scrollTop).toBe(bottom)
    h.container.dispatchEvent(new Event('scroll'))
    expect(controller.snapshot().following).toBe(false)

    // Turn completion: growth then a shrink-clamp — still parked.
    h.grow(200)
    expect(h.container.scrollTop).toBe(bottom)
    expect(controller.snapshot().following).toBe(false)
  })

  it('programmatic write echoes neither disengage nor engage', () => {
    const h = createHarness()
    const controller = attach(h)
    // Pinned: a follow write plus its echo keeps following.
    h.grow(100)
    h.container.dispatchEvent(new Event('scroll'))
    expect(controller.snapshot().following).toBe(true)

    // Parked: a zero-delta echo changes nothing.
    h.scrollTo(h.maxTop() - 300)
    expect(controller.snapshot().following).toBe(false)
    h.container.dispatchEvent(new Event('scroll'))
    expect(controller.snapshot().following).toBe(false)
  })

  it('a scrollbar return engages only at the true live edge', () => {
    const h = createHarness()
    const controller = attach(h)
    h.scrollTo(h.maxTop() - 500)
    expect(controller.snapshot().following).toBe(false)

    // Unattributed downward movement into the band could be a browser
    // adjustment — it does not engage…
    h.scrollTo(h.maxTop() - 40)
    expect(controller.snapshot().following).toBe(false)

    // …but dragging the thumb to the very end is unambiguous.
    h.scrollTo(h.maxTop())
    expect(controller.snapshot().following).toBe(true)
    h.grow(150)
    expect(h.container.scrollTop).toBe(h.maxTop())
  })

  it('touch gestures attribute the scroll events they cause', () => {
    const h = createHarness()
    const controller = attach(h)
    h.scrollTo(h.maxTop() - 500)
    expect(controller.snapshot().following).toBe(false)

    h.container.dispatchEvent(new Event('touchmove'))
    h.scrollTo(h.maxTop() - 60)
    expect(controller.snapshot().following).toBe(true)
  })

  it('scroll keys attribute the scroll events they cause', () => {
    const h = createHarness()
    const controller = attach(h)
    h.scrollTo(h.maxTop() - 500)
    expect(controller.snapshot().following).toBe(false)

    h.container.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true })
    )
    h.scrollTo(h.maxTop() - 50)
    expect(controller.snapshot().following).toBe(true)
  })

  it('keys pressed inside an editable are not scroll gestures', () => {
    const h = createHarness()
    const controller = attach(h)
    h.scrollTo(h.maxTop() - 500)
    expect(controller.snapshot().following).toBe(false)

    const input = document.createElement('input')
    h.content.appendChild(input)
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true })
    )
    // The band arrival stays unattributed → no engage.
    h.scrollTo(h.maxTop() - 50)
    expect(controller.snapshot().following).toBe(false)
  })

  it('the attribution window expires — later browser adjustments are not the user', () => {
    vi.useFakeTimers({ toFake: ['performance', 'Date'] })
    try {
      const h = createHarness()
      const controller = attach(h)
      h.wheel(-10)
      h.scrollTo(h.maxTop() - 40)
      expect(controller.snapshot().following).toBe(false)

      // Well past the wheel's attribution window, completion-time anchoring
      // fires an input-less downward scroll event inside the band.
      vi.advanceTimersByTime(2000)
      h.anchorAdjust(60)
      expect(controller.snapshot().following).toBe(false)
    } finally {
      vi.useRealTimers()
    }
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

function addUserRow(h: Harness, id: string, layoutTop: number): HTMLElement {
  const row = document.createElement('div')
  row.className = 'is-user'
  row.setAttribute('data-message-id', id)
  h.content.appendChild(row)
  h.container.getBoundingClientRect = () => ({ top: 0 } as DOMRect)
  row.getBoundingClientRect = () =>
    ({ top: layoutTop - h.container.scrollTop } as DOMRect)
  return row
}

describe('ChatScrollController — send anchoring (chat mode)', () => {
  // A message whose layout top is 1800 in a 2000-tall transcript with a
  // 600-tall viewport: the anchor target is 1800 - PEEK, and the slack keeps
  // the scroll range reachable to target + tail headroom.
  const TARGET = 1800 - SEND_ANCHOR_PEEK_PX
  const SLACK = TARGET + ANCHOR_TAIL_HEADROOM_PX - 1400

  function setupAnchored(messageLayoutTop: number) {
    const h = createHarness()
    const controller = attach(h, { mode: 'chat' })
    const message = addUserRow(h, 'user-1', messageLayoutTop)
    return { h, controller, message }
  }

  it('pins the sent message near the viewport top, prior turn peeking above', () => {
    const { h, controller } = setupAnchored(1800)
    expect(controller.anchorToMessage('user-1')).toBe(true)

    expect(h.container.scrollTop).toBe(TARGET)
    expect(h.spacerHeight()).toBe(SLACK)
    expect(controller.snapshot().following).toBe(false)
    // Nothing but blank slack below → nothing to jump to.
    expect(controller.snapshot().nearBottom).toBe(true)
  })

  it('consumes slack (shrink-only) as the response streams, without moving the view', () => {
    const { h, controller } = setupAnchored(1800)
    controller.anchorToMessage('user-1')

    h.grow(300)
    expect(h.spacerHeight()).toBe(SLACK - 300)
    expect(h.container.scrollTop).toBe(TARGET)

    h.grow(300)
    expect(h.spacerHeight()).toBe(0)
    expect(h.container.scrollTop).toBe(TARGET)
    // Content now extends below the fold → the jump affordance appears.
    expect(controller.snapshot().nearBottom).toBe(false)

    // Slack never comes back, even if layout above the anchor shifts.
    h.state.contentHeight -= 50
    triggerResize()
    expect(h.spacerHeight()).toBe(0)
  })

  it('a completion tail shrink lands in the headroom — no clamp — and the slack regrows', () => {
    const { h, controller } = setupAnchored(1800)
    controller.anchorToMessage('user-1')
    expect(h.container.scrollTop).toBe(TARGET)

    // Turn completes: the activity indicator row + gap unmount below the
    // anchor. The browser clamps during layout — emulate by re-clamping
    // scrollTop against the shrunken range BEFORE any observer runs.
    h.state.contentHeight -= 90
    const reclamped = h.container.scrollTop
    h.container.scrollTop = reclamped
    // The headroom absorbed the shrink: the reader did not move.
    expect(h.container.scrollTop).toBe(TARGET)

    triggerResize()
    // Regrowth gate (target stable, content fell): the cap rises and the
    // spacer is restored, so the NEXT shrink is covered too.
    expect(h.spacerHeight()).toBe(SLACK + 90)
    expect(h.container.scrollTop).toBe(TARGET)
    expect(controller.snapshot().following).toBe(false)
  })

  it('an above-anchor shift cannot inject slack (target moved, content did not fall)', () => {
    const { h, controller, message } = setupAnchored(1800)
    controller.anchorToMessage('user-1')
    expect(h.spacerHeight()).toBe(SLACK)

    // Content above the anchor grows by 200 while the tail shrinks by 200:
    // total height unchanged, but the anchor's layout position moved down —
    // the regrowth gate must stay closed even though required slack rose.
    message.getBoundingClientRect = () =>
      ({ top: 2000 - h.container.scrollTop } as DOMRect)
    triggerResize()
    expect(h.spacerHeight()).toBe(SLACK)
  })

  it('a parked reader survives a coalesced completion commit unchanged', () => {
    const h = createHarness()
    const controller = attach(h)
    h.scrollTo(h.maxTop() - 300)
    expect(controller.snapshot().following).toBe(false)
    const parked = h.container.scrollTop

    // One merged commit: +40 of durable-message growth and -90 of indicator
    // removal land as a single net height change.
    h.state.contentHeight += 40 - 90
    const reclamped = h.container.scrollTop
    h.container.scrollTop = reclamped
    triggerResize()
    expect(h.container.scrollTop).toBe(parked)
    expect(controller.snapshot().following).toBe(false)
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

describe('ChatScrollController — send repositioning (requestSendAnchor)', () => {
  const TARGET = 1800 - SEND_ANCHOR_PEEK_PX

  it('a send while far scrolled up overrides the reading position', () => {
    const h = createHarness()
    const controller = attach(h)
    addUserRow(h, 'user-1', 1800)
    h.scrollTo(200)
    expect(controller.snapshot().following).toBe(false)

    controller.requestSendAnchor('user-1')
    expect(h.container.scrollTop).toBe(TARGET)
    expect(h.spacerHeight()).toBe(TARGET + ANCHOR_TAIL_HEADROOM_PX - 1400)
    expect(controller.snapshot().following).toBe(false)
  })

  it('a send while slightly scrolled up behaves identically', () => {
    const h = createHarness()
    const controller = attach(h)
    addUserRow(h, 'user-1', 1800)
    h.scrollTo(h.maxTop() - 40)
    expect(controller.snapshot().following).toBe(false)

    controller.requestSendAnchor('user-1')
    expect(h.container.scrollTop).toBe(TARGET)
    expect(controller.snapshot().following).toBe(false)
  })

  it('waits for a store-backed row under a different id and repositions exactly once', () => {
    const h = createHarness()
    const controller = attach(h)
    // A previous turn's user row exists — it must not be mistaken for the
    // new send.
    addUserRow(h, 'turn-1:user', 500)

    controller.requestSendAnchor('user-1757000000000') // optimistic App id
    expect(h.container.scrollTop).toBe(h.maxTop()) // no premature move

    // Streaming/composer ticks before the row lands change nothing.
    h.grow(40)
    expect(controller.snapshot().following).toBe(true)

    // The round-trip completes: the row renders under the store's id.
    addUserRow(h, 'turn-2:user', 1800 + 40)
    h.grow(30)
    const target = 1800 + 40 - SEND_ANCHOR_PEEK_PX
    expect(h.container.scrollTop).toBe(target)
    expect(controller.snapshot().following).toBe(false)

    // Subsequent growth streams below the fold — no second reposition.
    h.grow(400)
    expect(h.container.scrollTop).toBe(target)
  })

  it('an upward wheel before the row lands cancels the pending reposition', () => {
    const h = createHarness()
    const controller = attach(h)
    controller.requestSendAnchor('user-1')
    h.wheel(-10)
    const parked = h.container.scrollTop

    addUserRow(h, 'turn-2:user', 1800)
    h.grow(200)
    expect(h.container.scrollTop).toBe(parked)
    expect(controller.snapshot().following).toBe(false)
  })

  it('a stale send (queued message) expires instead of yanking later', () => {
    vi.useFakeTimers({ toFake: ['performance', 'Date'] })
    try {
      const h = createHarness()
      const controller = attach(h)
      h.scrollTo(300)
      controller.requestSendAnchor('user-1')

      vi.advanceTimersByTime(5000)
      addUserRow(h, 'turn-9:user', 1800)
      h.grow(100)
      expect(h.container.scrollTop).toBe(300)
      expect(controller.snapshot().following).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('after the send reposition, upward intent still parks and completion cannot snap down', () => {
    vi.useFakeTimers({ toFake: ['performance', 'Date'] })
    try {
      const h = createHarness()
      const controller = attach(h)
      addUserRow(h, 'user-1', 1800)
      controller.requestSendAnchor('user-1')
      expect(h.container.scrollTop).toBe(TARGET)

      h.wheel(-10)
      vi.advanceTimersByTime(1000) // generation continues past the gesture
      h.grow(300)
      expect(h.container.scrollTop).toBe(TARGET)

      // Turn completion: an input-less anchoring adjustment — landing in
      // the slack region where distance measures 0 — must not re-engage.
      h.anchorAdjust(60)
      expect(controller.snapshot().following).toBe(false)
      const parked = h.container.scrollTop
      h.grow(200)
      expect(h.container.scrollTop).toBe(parked)
    } finally {
      vi.useRealTimers()
    }
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
