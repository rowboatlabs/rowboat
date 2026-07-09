import type { SessionBusEvent } from '@x/shared/src/sessions.js'
import {
  createBroadcastFeed,
  type FeedListener,
  type FeedSource,
} from '@/lib/broadcast-feed'

// One shared consumer of the sessions:events push channel; stores tap this
// fan-out instead of each opening their own IPC listener.

export type SessionFeedListener = FeedListener<SessionBusEvent>
export type SessionFeedSource = FeedSource<SessionBusEvent>

export function createSessionFeed(source: SessionFeedSource) {
  return createBroadcastFeed<SessionBusEvent>(source)
}

const appFeed = createSessionFeed((listener) => window.ipc.on('sessions:events', listener))

export function subscribeSessionFeed(listener: SessionFeedListener): () => void {
  return appFeed.subscribe(listener)
}
