import type { z } from 'zod'
import type { UserMessage } from '@x/shared/src/message.js'
import type {
  QueuedSessionMessage,
  SessionBusEvent,
  SessionIndexEntry,
} from '@x/shared/src/sessions.js'
import {
  isDurableTurnEvent,
  reduceTurn,
  type JsonValue,
  type TurnBusEvent,
  type TurnEvent,
  type TurnState,
} from '@x/shared/src/turns.js'
import type { SendMessageConfig, SessionsClient } from './client'
import type { SessionFeedListener } from './feed'
import {
  applyOverlay,
  buildSessionChatState,
  emptyOverlay,
  type LiveOverlay,
  type SessionChatState,
} from './turn-view'

type TEvent = z.infer<typeof TurnEvent>

export interface SessionChatSnapshot {
  sessionId: string | null
  chatState: SessionChatState | null
  latestTurnId: string | null
  // Messages accepted while the latest turn runs, waiting in the ephemeral
  // main-process queue to steer it (or start the next turn). Mirrored from
  // queue-changed bus events; editable/removable until delivered.
  queued: QueuedSessionMessage[]
  loading: boolean
  error: string | null
}

export interface SessionChatStoreDeps {
  client: SessionsClient
  // The turns:events spine (durable events with offsets, plus deltas for
  // turns this window subscribed to).
  subscribeTurnFeed: (listener: (event: TurnBusEvent) => void) => () => void
  // sessions:events — queue-changed mirrors for the active session.
  subscribeSessionFeed: (listener: (event: SessionBusEvent) => void) => () => void
  // Declares "this window is watching turn X" so main forwards its deltas;
  // returns the unsubscribe.
  subscribeDeltas: (turnId: string) => () => void
  // Schedules a coalesced snapshot flush; returns a cancel. Defaults to a
  // requestAnimationFrame + timeout race (see defaultScheduleEmit). Tests
  // inject a synchronous scheduler to keep assertions immediate.
  scheduleEmit?: (flush: () => void) => () => void
}

// One flush per animation frame: an end-of-turn burst (model_call_completed
// + turn_completed, plus tool_result in code mode) becomes ONE React commit,
// so the transcript's net height change lands in a single layout and the
// scroll controller adjusts once, pre-paint — instead of a visible
// up-then-down wobble across back-to-back commits. The timeout backstop
// keeps streaming state flowing when rAF is throttled (occluded window) or
// unavailable (non-DOM environments).
function defaultScheduleEmit(flush: () => void): () => void {
  let settled = false
  const run = () => {
    if (settled) return
    settled = true
    cancel()
    flush()
  }
  const rafId =
    typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : null
  const timeoutId = setTimeout(run, 50)
  function cancel() {
    if (rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId)
    }
    clearTimeout(timeoutId)
  }
  return () => {
    settled = true
    cancel()
  }
}

// Framework-agnostic controller for one active session's chat. Owns all the
// logic (seeding via getSession/getTurn, applying live feed events with the
// shared reducer, the ephemeral overlay, action routing); the useSessionChat
// hook is a thin useSyncExternalStore subscription over it.
export class SessionChatStore {
  private readonly client: SessionsClient
  private readonly subscribeTurnFeed: (listener: (event: TurnBusEvent) => void) => () => void
  private readonly subscribeSessionFeed: (listener: (event: SessionBusEvent) => void) => () => void
  private readonly subscribeDeltas: (turnId: string) => () => void
  private feedDisconnect: (() => void) | null = null
  private sessionFeedDisconnect: (() => void) | null = null
  private readonly listeners = new Set<() => void>()
  private readonly scheduleEmit: (flush: () => void) => () => void
  // Cancel for the scheduled flush; non-null means an emit is pending and
  // further emit() calls coalesce into it. State mutations always happen
  // synchronously before emit(), so deferring the derive drops nothing and
  // cannot reorder — the flush derives from the latest state.
  private cancelScheduledEmit: (() => void) | null = null

