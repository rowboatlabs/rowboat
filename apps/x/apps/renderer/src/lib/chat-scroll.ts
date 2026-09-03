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
 * - 'chat' (ChatGPT semantics): a send anchors the new user message at the
 *   top of the viewport, padding the scroll range with spacer slack so the
 *   message can reach the top even while the response is still short. The
 *   response streams below the fold without moving the view; the slack is
 *   consumed (shrink-only) as content grows. Following is off after a send
 *   until the user returns to the bottom.
 * - 'code' (Codex transcript semantics): sends jump straight to the live
 *   edge and follow the run's output. No top-anchoring.
 *
 * Programmatic scrolls are distinguished from user scrolls by updating the
 * internal `lastTop` bookkeeping immediately after every write, so the echoed
 * scroll event reads as a zero-delta and never flips user intent. Native CSS
 * scroll anchoring stays enabled: its adjustments preserve the reading
 * position when content above the viewport changes, and the delta rules below
 * are ordered so a clamp/anchor adjustment at the bottom cannot break
 * following.
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

  // Send-anchor state ('chat' mode): while set, resize ticks keep the spacer
  // slack maintained (shrink-only) so the anchored message stays reachable at
  // the viewport top without ever introducing new blank space.
  private anchorId: string | null = null
  private anchorSlackCap = 0
  private anchorPaddingTop = 0

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
    this.observer?.disconnect()
    this.observer = null
    this.els = null
    this.restore = null
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
   * 'chat'-mode send: pin the message at the viewport top, padding the scroll
   * range with spacer slack so it can get there while the response is still
   * short. Returns false when the message element isn't in the DOM yet (the
   * caller may retry on the next frame).
   */
  anchorToMessage(messageId: string): boolean {
    const els = this.els
    if (!els) return false
    const anchor = els.content.querySelector<HTMLElement>(
      `[data-message-id="${messageId}"]`
    )
    if (!anchor) return false

    this.cancelSmooth()
    this.restore = null
    this.anchorId = messageId
    this.anchorPaddingTop = readPaddingTop(els.content)

    const targetTop = Math.max(0, this.anchorTopInContent(anchor) - this.anchorPaddingTop)
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
    return true
  }

  // --- internals ---

  private handleScroll = (): void => {
    const els = this.els
    if (!els) return
    const top = els.container.scrollTop
    const delta = top - this.lastTop
    this.lastTop = top

    // Echoes of our own writes (lastTop is pre-updated on every write) and
    // sub-pixel noise carry no user intent: only genuine movement may change
    // follow state or take over from a pending restore.
    if (Math.abs(delta) > 1) {
      this.restore = null
      const distance = this.distanceFromBottom()
      if (distance <= AT_BOTTOM_EPSILON_PX) {
        // At the live edge — includes clamp/anchoring adjustments when
        // content shrinks while pinned, which must not break following.
        this.following = true
      } else if (delta < 0) {
        // Deliberate upward movement: stop following, never yank back down.
        this.following = false
        this.cancelSmooth()
      } else if (distance <= NEAR_BOTTOM_PX) {
        // Scrolled back down into the near-bottom band: resume following.
        this.following = true
      }
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
    if (event.deltaY >= 0) return
    if (els.container.scrollHeight <= els.container.clientHeight) return
    // Any upward wheel over the transcript is review intent — including one
    // consumed by a nested scrollable (terminal output, code block), whose
    // reader would otherwise be yanked along by the following transcript.
    this.following = false
    this.cancelSmooth()
    this.notify()
  }

  private handleResize = (): void => {
    if (!this.els) return
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
    const targetTop = Math.max(0, this.anchorTopInContent(anchor) - this.anchorPaddingTop)
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

function readPaddingTop(el: HTMLElement): number {
  const value = Number.parseFloat(window.getComputedStyle(el).paddingTop || '0')
  return Number.isFinite(value) ? value : 0
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
