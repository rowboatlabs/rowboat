import type { TurnBusEvent } from '@x/shared/src/turns.js'
import { createBroadcastFeed, type FeedListener } from '@/lib/broadcast-feed'

// The turn event spine: durable events of every turn the runtime executes —
// session chat, headless background/knowledge runners, spawned sub-agents —
// tagged with sessionId and the event's 1-based file offset. Consumers join a
// live turn by subscribing first, fetching the sessions:getTurn snapshot, and
// discarding feed events whose offset is already covered by the snapshot
// (see useTurn).

const appFeed = createBroadcastFeed<TurnBusEvent>((listener) =>
  window.ipc.on('turns:events', listener),
)

export function subscribeTurnFeed(listener: FeedListener<TurnBusEvent>): () => void {
  return appFeed.subscribe(listener)
}
