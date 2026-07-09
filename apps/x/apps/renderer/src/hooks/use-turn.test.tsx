import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TurnBusEvent } from '@x/shared/src/turns.js'
import {
  assistantText,
  completed,
  completedTurnLog,
  created,
  requested,
  turnCompleted,
  user,
  type TEvent,
} from '@/lib/session-chat/test-fixtures'
import { useTurn } from './use-turn'

// The hook wires the real turn-feed singleton and window.ipc, so the tests
// stub the preload surface: `on` captures the feed listener (the feed
// attaches lazily on first subscribe), `invoke` routes by channel through a
// per-test handler map.
let feedListener: ((event: TurnBusEvent) => void) | null = null
let handlers: Record<string, (args: unknown) => Promise<unknown>> = {}

;(window as unknown as { ipc: unknown }).ipc = {
  on: (channel: string, handler: (event: TurnBusEvent) => void) => {
    if (channel === 'turns:events') feedListener = handler
    return () => undefined
  },
  invoke: (channel: string, args: unknown) => {
    const handler = handlers[channel]
    return handler ? handler(args) : Promise.resolve({ success: true })
  },
}

function emit(event: TurnBusEvent): void {
  act(() => feedListener?.(event))
}

function durable(turnId: string, event: TEvent, offset: number): TurnBusEvent {
  return { turnId, sessionId: null, event, offset }
}

function serveTurns(turns: Record<string, TEvent[]>): void {
  handlers['sessions:getTurn'] = async (args) => {
    const { turnId } = args as { turnId: string }
    const events = turns[turnId]
    if (!events) throw new Error(`turn not found: ${turnId}`)
    return { turnId, events: [...events] }
  }
}

beforeEach(() => {
  handlers = {}
})

describe('useTurn', () => {
  it('fetches the snapshot and applies contiguous feed events', async () => {
    const T = 'turn-live'
    const full: TEvent[] = [
      created(T, 's1', user('go')),
      requested(T, 0),
      completed(T, 0, assistantText('done')),
      turnCompleted(T, 'done'),
    ]
    serveTurns({ [T]: full.slice(0, 2) })
    const { result } = renderHook(() => useTurn(T))

    await waitFor(() => expect(result.current.state).not.toBeNull())
    expect(result.current.state?.terminal).toBeUndefined()

    emit(durable(T, full[2], 3))
    emit(durable(T, full[3], 4))
    expect(result.current.state?.terminal?.type).toBe('turn_completed')
    expect(result.current.error).toBeNull()
  })

  it('resets state when turnId changes instead of showing the stale turn', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    serveTurns({ 'turn-a': completedTurnLog('turn-a', 's1', 'qa', 'aa') })
    const base = handlers['sessions:getTurn']
    handlers['sessions:getTurn'] = async (args) => {
      if ((args as { turnId: string }).turnId === 'turn-b') {
        await gate
        return { turnId: 'turn-b', events: completedTurnLog('turn-b', 's1', 'qb', 'ab') }
      }
      return base(args)
    }

    const { result, rerender } = renderHook(({ id }) => useTurn(id), {
      initialProps: { id: 'turn-a' },
    })
    await waitFor(() => expect(result.current.state).not.toBeNull())

    rerender({ id: 'turn-b' })
    // turn-b's snapshot is gated: the hook must show nothing, not turn-a.
    expect(result.current.state).toBeNull()

    release()
    await waitFor(() =>
      expect(result.current.state?.definition.turnId).toBe('turn-b'),
    )
  })

  it('keeps the last state while disabled and refetches on re-enable', async () => {
    const getTurn = vi.fn(async () => ({
      turnId: 'turn-a',
      events: completedTurnLog('turn-a', 's1', 'q', 'a'),
    }))
    handlers['sessions:getTurn'] = getTurn

    const { result, rerender } = renderHook(
      ({ enabled }) => useTurn('turn-a', { enabled }),
      { initialProps: { enabled: true } },
    )
    await waitFor(() => expect(result.current.state).not.toBeNull())
    const fetches = getTurn.mock.calls.length

    rerender({ enabled: false })
    expect(result.current.state).not.toBeNull() // kept while hidden

    rerender({ enabled: true })
    await waitFor(() =>
      expect(getTurn.mock.calls.length).toBeGreaterThan(fetches),
    )
    expect(result.current.state).not.toBeNull()
  })

  it('reports snapshotFailed after retries and recovers via a feed event', async () => {
    const T = 'turn-late'
    const full = completedTurnLog(T, 's1', 'q', 'a')
    let available = false
    handlers['sessions:getTurn'] = async () => {
      if (!available) throw new Error('not created yet')
      return { turnId: T, events: [...full] }
    }

    const { result } = renderHook(() => useTurn(T, { maxRetries: 0 }))
    await waitFor(() => expect(result.current.snapshotFailed).toBe(true))
    expect(result.current.state).toBeNull()

    available = true
    emit(durable(T, full[full.length - 1], full.length))
    await waitFor(() => expect(result.current.state).not.toBeNull())
    expect(result.current.snapshotFailed).toBe(false)
  })
})
