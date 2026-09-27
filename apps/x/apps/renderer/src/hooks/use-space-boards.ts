import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { spaces } from '@x/shared'
import { subscribeSpacesFeed } from '@/lib/spaces-feed'

// The live file listing of every space the app knows, held module-level like
// the rosters (use-space-members.ts): one fetch per space shared by every
// consumer — the space composer's @ menu (files from every shared space), the
// assistant composer's @ menu (boards) and the open-board context. The open
// pane primes its own space from the listing it already holds; the rest
// refresh when the live feed reports a change in that space.

export interface SpaceBoard {
  /** The board's asset id — what the whiteboard tools and the collab channel take. */
  id: string
  /** Display path (whiteboards/<name>.excalidraw). */
  path: string
  name: string
}

const EMPTY_ENTRIES: spaces.SpacesAssetEntry[] = []
const EMPTY_BOARDS: SpaceBoard[] = []
/** Listings age out only so a menu opened after a long idle is not stale forever; the feed is the real refresh. */
const REFRESH_MIN_MS = 5 * 60_000
/** A burst of changes in one space (an agent folding several files) lands as ONE refetch. */
const CHANGE_DEBOUNCE_MS = 1_000

/** Live entries only (a trashed file is not something to link), keyed org/space. */
let listingState: ReadonlyMap<string, spaces.SpacesAssetEntry[]> = new Map()
const listeners = new Set<() => void>()
const loading = new Set<string>()
const loadedAt = new Map<string, number>()
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
let busWired = false

function key(orgId: string, spaceId: string): string {
  return `${orgId}/${spaceId}`
}

function emit(): void {
  for (const l of listeners) l()
}

function liveOnly(entries: readonly spaces.SpacesAssetEntry[]): spaces.SpacesAssetEntry[] {
  return entries.filter((e) => e.state !== 'deleted')
}

/**
 * The open space's pane already holds its listing: prime the store from it so
 * the @ menus and the assistant's context (the open board's path, by id)
 * never wait on a second fetch — and a file born in the pane is linkable
 * before the refetch lands.
 */
export function noteListingFromEntries(orgId: string, spaceId: string, entries: readonly spaces.SpacesAssetEntry[]): void {
  const k = key(orgId, spaceId)
  loadedAt.set(k, Date.now())
  setListing(k, liveOnly(entries))
}

/** A listed file's display path by id, or null when the store has not seen it. */
export function boardPathById(orgId: string, spaceId: string, assetId: string): string | null {
  return listingState.get(key(orgId, spaceId))?.find((e) => e.id === assetId)?.path ?? null
}

function setListing(k: string, entries: spaces.SpacesAssetEntry[]): void {
  const prev = listingState.get(k)
  // Identity-stable: a refetch that changed nothing must not re-render the menus.
  if (prev && JSON.stringify(prev) === JSON.stringify(entries)) return
  const next = new Map(listingState)
  next.set(k, entries)
  listingState = next
  emit()
}

/** Spaces whose listing changed while a fetch was already in flight — that fetch's snapshot predates the change, so one more run follows it. */
const dirty = new Set<string>()

/**
 * `changed`: the space's listing is known to have changed, so a fetch already
 * in flight (whose snapshot may predate the change) is followed by one more.
 * A mount-time load just joins the in-flight one.
 */
async function loadListing(orgId: string, spaceId: string, changed = false): Promise<void> {
  const k = key(orgId, spaceId)
  if (loading.has(k)) {
    if (changed) dirty.add(k)
    return
  }
  loading.add(k)
  try {
    const { entries } = await window.ipc.invoke('spaces:listAssets', { orgId, spaceId })
    loadedAt.set(k, Date.now())
    setListing(k, liveOnly(entries))
  } catch {
    // org unreachable — whatever was listed stands until a retry.
  } finally {
    loading.delete(k)
  }
  if (dirty.delete(k)) void loadListing(orgId, spaceId, true)
}

