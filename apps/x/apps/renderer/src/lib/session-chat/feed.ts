import type { SessionBusEvent } from '@x/shared/src/sessions.js'

export type SessionFeedListener = (event: SessionBusEvent) => void
export type SessionFeedSource = (listener: SessionFeedListener) => () => void

// One shared consumer of the sessions:events push channel; stores tap this
// fan-out instead of each opening their own IPC listener. Factory so tests
// can drive a fake source.
export function createSessionFeed(source: SessionFeedSource) {
  const listeners = new Set<SessionFeedListener>()
  let detach: (() => void) | null = null

  const ensureStarted = () => {
    if (detach) return
    detach = source((event) => {
      // Copy so (un)subscribing during dispatch is safe.
      for (const listener of [...listeners]) {
        try {
          listener(event)
        } catch {
          // A misbehaving subscriber must never break the feed.
        }
      }
    })
  }

  return {
    subscribe(listener: SessionFeedListener): () => void {
      ensureStarted()
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

const appFeed = createSessionFeed((listener) => window.ipc.on('sessions:events', listener))

export function subscribeSessionFeed(listener: SessionFeedListener): () => void {
  return appFeed.subscribe(listener)
}
