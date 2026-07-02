import type { z } from 'zod'
import type { UserMessage } from '@x/shared/src/message.js'
import type { SessionBusEvent, SessionIndexEntry } from '@x/shared/src/sessions.js'
import {
  reduceTurn,
  type JsonValue,
  type TurnEvent,
  type TurnState,
  type TurnStreamEvent,
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
  loading: boolean
  error: string | null
}

export interface SessionChatStoreDeps {
  client: SessionsClient
  subscribeFeed: (listener: SessionFeedListener) => () => void
}

// Framework-agnostic controller for one active session's chat. Owns all the
// logic (seeding via getSession/getTurn, applying live feed events with the
// shared reducer, the ephemeral overlay, action routing); the useSessionChat
// hook is a thin useSyncExternalStore subscription over it.
export class SessionChatStore {
  private readonly client: SessionsClient
  private readonly subscribeFeed: (listener: SessionFeedListener) => () => void
  private feedDisconnect: (() => void) | null = null
  private readonly listeners = new Set<() => void>()

  private sessionId: string | null = null
  // Settled earlier turns, reduced once and frozen.
  private priorTurns: TurnState[] = []
  // The latest turn's raw event log; re-reduced on each durable event.
  private latestEvents: TEvent[] | null = null
  private overlay: LiveOverlay = emptyOverlay()
  private loading = false
  private error: string | null = null
  // Guards stale async loads after a session switch.
  private generation = 0

  private snapshot: SessionChatSnapshot = {
    sessionId: null,
    chatState: null,
    latestTurnId: null,
    loading: false,
    error: null,
  }

  constructor(deps: SessionChatStoreDeps) {
    this.client = deps.client
    this.subscribeFeed = deps.subscribeFeed
  }

  // Feed attachment is effect-managed and idempotent so React StrictMode's
  // mount -> cleanup -> mount cycle re-attaches cleanly (a constructor-made
  // subscription would be torn down by the first cleanup and never restored).
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

  getSnapshot = (): SessionChatSnapshot => this.snapshot

  async setSession(sessionId: string | null): Promise<void> {
    if (sessionId === this.sessionId) return
    this.generation += 1
    const generation = this.generation
    this.sessionId = sessionId
    this.priorTurns = []
    this.latestEvents = null
    this.overlay = emptyOverlay()
    this.error = null
    this.loading = sessionId !== null
    this.emit()
    if (sessionId === null) return

    try {
      const state = await this.client.get(sessionId)
      const turns = await Promise.all(
        state.turns.map((ref) => this.client.getTurn(ref.turnId)),
      )
      if (generation !== this.generation) return
      const reduced = turns.map((turn) => reduceTurn(turn.events))
      this.priorTurns = reduced.slice(0, -1)
      this.latestEvents = turns.length > 0 ? turns[turns.length - 1].events : null
      this.loading = false
      this.emit()
    } catch (error) {
      if (generation !== this.generation) return
      console.error('[session-chat] failed to load session', sessionId, error)
      this.loading = false
      this.error = error instanceof Error ? error.message : String(error)
      this.emit()
    }
  }

  private onFeedEvent: SessionFeedListener = (event: SessionBusEvent) => {
    if (event.kind !== 'turn-event' || event.sessionId !== this.sessionId) return
    const turnEvent = event.event
    if (isDurable(turnEvent)) {
      if (turnEvent.type === 'turn_created') {
        // A new turn started for this session: freeze the previous latest.
        this.freezeLatest()
        this.latestEvents = [turnEvent]
        this.overlay = emptyOverlay()
      } else if (this.latestEvents && this.latestEvents[0].turnId === turnEvent.turnId) {
        this.latestEvents.push(turnEvent)
      } else {
        // An event for a turn we haven't seen (missed turn_created, e.g. the
        // feed attached mid-turn): reconcile by refetching that turn.
        void this.reloadTurn(event.turnId)
        return
      }
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

  stop = async (): Promise<void> => {
    const turnId = this.snapshot.latestTurnId
    if (!turnId) return
    await this.client.stopTurn(turnId)
  }

  // ── Derivation ──────────────────────────────────────────────────────────

  private emit(): void {
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
      loading: this.loading,
      error,
    }
  }
}

function isDurable(event: TurnStreamEvent): event is TEvent {
  return event.type !== 'text_delta' && event.type !== 'reasoning_delta'
}

// ---------------------------------------------------------------------------
// Session list store
// ---------------------------------------------------------------------------

export interface SessionListSnapshot {
  sessions: SessionIndexEntry[]
  loading: boolean
}

export class SessionListStore {
  private readonly client: SessionsClient
  private readonly subscribeFeed: (listener: SessionFeedListener) => () => void
  private feedDisconnect: (() => void) | null = null
  private readonly listeners = new Set<() => void>()
  private entries = new Map<string, SessionIndexEntry>()
  private loading = true
  private snapshot: SessionListSnapshot = { sessions: [], loading: true }

  constructor(deps: SessionChatStoreDeps) {
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
