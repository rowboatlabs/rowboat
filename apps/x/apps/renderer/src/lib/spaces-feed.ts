import type { spaces } from '@x/shared'
import { createBroadcastFeed, type FeedListener } from '@/lib/broadcast-feed'

// Live frames from every subscribed space, wrapped with their orgId. Main
// holds one WebSocket per org (core SpacesLive) and broadcasts frames here;
// views subscribe per space via 'spaces:subscribeSpace' and filter this feed.
// Same shape as the turn-event spine (turn-feed.ts).

const spacesFeed = createBroadcastFeed<spaces.SpacesBusEvent>((listener) =>
  window.ipc.on('spaces:events', listener),
)

export function subscribeSpacesFeed(listener: FeedListener<spaces.SpacesBusEvent>): () => void {
  return spacesFeed.subscribe(listener)
}
