/**
 * Scroll-state controller for chat transcripts.
 *
 * One controller instance owns one transcript's scroll container for the life
 * of a conversation binding (the pane remounts per chat identity). It models
 * the behavior of modern chat UIs with two explicit concepts:
 *
 * - **following** — the user is riding the live edge: any content growth
 *   (streamed tokens, tool cards, images, collapsibles) keeps the view pinned
 *   to the bottom of the content. Following starts true on a fresh
 *   conversation, breaks the moment the user deliberately scrolls upward
 *   (wheel, scrollbar, keyboard, touch), and re-engages when the user scrolls
 *   back to within NEAR_BOTTOM_PX of the content bottom or invokes
 *   jumpToLatest (the scroll-down button, or a send in code mode).
 * - **nearBottom** — within NEAR_BOTTOM_PX of the content bottom; drives the
 *   jump-to-latest button's visibility.
 *
 * Mode differences ('chat' vs 'code'):
 * - 'chat' (ChatGPT semantics): a send is explicit navigation — wherever the
 *   reader had scrolled, the new user message is pinned near the viewport
 *   top (SEND_ANCHOR_PEEK_PX of the prior turn stays visible), with spacer
 *   slack below so the position is reachable while the response is still
 *   short. The response streams below the fold without moving the view; the
 *   slack is consumed (shrink-only) as content grows. Following is off after
 *   a send until the user returns to the bottom.
 * - 'code' (Codex transcript semantics): sends jump straight to the live
 *   edge and follow the run's output. No top-anchoring.
 *
 * Intent is latched from direct user input, not inferred from scroll
 * geometry alone. Wheel, touch, and scroll-key listeners stamp a short
 * attribution window; scroll events inside the window count as the user's
 * (and refresh it, so momentum and smooth-keyboard chains stay attributed).
 * An upward wheel latches "scrolled away" immediately — even if an
 * interleaved follow write swallows the resulting scroll event's delta, the
 * disengage sticks. Scroll events OUTSIDE the window (our own write echoes —
 * lastTop is pre-updated on every write — browser clamps after content
 * shrinks, and native scroll-anchoring compensations around end-of-turn DOM
 * churn) can never re-engage following: without this, a completion-time
 * anchoring adjustment landing inside the near-bottom band yanked readers
 * who had deliberately parked slightly above the live edge back to the
 * bottom. The one unattributed engage is a downward arrival at the true live
 * edge (scrollbar dragged to the very end — Chromium scrollbars emit no
 * input events); anchoring compensations preserve the reader's distance and
 * clamps move upward, so neither can land there. Native CSS scroll anchoring
 * stays enabled: its adjustments keep the reading position stable while
 * content above changes.
 *
 * A module-level memory map (keyed by chat identity) preserves the reading
 * position across pane remounts (view toggles, dock/full-screen switches).
 * A conversation with no memory lands at the bottom. Because a remounted
 * transcript rebuilds its content asynchronously, a restored position keeps
 * re-asserting itself on resize ticks until the content is tall enough to
 * hold it (or a user scroll / timeout cancels the restore).
 */

export type ChatScrollMode = 'chat' | 'code'

/** Within this many px of the content bottom counts as "near bottom": the
 * jump-to-latest button hides, and a downward user scroll re-engages
 * following. */
export const NEAR_BOTTOM_PX = 80
/** Hard "at the live edge" tolerance (sub-pixel metrics, clamp events). */
export const AT_BOTTOM_EPSILON_PX = 2
/** A restored reading position keeps re-asserting itself for this long while
 * the remounted transcript's content is still growing back underneath it. */
const RESTORE_WINDOW_MS = 1500
/** How long after direct user input (wheel, touch, scroll keys) a scroll
 * event is still attributed to that gesture. Attributed scroll events
 * refresh the window, so trackpad momentum and smooth keyboard scrolling
 * stay attributed for their whole run. */
const USER_INPUT_WINDOW_MS = 250
/** A sent message is pinned this far below the viewport top — enough to show
 * the inter-message gap (32px) plus a sliver of the previous turn, so the
 * jump reads as continuous rather than a fresh page. */
