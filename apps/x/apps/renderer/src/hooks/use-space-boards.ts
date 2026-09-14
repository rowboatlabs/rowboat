import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { spaces } from '@x/shared'
import { subscribeSpacesFeed } from '@/lib/spaces-feed'

// The whiteboards each space has, for the assistant composer's @ menu. A
// board is an asset under whiteboards/, so this is the space's file listing
// filtered — held module-level like the rosters (use-space-members.ts) so
// every composer shares one fetch per space, refreshed when the live feed
// reports a board saved, created, renamed or trashed.

export interface SpaceBoard {
  path: string
  name: string
}

const EMPTY_BOARDS: SpaceBoard[] = []
/** Listings age out only so a menu opened after a long idle is not stale forever; the feed is the real refresh. */
const REFRESH_MIN_MS = 5 * 60_000

let boardState: ReadonlyMap<string, SpaceBoard[]> = new Map()
const listeners = new Set<() => void>()
const loading = new Set<string>()
const loadedAt = new Map<string, number>()
let busWired = false

function key(orgId: string, spaceId: string): string {
  return `${orgId}/${spaceId}`
}

function emit(): void {
  for (const l of listeners) l()
}

function setBoards(k: string, boards: SpaceBoard[]): void {
  const prev = boardState.get(k)
  // Identity-stable: a refetch that changed nothing must not re-render the menu.
  if (prev && JSON.stringify(prev) === JSON.stringify(boards)) return
  const next = new Map(boardState)
  next.set(k, boards)
  boardState = next
  emit()
}

async function loadBoards(orgId: string, spaceId: string): Promise<void> {
  const k = key(orgId, spaceId)
  if (loading.has(k)) return
  loading.add(k)
  try {
    const { entries } = await window.ipc.invoke('spaces:listAssets', { orgId, spaceId })
    loadedAt.set(k, Date.now())
    const boards = entries
      .filter((e) => spaces.isWhiteboardPath(e.path) && !e.state)
      // Most recently touched first — the board someone is working on ranks first in the menu.
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((e) => ({ path: e.path, name: spaces.whiteboardDisplayName(e.path) }))
    setBoards(k, boards)
  } catch {
    // org unreachable — whatever was listed stands until a retry.
  } finally {
    loading.delete(k)
  }
}

/** A board saved, created, renamed or trashed anywhere the app is subscribed: refetch that space's list. */
function wireBus(): void {
  if (busWired) return
  busWired = true
  subscribeSpacesFeed((event) => {
    if (!('frame' in event)) return
    const frame = event.frame
    if (frame.kind !== 'event' || frame.event.type !== 'change') return
    const cs = frame.event.changeSet
    const touchesBoard = spaces.isWhiteboardPath(cs.assetPath) || (cs.movedFrom !== undefined && spaces.isWhiteboardPath(cs.movedFrom))
    if (!touchesBoard) return
    if (!boardState.has(key(event.orgId, frame.spaceId))) return
    void loadBoards(event.orgId, frame.spaceId)
  })
}

function subscribeBoards(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/**
 * The boards of every listed space, per org: org id → space id → boards.
 * One hook call for a variable number of orgs, keyed on the ids so a space
 * joined later follows without a remount. Identity-stable while nothing
 * changed, so callers can memo on the map.
 */
export function useOrgBoards(
  orgs: ReadonlyArray<{ id: string; spaceIds: readonly string[] }>,
): ReadonlyMap<string, ReadonlyMap<string, SpaceBoard[]>> {
  const orgsKey = orgs.map((o) => `${o.id}:${o.spaceIds.join('|')}`).join(';')
  const state = useSyncExternalStore(subscribeBoards, () => boardState)
  useEffect(() => {
    wireBus()
    const now = Date.now()
    for (const org of orgs) {
      for (const spaceId of org.spaceIds) {
        const k = key(org.id, spaceId)
        if (!boardState.has(k) || now - (loadedAt.get(k) ?? 0) >= REFRESH_MIN_MS) void loadBoards(org.id, spaceId)
      }
    }
    // The joined key IS the dependency — the array identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgsKey])
  return useMemo(() => {
    const out = new Map<string, Map<string, SpaceBoard[]>>()
    for (const org of orgs) {
      const perSpace = new Map<string, SpaceBoard[]>()
      for (const spaceId of org.spaceIds) perSpace.set(spaceId, state.get(key(org.id, spaceId)) ?? EMPTY_BOARDS)
      out.set(org.id, perSpace)
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, orgsKey])
}
