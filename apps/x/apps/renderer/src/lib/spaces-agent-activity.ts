import { useSyncExternalStore } from 'react'
import type { spaces } from '@x/shared'
import { subscribeSpacesFeed } from '@/lib/spaces-feed'

// "My Rowboat is working on this thread" — a mirror of core's agent-activity
// feed (core/spaces/agent-activity.ts). Core folds the runtime's turn and
// session buses into one list per org and emits the WHOLE list on every
// change (and every 10s while non-empty, so a window that loads mid-turn
// catches up); this store replaces its copy wholesale. Nothing is looked up
// or computed at render time: a thread row asks the map for its root id.

type Activity = spaces.SpaceAgentActivity
type ThreadMap = ReadonlyMap<string, Activity>

const EMPTY: ThreadMap = new Map()
const listsByOrg = new Map<string, Activity[]>()
// Per (org, space) views, rebuilt lazily after an org's list changes — a
// stable reference between changes, which useSyncExternalStore requires.
const views = new Map<string, ThreadMap>()
const listeners = new Set<() => void>()

subscribeSpacesFeed((event) => {
  if (!('agentActivity' in event)) return
  listsByOrg.set(event.orgId, event.agentActivity)
  for (const key of [...views.keys()]) {
    if (key.startsWith(`${event.orgId}/`)) views.delete(key)
  }
  for (const listener of listeners) listener()
})

function view(orgId: string, spaceId: string): ThreadMap {
  const key = `${orgId}/${spaceId}`
  let map = views.get(key)
  if (!map) {
    const inSpace = (listsByOrg.get(orgId) ?? []).filter((a) => a.spaceId === spaceId)
    map = inSpace.length === 0 ? EMPTY : new Map(inSpace.map((a) => [a.threadRootId, a]))
    views.set(key, map)
  }
  return map
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** threadRootId → this member's live agent activity there (queued or running), for one space. */
export function useSpaceAgentActivity(orgId: string, spaceId: string): ThreadMap {
  return useSyncExternalStore(subscribe, () => view(orgId, spaceId))
}