  private sessionId: string | null = null
  // Settled earlier turns, reduced once and frozen.
  private priorTurns: TurnState[] = []
  // The latest turn's raw event log; re-reduced on each durable event.
  private latestEvents: TEvent[] | null = null
  private overlay: LiveOverlay = emptyOverlay()
  private queued: QueuedSessionMessage[] = []
  private loading = false
  private error: string | null = null
  // Guards stale async loads after a session switch.
  private generation = 0
  // The turn whose deltas this window currently receives.
  private deltaTurnId: string | null = null
  private deltaUnsub: (() => void) | null = null

  private snapshot: SessionChatSnapshot = {
    sessionId: null,
    chatState: null,
    latestTurnId: null,
    queued: [],
    loading: false,
    error: null,
  }

  constructor(deps: SessionChatStoreDeps) {
    this.client = deps.client
    this.subscribeTurnFeed = deps.subscribeTurnFeed
    this.subscribeSessionFeed = deps.subscribeSessionFeed
    this.subscribeDeltas = deps.subscribeDeltas
    this.scheduleEmit = deps.scheduleEmit ?? defaultScheduleEmit
  }

  // Feed attachment is effect-managed and idempotent so React StrictMode's
  // mount -> cleanup -> mount cycle re-attaches cleanly (a constructor-made
  // subscription would be torn down by the first cleanup and never restored).
  connect(): () => void {
    if (!this.feedDisconnect) {
      this.feedDisconnect = this.subscribeTurnFeed(this.onTurnEvent)
      this.sessionFeedDisconnect = this.subscribeSessionFeed(this.onSessionEvent)
      this.syncDeltas()
    }
    return () => {
      this.feedDisconnect?.()
      this.feedDisconnect = null
      this.sessionFeedDisconnect?.()
      this.sessionFeedDisconnect = null
      this.syncDeltas()
      // A pending coalesced flush must not be lost across teardown (e.g.
      // StrictMode's mount → cleanup → mount): deliver it now.
      if (this.cancelScheduledEmit) {
        this.cancelScheduledEmit()
        this.cancelScheduledEmit = null
        this.flushEmit()
      }
    }
  }

  // Keep exactly one delta subscription: the latest turn, while connected.
  private syncDeltas(): void {
    const want =
      this.feedDisconnect && this.latestEvents
        ? this.latestEvents[0].turnId
        : null
    if (want === this.deltaTurnId) return
    this.deltaUnsub?.()
    this.deltaUnsub = null
    this.deltaTurnId = want
    if (want) {
      this.deltaUnsub = this.subscribeDeltas(want)
    }
  }

  subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange)
    return () => {
      this.listeners.delete(onChange)
    }
  }

  getSnapshot = (): SessionChatSnapshot => this.snapshot

  async setSession(sessionId: string | null): Promise<void> {
    if (sessionId === this.sessionId) return
    this.generation += 1
    const generation = this.generation
    this.sessionId = sessionId
    this.priorTurns = []
    this.latestEvents = null
    this.overlay = emptyOverlay()
    this.queued = []
    this.error = null
    this.loading = sessionId !== null
    this.syncDeltas()
    this.emit()
    if (sessionId === null) return

    try {
      const state = await this.client.get(sessionId)
      const [turns, queued] = await Promise.all([
        Promise.all(state.turns.map((ref) => this.client.getTurn(ref.turnId))),
        // Seed the pending-queue mirror; queue-changed events keep it live.
        this.client.listQueued(sessionId).then(({ queue }) => queue),
      ])
      if (generation !== this.generation) return
      const reduced = turns.map((turn) => reduceTurn(turn.events))
      this.priorTurns = reduced.slice(0, -1)
      this.latestEvents = turns.length > 0 ? turns[turns.length - 1].events : null
      this.queued = queued
      this.loading = false
      this.syncDeltas()
      this.emit()
    } catch (error) {
      if (generation !== this.generation) return
      console.error('[session-chat] failed to load session', sessionId, error)
      this.loading = false
      this.error = error instanceof Error ? error.message : String(error)
      this.emit()
    }
  }

  private onSessionEvent = (event: SessionBusEvent): void => {
    if (event.kind !== 'queue-changed' || event.sessionId !== this.sessionId) return
    this.queued = event.queue
    this.emit()
  }

  private onTurnEvent = (event: TurnBusEvent): void => {
    if (this.sessionId === null || event.sessionId !== this.sessionId) return
    const turnEvent = event.event
    if (isDurableTurnEvent(turnEvent) && event.offset !== undefined) {
      if (turnEvent.type === 'turn_created') {
        // A new turn started for this session: freeze the previous latest.
        this.freezeLatest()
        this.latestEvents = [turnEvent]
        this.overlay = emptyOverlay()
        this.syncDeltas()
      } else if (this.latestEvents && this.latestEvents[0].turnId === event.turnId) {
        // Offset join against the local log: drop already-known events,
        // append the contiguous next line, refetch on a gap.
        if (event.offset <= this.latestEvents.length) {
          return
        }
        if (event.offset === this.latestEvents.length + 1) {
          this.latestEvents.push(turnEvent)
        } else {
          void this.reloadTurn(event.turnId)
          return
        }
      } else {
        // An event for a turn we haven't seen (missed turn_created, e.g. the
        // feed attached mid-turn): reconcile by refetching that turn.
        void this.reloadTurn(event.turnId)
        return
      }
    } else if (!this.latestEvents || this.latestEvents[0].turnId !== event.turnId) {
      // Deltas are ephemeral: only the latest turn's deltas paint the overlay.
      return
    }
    this.overlay = applyOverlay(this.overlay, turnEvent)
    this.emit()
  }

  private freezeLatest(): void {
    if (!this.latestEvents) return
    try {
      this.priorTurns = [...this.priorTurns, reduceTurn(this.latestEvents)]
    } catch {
      // A turn we can't reduce is dropped from history rather than wedging
      // the whole conversation.
    }
    this.latestEvents = null
  }

  private async reloadTurn(turnId: string): Promise<void> {
    const generation = this.generation
    try {
      const turn = await this.client.getTurn(turnId)
      if (generation !== this.generation) return
      if (this.latestEvents && this.latestEvents[0].turnId !== turnId) {
        this.freezeLatest()
      }
      this.latestEvents = turn.events
      this.syncDeltas()
      this.emit()
    } catch (error) {
      // The next snapshot-worthy event will retry.
      console.error('[session-chat] failed to reload turn', turnId, error)
    }
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  sendMessage = async (
    input: z.infer<typeof UserMessage>,
    config: SendMessageConfig,
  ): Promise<{ turnId: string }> => {
    if (!this.sessionId) throw new Error('No active session')
    return this.client.sendMessage(this.sessionId, input, config)
  }

  // Deliver-ASAP send: never rejects for a busy session — the message queues
  // and steers the live turn (or starts the next one) at the earliest safe
  // point.
  sendOrQueueMessage = async (
    input: z.infer<typeof UserMessage>,
    config: SendMessageConfig,
  ): Promise<{ queued: false; turnId: string } | { queued: true; queueId: string }> => {
    if (!this.sessionId) throw new Error('No active session')
    return this.client.sendOrQueueMessage(this.sessionId, input, config)
  }

  editQueued = async (
    queueId: string,
    message: z.infer<typeof UserMessage>,
  ): Promise<void> => {
    if (!this.sessionId) return
    await this.client.editQueued(this.sessionId, queueId, message)
  }

  removeQueued = async (
    queueId: string,
  ): Promise<QueuedSessionMessage | null> => {
    if (!this.sessionId) return null
    const { removed } = await this.client.removeQueued(this.sessionId, queueId)
    return removed
  }

  respondToPermission = async (
    toolCallId: string,
    decision: 'allow' | 'deny',
    metadata?: JsonValue,
  ): Promise<void> => {
    const turnId = this.snapshot.latestTurnId
    if (!turnId) return
    await this.client.respondToPermission(turnId, toolCallId, decision, metadata)
  }

  answerAskHuman = async (toolCallId: string, answer: string): Promise<void> => {
    const turnId = this.snapshot.latestTurnId
    if (!turnId) return
    await this.client.respondToAskHuman(turnId, toolCallId, answer)
  }

  // Stops the latest turn. Pending queued messages are drained by the stop
  // (never auto-started after it) and returned so the composer can restore
  // their text.
  stop = async (): Promise<QueuedSessionMessage[]> => {
    const turnId = this.snapshot.latestTurnId
    if (!turnId) return []
    const { dequeued } = await this.client.stopTurn(turnId)
    return dequeued
  }

  // ── Derivation ──────────────────────────────────────────────────────────

  private emit(): void {
    if (this.cancelScheduledEmit) return
    // A synchronous scheduler (tests) runs the flush before returning its
    // cancel — only keep the cancel when the flush is genuinely pending.
    let flushed = false
    const cancel = this.scheduleEmit(() => {
      flushed = true
      this.cancelScheduledEmit = null
      this.flushEmit()
    })
    if (!flushed) this.cancelScheduledEmit = cancel
  }

  private flushEmit(): void {
    this.snapshot = this.derive()
    for (const listener of [...this.listeners]) {
      listener()
    }
  }

  private derive(): SessionChatSnapshot {
    let turns = this.priorTurns
    let error = this.error
    if (this.latestEvents) {
      try {
        turns = [...this.priorTurns, reduceTurn(this.latestEvents)]
      } catch (reduceError) {
        error =
          reduceError instanceof Error ? reduceError.message : String(reduceError)
      }
    }
    const latest = turns[turns.length - 1]
    return {
      sessionId: this.sessionId,
      chatState:
        this.sessionId !== null && !this.loading
          ? buildSessionChatState(turns, this.overlay)
          : null,
      latestTurnId: latest?.definition.turnId ?? null,
      queued: this.queued,
      loading: this.loading,
      error,
    }
  }
}

