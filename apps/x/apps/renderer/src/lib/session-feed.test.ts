import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionBusEvent } from '@x/shared/src/sessions.js'

// The feed is a module singleton, so reset modules per test for isolation.
let onHandler: ((e: SessionBusEvent) => void) | null = null
const onMock = vi.fn((_channel: string, handler: (e: SessionBusEvent) => void) => {
  onHandler = handler
  return () => undefined
})

beforeEach(() => {
  vi.resetModules()
  onHandler = null
  onMock.mockClear()
  ;(window as unknown as { ipc: unknown }).ipc = { on: onMock, invoke: vi.fn(), send: vi.fn() }
})

afterEach(() => {
  delete (window as unknown as { ipc?: unknown }).ipc
})

const ev = (turnId: string): SessionBusEvent => ({
  kind: 'event',
  turnId,
  sessionId: 's1',
  event: { type: 'text-delta', delta: 'x' },
})

describe('session feed', () => {
  it('registers exactly one IPC listener regardless of subscriber count', async () => {
    const { subscribeSessionFeed } = await import('./session-feed.js')
    subscribeSessionFeed(() => undefined)
    subscribeSessionFeed(() => undefined)
    expect(onMock).toHaveBeenCalledTimes(1)
    expect(onMock).toHaveBeenCalledWith('sessions:events', expect.any(Function))
  })

  it('fans out each event to every subscriber', async () => {
    const { subscribeSessionFeed } = await import('./session-feed.js')
    const a: SessionBusEvent[] = []
    const b: SessionBusEvent[] = []
    subscribeSessionFeed((e) => a.push(e))
    subscribeSessionFeed((e) => b.push(e))
    onHandler!(ev('t1'))
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
  })

  it('stops delivering after unsubscribe', async () => {
    const { subscribeSessionFeed } = await import('./session-feed.js')
    const seen: SessionBusEvent[] = []
    const off = subscribeSessionFeed((e) => seen.push(e))
    onHandler!(ev('t1'))
    off()
    onHandler!(ev('t2'))
    expect(seen).toHaveLength(1)
  })

  it('isolates a throwing subscriber from the rest', async () => {
    const { subscribeSessionFeed } = await import('./session-feed.js')
    const ok: SessionBusEvent[] = []
    subscribeSessionFeed(() => { throw new Error('boom') })
    subscribeSessionFeed((e) => ok.push(e))
    expect(() => onHandler!(ev('t1'))).not.toThrow()
    expect(ok).toHaveLength(1)
  })
})