export const SEND_ANCHOR_PEEK_PX = 48
/** How long a send keeps waiting for its message row to render (the active
 * pane is store-backed: the row lands only after the send's IPC round-trip
 * and turn-event emit). A row that hasn't appeared by then belongs to a
 * queued message that will start a later turn — repositioning for it out of
 * the blue would be a yank, not navigation. */
const SEND_ANCHOR_DEADLINE_MS = 3000

/** Keys that scroll a container when it (or a non-editable descendant) has
 * focus. */
const SCROLL_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
])

export interface ChatScrollSnapshot {
  nearBottom: boolean
  following: boolean
}

export interface ChatScrollElements {
  /** The overflow-y:auto scroll container. */
  container: HTMLElement
  /** The element wrapping the transcript's content (message list). */
  content: HTMLElement
  /** Empty trailing sibling of `content` used for send-anchor slack. */
  spacer: HTMLElement
}

interface ScrollMemoryEntry {
  top: number
  following: boolean
}

// Reading positions per chat identity, surviving pane remounts within an app
// run. Bounded by the number of chats visited; entries are inert until a pane
// with the same key mounts again.
const scrollMemoryByKey = new Map<string, ScrollMemoryEntry>()

/** Test hook: forget all remembered reading positions. */
export function resetChatScrollMemory(): void {
  scrollMemoryByKey.clear()
}

export interface ChatScrollOptions {
  mode?: ChatScrollMode
  /** Chat identity for cross-remount reading-position memory. */
  memoryKey?: string
}

export class ChatScrollController {
  private mode: ChatScrollMode
  private memoryKey?: string
  private els: ChatScrollElements | null = null
  private observer: ResizeObserver | null = null
  private listeners = new Set<(snapshot: ChatScrollSnapshot) => void>()

  private following = true
  private nearBottom = true
  private lastTop = 0
  private spacerHeight = 0
  // Timestamp of the last direct user input (wheel, touch, scroll key) —
  // scroll events within USER_INPUT_WINDOW_MS of it are the user's.
  private lastUserInputAt = Number.NEGATIVE_INFINITY

  // Send-anchor state ('chat' mode): while set, resize ticks keep the spacer
  // slack maintained (shrink-only) so the anchored message stays reachable at
  // the viewport top without ever introducing new blank space.
  private anchorId: string | null = null
  private anchorSlackCap = 0

  // A send whose message row hasn't rendered yet (store-backed chats append
  // the row only after the IPC round-trip). Resize ticks — which fire exactly
  // when the row lands — retry it; user scroll intent or the deadline cancels
  // it. `baselineUserRowId` snapshots the last user row at request time so an
  // id mismatch (optimistic App id vs the store's `${turnId}:user` id) can
  // still resolve to the row the send actually produced.
  private pendingSendAnchor: {
    messageId: string | null
    baselineUserRowId: string | null
    deadline: number
  } | null = null

  // In-flight smooth scroll to the live edge (jump button): growth re-targets
  // the animation instead of fighting it with instant writes.
  private smoothPending = false

  // Restored reading position still re-asserting itself (see module docs).
  private restore: { top: number; deadline: number } | null = null

  constructor(options: ChatScrollOptions = {}) {
    this.mode = options.mode ?? 'chat'
    this.memoryKey = options.memoryKey
  }

  setMode(mode: ChatScrollMode): void {
    this.mode = mode
  }

  attach(els: ChatScrollElements): void {
    this.detach()
    this.els = els

    els.container.addEventListener('scroll', this.handleScroll, { passive: true })
    els.container.addEventListener('wheel', this.handleWheel, { passive: true })
    els.container.addEventListener('touchstart', this.handleTouch, { passive: true })
    els.container.addEventListener('touchmove', this.handleTouch, { passive: true })
    els.container.addEventListener('keydown', this.handleKeyDown)

    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(this.handleResize)
      this.observer.observe(els.container)
      this.observer.observe(els.content)
    }

