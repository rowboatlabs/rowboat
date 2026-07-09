import { describe, expect, it, vi } from 'vitest'
import type { TurnBusEvent, TurnState } from '@x/shared/src/turns.js'
import { followTurn, type TurnFollowerDeps } from './turn-follower'
import {
  completed,
  created,
  requested,
  turnCompleted,
  assistantText,
  user,
  type TEvent,
} from './session-chat/test-fixtures'

const TURN = 't1'

function log(): TEvent[] {
  return [
    created(TURN, 's1', user('question')),
    requested(TURN, 0),
    completed(TURN, 0, assistantText('answer')),
    turnCompleted(TURN, 'answer'),
  ]
}

function bus(event: TEvent, offset: number): TurnBusEvent {
  return { turnId: TURN, sessionId: 's1', event, offset }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function harness(fetches: Array<TEvent[] | Error>) {
  const fetchTurn = vi.fn(async () => {
    const next = fetches.shift()
    if (!next || next instanceof Error) {
      throw next ?? new Error('no snapshot scripted')
    }
    return { events: [...next] }
  })
  let listener: ((event: TurnBusEvent) => void) | null = null
  let unsubscribed = false
  const states: TurnState[] = []
  const errors: string[] = []
  const deps: TurnFollowerDeps = {
    fetchTurn,
    subscribe: (fn) => {
      listener = fn
      return () => {
        unsubscribed = true
        listener = null
      }
    },
    onState: (state) => states.push(state),
    onError: (message) => errors.push(message),
    maxRetries: 0,
  }
  return {
    deps,
    fetchTurn,
    states,
    errors,
    emit: (event: TurnBusEvent) => listener?.(event),
    get unsubscribed() {
      return unsubscribed
    },
  }
}

describe('followTurn', () => {
  it('publishes the snapshot, then extends it with contiguous feed events', async () => {
    const full = log()
    const h = harness([full.slice(0, 2)])
    const detach = followTurn(TURN, h.deps)
    await flush()

    expect(h.states).toHaveLength(1)
    expect(h.states[0].modelCalls[0].response).toBeUndefined()

    h.emit(bus(full[2], 3))
    h.emit(bus(full[3], 4))

    expect(h.states).toHaveLength(3)
    const final = h.states[2]
    expect(final.terminal?.type).toBe('turn_completed')
    expect(h.errors).toEqual([])
    detach()
  })

  it('discards feed events already covered by the snapshot', async () => {
    const full = log()
    const h = harness([full])
    const detach = followTurn(TURN, h.deps)
    await flush()

    // Replays of already-snapshotted lines must not corrupt the reduction.
    h.emit(bus(full[2], 3))
    h.emit(bus(full[3], 4))

    expect(h.errors).toEqual([])
    expect(h.states[h.states.length - 1].terminal?.type).toBe('turn_completed')
    detach()
  })

  it('buffers events that arrive before the snapshot and applies them after', async () => {
    const full = log()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const h = harness([])
    h.deps.fetchTurn = vi.fn(async () => {
      await gate
      return { events: full.slice(0, 3) }
    })
    const detach = followTurn(TURN, h.deps)

    h.emit(bus(full[3], 4)) // arrives mid-fetch
    release()
    await flush()

    expect(h.states[h.states.length - 1].terminal?.type).toBe('turn_completed')
    expect(h.errors).toEqual([])
    detach()
  })

  it('refetches the snapshot on a contiguity gap', async () => {
    const full = log()
    const h = harness([full.slice(0, 2), full])
    const detach = followTurn(TURN, h.deps)
    await flush()

    // Offset 4 while the local log has 2 entries: events were missed.
    h.emit(bus(full[3], 4))
    await flush()

    expect(h.fetchTurn).toHaveBeenCalledTimes(2)
    expect(h.states[h.states.length - 1].terminal?.type).toBe('turn_completed')
    expect(h.errors).toEqual([])
    detach()
  })

  it('recovers from a failed snapshot when a feed event arrives', async () => {
    const full = log()
    const h = harness([new Error('turn file not created yet'), full])
    const detach = followTurn(TURN, h.deps)
    await flush()

    expect(h.states).toHaveLength(0)
    h.emit(bus(full[3], 4))
    await flush()

    expect(h.fetchTurn).toHaveBeenCalledTimes(2)
    expect(h.states[h.states.length - 1].terminal?.type).toBe('turn_completed')
    detach()
  })

  it('stops delivering after detach and unsubscribes from the feed', async () => {
    const full = log()
    const h = harness([full.slice(0, 2)])
    const detach = followTurn(TURN, h.deps)
    await flush()
    expect(h.states).toHaveLength(1)

    detach()
    expect(h.unsubscribed).toBe(true)
  })
})