/** Any change in a space the store holds: refetch its listing once the burst settles. */
function wireBus(): void {
  if (busWired) return
  busWired = true
  subscribeSpacesFeed((event) => {
    if (!('frame' in event)) return
    const frame = event.frame
    if (frame.kind !== 'event' || frame.event.type !== 'change') return
    const k = key(event.orgId, frame.spaceId)
    if (!listingState.has(k) || refreshTimers.has(k)) return
    refreshTimers.set(
      k,
      setTimeout(() => {
        refreshTimers.delete(k)
        void loadListing(event.orgId, frame.spaceId, true)
      }, CHANGE_DEBOUNCE_MS),
    )
  })
}

function subscribeListings(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** Load (or age-refresh) every listed space of every org — the shared mount effect of the org-wide hooks. */
function useOrgListingLoads(orgs: ReadonlyArray<{ id: string; spaceIds: readonly string[] }>, orgsKey: string): void {
  useEffect(() => {
    const now = Date.now()
    for (const org of orgs) {
      for (const spaceId of org.spaceIds) {
        // The feed is only wired once there is a listing to keep fresh — a
        // host with nothing to list (no refs) never touches the bus.
        wireBus()
        const k = key(org.id, spaceId)
        if (!listingState.has(k) || now - (loadedAt.get(k) ?? 0) >= REFRESH_MIN_MS) void loadListing(org.id, spaceId)
      }
    }
    // The joined key IS the dependency — the array identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgsKey])
}

/**
 * The live files of every listed space, per org: org id → space id →
 * entries. One hook call for a variable number of orgs, keyed on the ids so
 * a space joined later follows without a remount. Identity-stable while
 * nothing changed, so callers can memo on the map.
 */
export function useOrgListings(
  orgs: ReadonlyArray<{ id: string; spaceIds: readonly string[] }>,
): ReadonlyMap<string, ReadonlyMap<string, spaces.SpacesAssetEntry[]>> {
  const orgsKey = orgs.map((o) => `${o.id}:${o.spaceIds.join('|')}`).join(';')
  const state = useSyncExternalStore(subscribeListings, () => listingState)
  useOrgListingLoads(orgs, orgsKey)
  return useMemo(() => {
    const out = new Map<string, Map<string, spaces.SpacesAssetEntry[]>>()
    for (const org of orgs) {
      const perSpace = new Map<string, spaces.SpacesAssetEntry[]>()
      for (const spaceId of org.spaceIds) perSpace.set(spaceId, state.get(key(org.id, spaceId)) ?? EMPTY_ENTRIES)
      out.set(org.id, perSpace)
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, orgsKey])
}

/** A listing's boards, cached per listing array so an untouched space keeps its array identity across refreshes elsewhere. */
const boardsCache = new WeakMap<spaces.SpacesAssetEntry[], SpaceBoard[]>()

function boardsOf(entries: spaces.SpacesAssetEntry[]): SpaceBoard[] {
  const hit = boardsCache.get(entries)
  if (hit) return hit
  const boards = entries
    .filter((e) => spaces.isWhiteboardPath(e.path))
    // Most recently touched first — the board someone is working on ranks first in the menu.
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((e) => ({ id: e.id, path: e.path, name: spaces.whiteboardDisplayName(e.path) }))
  boardsCache.set(entries, boards)
  return boards
}

/**
 * The boards of every listed space, per org — the assistant composer's @
 * menu. Same store as useOrgListings, filtered to whiteboards/.
 */
export function useOrgBoards(
  orgs: ReadonlyArray<{ id: string; spaceIds: readonly string[] }>,
): ReadonlyMap<string, ReadonlyMap<string, SpaceBoard[]>> {
  const orgsKey = orgs.map((o) => `${o.id}:${o.spaceIds.join('|')}`).join(';')
  const state = useSyncExternalStore(subscribeListings, () => listingState)
  useOrgListingLoads(orgs, orgsKey)
  return useMemo(() => {
    const out = new Map<string, Map<string, SpaceBoard[]>>()
    for (const org of orgs) {
      const perSpace = new Map<string, SpaceBoard[]>()
      for (const spaceId of org.spaceIds) {
        const entries = state.get(key(org.id, spaceId))
        perSpace.set(spaceId, entries ? boardsOf(entries) : EMPTY_BOARDS)
      }
      out.set(org.id, perSpace)
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, orgsKey])
}