    const entry = this.memoryKey ? scrollMemoryByKey.get(this.memoryKey) : undefined
    if (entry && !entry.following) {
      this.following = false
      this.restore = { top: entry.top, deadline: now() + RESTORE_WINDOW_MS }
      this.write(entry.top)
    } else {
      this.following = true
      this.writeBottom()
    }
    this.updateNearBottom()
  }

  detach(): void {
    if (!this.els) return
    this.saveMemory()
    this.els.container.removeEventListener('scroll', this.handleScroll)
    this.els.container.removeEventListener('wheel', this.handleWheel)
    this.els.container.removeEventListener('touchstart', this.handleTouch)
    this.els.container.removeEventListener('touchmove', this.handleTouch)
    this.els.container.removeEventListener('keydown', this.handleKeyDown)
    this.observer?.disconnect()
    this.observer = null
    this.els = null
    this.restore = null
    this.pendingSendAnchor = null
    this.smoothPending = false
  }

  subscribe(listener: (snapshot: ChatScrollSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => {
      this.listeners.delete(listener)
    }
  }

  snapshot(): ChatScrollSnapshot {
    return { nearBottom: this.nearBottom, following: this.following }
  }

  /** Return to the live edge and follow it. */
  jumpToLatest(behavior: 'instant' | 'smooth' = 'instant'): void {
    const els = this.els
    if (!els) return
    this.restore = null
    this.pendingSendAnchor = null
    this.following = true
    const top = this.maxTop()
    if (behavior === 'smooth' && typeof els.container.scrollTo === 'function') {
      this.smoothPending = true
      els.container.scrollTo({ top, behavior: 'smooth' })
      // The animation's scroll events keep lastTop/nearBottom current.
    } else {
      this.smoothPending = false
      this.write(top)
    }
    this.updateNearBottom()
    this.notify()
  }

  /**
   * A user send in 'chat' mode: an explicit navigation action that always
   * repositions — regardless of where the reader had scrolled — pinning the
   * new message near the viewport top (SEND_ANCHOR_PEEK_PX of the prior turn
   * stays visible for continuity) with spacer slack below so the position is
   * reachable while the response is still short.
   *
   * The message row may not exist yet: the active pane is store-backed, so
   * the row renders only after the send's round-trip, and its durable id
   * (`${turnId}:user…`) never matches the caller's optimistic id. The
   * request stays pending and resize ticks resolve it — by id when present,
   * otherwise to the first user row that appears after the request. A user
   * scroll gesture or the deadline cancels it; exactly one reposition
   * happens per send.
   */
  requestSendAnchor(messageId: string | null): void {
    if (!this.els) return
    this.pendingSendAnchor = {
      messageId,
      baselineUserRowId: this.lastUserRow()?.getAttribute('data-message-id') ?? null,
      deadline: now() + SEND_ANCHOR_DEADLINE_MS,
    }
    this.trySendAnchor()
  }

  /**
   * Pin the given message near the viewport top now. Returns false when the
   * element isn't in the DOM (see requestSendAnchor for the deferred path).
   */
  anchorToMessage(messageId: string): boolean {
    const els = this.els
    if (!els) return false
    const anchor = els.content.querySelector<HTMLElement>(
      `[data-message-id="${messageId}"]`
    )
    if (!anchor) return false
    this.applyAnchorToElement(anchor, messageId)
    return true
  }

  private trySendAnchor(): void {
    const pending = this.pendingSendAnchor
    const els = this.els
    if (!pending || !els) return
    if (now() > pending.deadline) {
      this.pendingSendAnchor = null
      return
    }
    let anchor = pending.messageId
      ? els.content.querySelector<HTMLElement>(
          `[data-message-id="${pending.messageId}"]`
        )
      : null
    if (!anchor) {
      const lastUserRow = this.lastUserRow()
      if (
        lastUserRow &&
        lastUserRow.getAttribute('data-message-id') !== pending.baselineUserRowId
      ) {
        anchor = lastUserRow
      }
    }
    if (!anchor) return
    this.pendingSendAnchor = null
    this.applyAnchorToElement(
      anchor,
      anchor.getAttribute('data-message-id') ?? pending.messageId ?? null
    )
  }

  /** The last user message row (`is-user` is the Message component's own
   * role marker, on the same element as data-message-id). */
  private lastUserRow(): HTMLElement | null {
    const els = this.els
    if (!els) return null
    const rows = els.content.querySelectorAll<HTMLElement>('[data-message-id]')
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].classList.contains('is-user')) return rows[i]
    }
    return null
  }

  private applyAnchorToElement(anchor: HTMLElement, anchorId: string | null): void {
    const els = this.els
    if (!els) return
    this.cancelSmooth()
    this.restore = null
    this.pendingSendAnchor = null
    this.anchorId = anchorId

    const targetTop = Math.max(0, this.anchorTopInContent(anchor) - SEND_ANCHOR_PEEK_PX)
    const contentHeight = els.container.scrollHeight - this.spacerHeight
    const slack = Math.max(
      0,
      Math.ceil(targetTop - (contentHeight - els.container.clientHeight))
    )
    this.anchorSlackCap = slack
    this.setSpacerHeight(slack)

    this.write(targetTop)
    this.following = false
    this.updateNearBottom()
    this.notify()
  }

  // --- internals ---

  private handleScroll = (): void => {
    const els = this.els
    if (!els) return
    const top = els.container.scrollTop
    const delta = top - this.lastTop
    this.lastTop = top

    // Echoes of our own writes (lastTop is pre-updated on every write) and
    // sub-pixel noise carry no state changes at all.
    if (Math.abs(delta) > 1) {
      this.restore = null
      const attributed = this.isUserAttributed()
      const distance = this.distanceFromBottom()
      if (delta < 0) {
        // The view moved up past the live-edge tolerance: scrollbar drag,
        // touch, keyboard or wheel — stop following, never yank back down.
        // AT the tolerance this is a browser clamp after content shrank
        // (end-of-turn card collapses) and carries no intent: pinned readers
        // stay pinned, parked readers stay parked.
        if (distance > AT_BOTTOM_EPSILON_PX) {
          this.following = false
          this.cancelSmooth()
          // The reader took over before a pending send reposition landed —
          // applying it late would be a yank.
          this.pendingSendAnchor = null
        }
      } else if (attributed && distance <= NEAR_BOTTOM_PX) {
        // A downward user gesture back into the near-bottom band resumes
        // following.
        this.following = true
        this.pendingSendAnchor = null
      } else if (distance <= AT_BOTTOM_EPSILON_PX && this.spacerHeight === 0) {
        // Unattributed downward arrivals engage only at the true live edge:
        // that's a scrollbar dragged to the very end (scrollbars emit no
        // input events). Native anchoring compensations preserve the
        // reader's distance and so can never land here — the end-of-turn
        // re-engage bug this model exists to prevent. While send-anchor
        // slack exists the edge is ambiguous (positions inside the blank
        // slack also measure distance 0), so only attributed gestures engage
        // then.
        this.following = true
      }
      // Keep momentum / smooth-keyboard scroll chains attributed to the
      // gesture that started them.
      if (attributed) this.lastUserInputAt = now()
    }
    // A settling smooth animation ends in sub-pixel deltas — check outside
    // the intent gate.
    if (this.smoothPending && this.distanceFromBottom() <= AT_BOTTOM_EPSILON_PX) {
      this.smoothPending = false
    }

    this.saveMemory()
    this.updateNearBottom()
    this.notify()
  }

  private handleWheel = (event: WheelEvent): void => {
    const els = this.els
    if (!els) return
    this.lastUserInputAt = now()
    if (event.deltaY >= 0) return
    if (els.container.scrollHeight <= els.container.clientHeight) return
    // Any upward wheel over the transcript is review intent — including one
    // consumed by a nested scrollable (terminal output, code block), whose
    // reader would otherwise be yanked along by the following transcript.
    // Latching here (before any scroll event) makes the disengage immune to
    // interleaved follow writes swallowing the scroll event's delta.
    this.following = false
    this.cancelSmooth()
    this.pendingSendAnchor = null
    this.notify()
  }

  private handleTouch = (): void => {
    this.lastUserInputAt = now()
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (!SCROLL_KEYS.has(event.key)) return
    const target = event.target
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT')
    ) {
      // Typing/caret movement in an editable inside the transcript is not a
      // scroll gesture.
      return
    }
    this.lastUserInputAt = now()
  }

  private isUserAttributed(): boolean {
    return now() - this.lastUserInputAt <= USER_INPUT_WINDOW_MS
  }

  private handleResize = (): void => {
    if (!this.els) return
    // A resize tick is exactly when a just-sent message's row lands.
    this.trySendAnchor()
    this.maintainAnchorSpacer()
    if (this.restore) {
      if (now() > this.restore.deadline) {
        this.restore = null
      } else {
        const target = this.restore.top
        this.write(target)
        // Content is tall enough to hold the position — restore complete.
        if (this.maxTop() >= target) this.restore = null
      }
    } else if (this.following) {
      this.writeBottom()
    }
    this.updateNearBottom()
    this.notify()
  }

  /** Largest scrollTop that still shows content (spacer slack excluded), so
   * "the bottom" always means the content's live edge, not blank space. */
  private maxTop(): number {
    const els = this.els
    if (!els) return 0
    return Math.max(
      0,
      els.container.scrollHeight - this.spacerHeight - els.container.clientHeight
    )
  }

  private distanceFromBottom(): number {
    const els = this.els
    if (!els) return 0
    return Math.max(0, this.maxTop() - els.container.scrollTop)
  }

  private write(top: number): void {
    const els = this.els
    if (!els) return
    els.container.scrollTop = top
    // Read back (the browser clamps) so the echoed scroll event computes a
    // zero delta and is never mistaken for user intent.
    this.lastTop = els.container.scrollTop
  }

  private writeBottom(): void {
    if (this.smoothPending) {
      // Re-target the in-flight animation instead of snapping.
      this.els?.container.scrollTo({ top: this.maxTop(), behavior: 'smooth' })
      return
    }
    this.write(this.maxTop())
  }

  private cancelSmooth(): void {
    const els = this.els
    if (!this.smoothPending || !els) return
    this.smoothPending = false
    // Re-assigning the current position interrupts an in-flight native
    // smooth scroll.
    const top = els.container.scrollTop
    els.container.scrollTop = top
    this.lastTop = top
  }

  private maintainAnchorSpacer(): void {
    const els = this.els
    if (!els || this.mode !== 'chat' || !this.anchorId) return
    const anchor = els.content.querySelector<HTMLElement>(
      `[data-message-id="${this.anchorId}"]`
    )
    if (!anchor) {
      // The anchored message left the DOM (conversation replaced) — drop the
      // slack rather than preserving blank space for nothing.
      this.anchorId = null
      this.setSpacerHeight(0)
      return
    }
    const targetTop = Math.max(0, this.anchorTopInContent(anchor) - SEND_ANCHOR_PEEK_PX)
    const contentHeight = els.container.scrollHeight - this.spacerHeight
    const required = Math.max(
      0,
      Math.ceil(targetTop - (contentHeight - els.container.clientHeight))
    )
    // Shrink-only: slack is consumed as the response grows and never comes
    // back, so layout shifts above the anchor can't inject new blank space.
    const slack = Math.min(required, this.anchorSlackCap)
    this.anchorSlackCap = slack
    if (slack !== this.spacerHeight) this.setSpacerHeight(slack)
    if (slack === 0) this.anchorId = null
  }

  private setSpacerHeight(height: number): void {
    const els = this.els
    if (!els) return
    this.spacerHeight = height
    els.spacer.style.height = `${height}px`
  }

  private anchorTopInContent(anchor: HTMLElement): number {
    const els = this.els
    if (!els) return 0
    const containerTop = els.container.getBoundingClientRect().top
    return anchor.getBoundingClientRect().top - containerTop + els.container.scrollTop
  }

  private updateNearBottom(): void {
    this.nearBottom = this.distanceFromBottom() <= NEAR_BOTTOM_PX
  }

  private saveMemory(): void {
    if (!this.memoryKey) return
    scrollMemoryByKey.set(this.memoryKey, {
      top: this.lastTop,
      following: this.following,
    })
  }

  private notify(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