// ---------------------------------------------------------------------------
// Session list store
// ---------------------------------------------------------------------------

export interface SessionListSnapshot {
  sessions: SessionIndexEntry[]
  loading: boolean
}

export interface SessionListStoreDeps {
  client: SessionsClient
  // sessions:events — index-changed entries for the session list.
  subscribeFeed: (listener: SessionFeedListener) => () => void
}

export class SessionListStore {
  private readonly client: SessionsClient
  private readonly subscribeFeed: (listener: SessionFeedListener) => () => void
  private feedDisconnect: (() => void) | null = null
  private readonly listeners = new Set<() => void>()
  private entries = new Map<string, SessionIndexEntry>()
  private loading = true
  private snapshot: SessionListSnapshot = { sessions: [], loading: true }

  constructor(deps: SessionListStoreDeps) {
    this.client = deps.client
    this.subscribeFeed = deps.subscribeFeed
  }

  connect(): () => void {
    if (!this.feedDisconnect) {
      this.feedDisconnect = this.subscribeFeed(this.onFeedEvent)
    }
    return () => {
      this.feedDisconnect?.()
      this.feedDisconnect = null
    }
  }

  subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange)
    return () => {
      this.listeners.delete(onChange)
    }
  }

  getSnapshot = (): SessionListSnapshot => this.snapshot

  async load(): Promise<void> {
    const { sessions } = await this.client.list()
    this.entries = new Map(sessions.map((entry) => [entry.sessionId, entry]))
    this.loading = false
    this.emit()
  }

  private onFeedEvent: SessionFeedListener = (event: SessionBusEvent) => {
    if (event.kind !== 'index-changed') return
    if (event.entry === null) {
      this.entries.delete(event.sessionId)
    } else {
      this.entries.set(event.sessionId, event.entry)
    }
    this.emit()
  }

  private emit(): void {
    this.snapshot = {
      sessions: [...this.entries.values()].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
      loading: this.loading,
    }
    for (const listener of [...this.listeners]) {
      listener()
    }
  }
}
