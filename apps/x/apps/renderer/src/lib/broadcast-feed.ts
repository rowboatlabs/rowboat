// One shared consumer per broadcast IPC channel; stores and hooks tap this
// fan-out instead of each opening their own IPC listener. Factory so tests
// can drive a fake source.

export type FeedListener<T> = (event: T) => void
export type FeedSource<T> = (listener: FeedListener<T>) => () => void

export interface BroadcastFeed<T> {
  subscribe(listener: FeedListener<T>): () => void
}

export function createBroadcastFeed<T>(source: FeedSource<T>): BroadcastFeed<T> {
  const listeners = new Set<FeedListener<T>>()
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
    subscribe(listener: FeedListener<T>): () => void {
      ensureStarted()
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
