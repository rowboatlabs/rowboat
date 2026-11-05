import { afterEach, describe, expect, it, vi } from 'vitest'
import { followTurn, type TurnFollower, type TurnFollowerDeps } from './turn-follower.js'
import type { TurnBusEvent } from './turns.js'

type Snapshot = Awaited<ReturnType<TurnFollowerDeps['fetchTurn']>>

function log(): Snapshot['events'] {
  return [
    {
      type: 'turn_created', schemaVersion: 1, turnId: 't1', sessionId: 's1',
      ts: '2026-10-22T00:00:00Z',
      agent: {
        requested: { agentId: 'copilot' },
        resolved: {
          agentId: 'copilot', systemPrompt: 'SYS',
          model: { provider: 'openai', model: 'test' }, tools: [],
        },
      },
      context: [], input: { role: 'user', content: 'hello' },
      config: { autoPermission: false, humanAvailable: true, maxModelCalls: 20 },
    },
    {
      type: 'model_call_requested', turnId: 't1', ts: '2026-10-22T00:00:00Z',
      modelCallIndex: 0, request: { messages: ['input'], parameters: {} },
    },
    {
      type: 'model_call_completed', turnId: 't1', ts: '2026-10-22T00:00:01Z',
      modelCallIndex: 0, message: { role: 'assistant', content: 'done' },
      finishReason: 'stop', usage: {},
    },
    {
      type: 'turn_completed', turnId: 't1', ts: '2026-10-22T00:00:01Z',
      output: { role: 'assistant', content: 'done' }, finishReason: 'stop', usage: {},
    },
  ]
}

const followers: TurnFollower[] = []
afterEach(() => {
  for (const follower of followers.splice(0)) follower.stop()
})

function harness() {
  const requests: Array<{
    resolve: (snapshot: Snapshot) => void
    reject: (error: Error) => void
  }> = []
  const fetchTurn = vi.fn(() => new Promise<Snapshot>((resolve, reject) => {
    requests.push({ resolve, reject })
  }))
  let listener: (event: TurnBusEvent) => void = () => {}
  const unsubscribe = vi.fn()
  const onState = vi.fn()
  const onError = vi.fn()
  const onSnapshotFailed = vi.fn()
  const follower = followTurn('t1', {
    fetchTurn,
    subscribe: (fn) => { listener = fn; return unsubscribe },
    onState, onError, onSnapshotFailed, maxRetries: 0,
  })
  followers.push(follower)
  return {
    follower, requests, fetchTurn, onState, onError, onSnapshotFailed, unsubscribe,
    emit: (event: TurnBusEvent) => listener(event),
  }
}

describe('followTurn refetch during a snapshot request', () => {
  it('coalesces refetches and publishes only the fresh snapshot', async () => {
    const h = harness()
    h.follower.refetch()
    h.follower.refetch()
    expect(h.fetchTurn).toHaveBeenCalledTimes(1)

    h.requests[0].resolve({ events: log().slice(0, 3) })
    await Promise.resolve()
    expect(h.onState).not.toHaveBeenCalled()
    expect(h.fetchTurn).toHaveBeenCalledTimes(2)

    h.requests[1].resolve({ events: log() })
    await Promise.resolve()
    expect(h.onState).toHaveBeenCalledTimes(1)
    expect(h.onState.mock.calls[0][0].terminal?.type).toBe('turn_completed')
    expect(h.onError).not.toHaveBeenCalled()
  })

  it('starts the requested refetch even if the obsolete request fails', async () => {
    const h = harness()
    h.follower.refetch()
    h.requests[0].reject(new Error('old request failed'))
    await Promise.resolve()
    expect(h.onSnapshotFailed).not.toHaveBeenCalled()
    expect(h.fetchTurn).toHaveBeenCalledTimes(2)

    h.requests[1].resolve({ events: log() })
    await Promise.resolve()
    expect(h.onState.mock.calls[0][0].terminal?.type).toBe('turn_completed')
  })

  it('keeps feed events buffered across the obsolete request', async () => {
    const h = harness()
    h.follower.refetch()
    h.emit({ turnId: 't1', sessionId: 's1', event: log()[3], offset: 4 })
    h.requests[0].resolve({ events: log().slice(0, 3) })
    await Promise.resolve()
    expect(h.onState).not.toHaveBeenCalled()
    expect(h.fetchTurn).toHaveBeenCalledTimes(2)

    h.requests[1].resolve({ events: log().slice(0, 3) })
    await Promise.resolve()
    expect(h.onState).toHaveBeenCalledTimes(1)
    expect(h.onState.mock.calls[0][0].terminal?.type).toBe('turn_completed')
  })

  it('honors another refetch requested during the follow-up request', async () => {
    const h = harness()
    h.follower.refetch()
    h.requests[0].resolve({ events: log().slice(0, 3) })
    await Promise.resolve()
    expect(h.fetchTurn).toHaveBeenCalledTimes(2)

    h.follower.refetch()
    h.requests[1].resolve({ events: log().slice(0, 3) })
    await Promise.resolve()
    expect(h.onState).not.toHaveBeenCalled()
    expect(h.fetchTurn).toHaveBeenCalledTimes(3)

    h.requests[2].resolve({ events: log() })
    await Promise.resolve()
    expect(h.onState).toHaveBeenCalledTimes(1)
  })

  it('does not refetch or publish after stop', async () => {
    const h = harness()
    h.follower.refetch()
    h.follower.stop()
    h.requests[0].resolve({ events: log() })
    await Promise.resolve()
    expect(h.fetchTurn).toHaveBeenCalledTimes(1)
    expect(h.onState).not.toHaveBeenCalled()
    expect(h.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('applies a buffered contiguous event without an unnecessary refetch', async () => {
    const h = harness()
    h.emit({ turnId: 't1', sessionId: 's1', event: log()[3], offset: 4 })
    h.requests[0].resolve({ events: log().slice(0, 3) })
    await Promise.resolve()
    expect(h.fetchTurn).toHaveBeenCalledTimes(1)
    expect(h.onState.mock.calls[0][0].terminal?.type).toBe('turn_completed')
  })

  it('refetches a buffered offset gap after the current request settles', async () => {
    const h = harness()
    h.emit({ turnId: 't1', sessionId: 's1', event: log()[3], offset: 4 })
    h.requests[0].resolve({ events: log().slice(0, 1) })
    await Promise.resolve()
    expect(h.onState).not.toHaveBeenCalled()
    expect(h.fetchTurn).toHaveBeenCalledTimes(2)

    h.emit({ turnId: 't1', sessionId: 's1', event: log()[3], offset: 4 })
    expect(h.fetchTurn).toHaveBeenCalledTimes(2)
    h.requests[1].resolve({ events: log() })
    await Promise.resolve()
    expect(h.onState.mock.calls[0][0].terminal?.type).toBe('turn_completed')
    expect(h.onError).not.toHaveBeenCalled()
  })

  it('reports a failed current request once its retry budget is exhausted', async () => {
    const h = harness()
    h.requests[0].reject(new Error('snapshot failed'))
    await Promise.resolve()
    expect(h.onSnapshotFailed).toHaveBeenCalledExactlyOnceWith('snapshot failed')
    expect(h.fetchTurn).toHaveBeenCalledTimes(1)
  })
})
