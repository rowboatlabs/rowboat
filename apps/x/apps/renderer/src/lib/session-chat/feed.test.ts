import { describe, expect, it } from 'vitest'
import type { SessionBusEvent } from '@x/shared/src/sessions.js'
import { createSessionFeed, type SessionFeedListener } from './feed'

const event: SessionBusEvent = {
  kind: 'index-changed',
  sessionId: 's1',
  entry: null,
}

describe('createSessionFeed', () => {
  it('starts the source lazily on first subscribe and fans events out', () => {
    let sourceStarted = 0
    let push: SessionFeedListener = () => undefined
    const feed = createSessionFeed((listener) => {
      sourceStarted += 1
      push = listener
      return () => undefined
    })
    expect(sourceStarted).toBe(0)

    const seenA: SessionBusEvent[] = []
    const seenB: SessionBusEvent[] = []
    feed.subscribe((e) => seenA.push(e))
    feed.subscribe((e) => seenB.push(e))
    expect(sourceStarted).toBe(1) // one shared IPC listener

    push(event)
    expect(seenA).toEqual([event])
    expect(seenB).toEqual([event])
  })

  it('unsubscribes cleanly and isolates a throwing listener', () => {
    let push: SessionFeedListener = () => undefined
    const feed = createSessionFeed((listener) => {
      push = listener
      return () => undefined
    })
    const seen: SessionBusEvent[] = []
    feed.subscribe(() => {
      throw new Error('bad subscriber')
    })
    const unsubscribe = feed.subscribe((e) => seen.push(e))

    push(event)
    expect(seen).toEqual([event])

    unsubscribe()
    push(event)
    expect(seen).toEqual([event])
  })
})
