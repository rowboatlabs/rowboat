import type { z } from 'zod'
import {
  isDurableTurnEvent,
  reduceTurn,
  type TurnBusEvent,
  type TurnEvent,
} from '@x/shared/src/turns.js'
import type { TurnState } from '@x/shared/src/turns.js'

// Follows one turn live, regardless of where it runs — session chat, headless
// background/knowledge runners, spawned sub-agents.
//
// Join protocol: subscribe to the turn feed first (buffering), fetch the
// durable snapshot, then extend the snapshot with feed events. Each durable
// feed event carries its 1-based file offset, so events already covered by
// the snapshot are discarded and a contiguity gap (e.g. the subscription
// raced turn start) falls back to a snapshot refetch. A failed snapshot fetch
// retries a few times and again on the next feed event for this turn, so a
// turn whose file is still being created self-heals.

export interface TurnFollowerDeps {
  fetchTurn: (turnId: string) => Promise<{ events: Array<z.infer<typeof TurnEvent>> }>
  subscribe: (listener: (event: TurnBusEvent) => void) => () => void
  onState: (state: TurnState) => void
  onError: (message: string) => void
  // Fired when snapshot retries are exhausted (the id may not be a turn at
  // all — e.g. a pre-migration legacy run). A later feed event still retries
  // and can recover.
  onSnapshotFailed?: (message: string) => void
  retryDelayMs?: number
  maxRetries?: number
}

const DEFAULT_RETRY_DELAY_MS = 1000
const DEFAULT_MAX_RETRIES = 3

export function followTurn(turnId: string, deps: TurnFollowerDeps): () => void {
  const retryDelayMs = deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  const maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES

  let alive = true
  // null until a snapshot lands; feed events buffer in `pending` meanwhile.
  let events: Array<z.infer<typeof TurnEvent>> | null = null
  let pending: TurnBusEvent[] = []
  let fetching = false
  let retries = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  const publish = () => {
    if (!alive || !events) return
    try {
      deps.onState(reduceTurn(events))
    } catch (err) {
      deps.onError(err instanceof Error ? err.message : String(err))
    }
  }

  // Extends `events` with one feed event; false signals a contiguity gap.
  const apply = (e: TurnBusEvent): boolean => {
    if (!events || e.offset === undefined || !isDurableTurnEvent(e.event)) {
      return true
    }
    if (e.offset <= events.length) {
      return true // already covered by the snapshot
    }
    if (e.offset === events.length + 1) {
      events.push(e.event)
      return true
    }
    return false
  }

  const resync = () => {
    events = null
    void fetchSnapshot()
  }

  const fetchSnapshot = async () => {
    if (fetching || !alive) return
    fetching = true
    try {
      const turn = await deps.fetchTurn(turnId)
      if (!alive) return
      retries = 0
      events = turn.events
      const buffered = pending
      pending = []
      for (const e of buffered) {
        if (!apply(e)) {
          fetching = false
          resync()
          return
        }
      }
      publish()
    } catch (err) {
      if (!alive) return
      // Turn file may not exist yet (subscription raced creation) or the
      // fetch failed transiently.
      events = null
      if (retries < maxRetries) {
        retries += 1
        retryTimer = setTimeout(() => void fetchSnapshot(), retryDelayMs)
      } else {
        deps.onSnapshotFailed?.(err instanceof Error ? err.message : String(err))
      }
    } finally {
      fetching = false
    }
  }

  const unsubscribe = deps.subscribe((e) => {
    if (!alive || e.turnId !== turnId) return
    if (!isDurableTurnEvent(e.event) || e.offset === undefined) return
    if (!events) {
      pending.push(e)
      void fetchSnapshot()
      return
    }
    if (apply(e)) {
      publish()
    } else {
      pending = [e]
      resync()
    }
  })

  void fetchSnapshot()
  return () => {
    alive = false
    if (retryTimer) clearTimeout(retryTimer)
    unsubscribe()
  }
}
