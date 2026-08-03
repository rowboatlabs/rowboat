import { useSyncExternalStore } from 'react'
import { subscribeSessionFeed } from '@/lib/session-chat/feed'

// Reactive session-title lookup for content components (ChatSessionPane
// reports its tab title from here — see lib/tab-meta.ts).
//
// One module-level cache of sessionId -> title:
// - Seeded lazily ONCE (first subscriber) from `sessions:list` — shared across
//   every consumer, so N chat panes cost one IPC call total.
// - Kept live from the session feed's `index-changed` events (published on
//   every index write: create, turn settled, title change, delete).
// - The feed subscription starts BEFORE the seed fetch resolves; sessions
//   touched by a feed event in that window are skipped when the (older) seed
//   lands, so the seed can never roll a title back.
//
// Only sessions with a real title are stored: an untitled session resolves to
// `undefined`, which callers treat as "no claim" (App's fallback derivation —
// including the optimistic first-send title in its `runs` state — shows
// through).

let titles = new Map<string, string>()
const touchedBeforeSeed = new Set<string>()
let started = false
let seeded = false
let stopFeed: (() => void) | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** Returns true when the cache changed. */
function applyTitle(sessionId: string, title: string | undefined): boolean {
  if (title === undefined) return titles.delete(sessionId)
  if (titles.get(sessionId) === title) return false
  titles.set(sessionId, title)
  return true
}

function ensureStarted(): void {
  if (started) return
  started = true
  stopFeed = subscribeSessionFeed((event) => {
    if (event.kind !== 'index-changed') return
    if (!seeded) touchedBeforeSeed.add(event.sessionId)
    if (applyTitle(event.sessionId, event.entry?.title)) emit()
  })
  window.ipc
    .invoke('sessions:list', {})
    .then(({ sessions }) => {
      let changed = false
      for (const entry of sessions) {
        if (touchedBeforeSeed.has(entry.sessionId)) continue
        if (applyTitle(entry.sessionId, entry.title)) changed = true
      }
      if (changed) emit()
    })
    .catch((err: unknown) => {
      console.error('session-title: failed to seed from sessions:list', err)
    })
    .finally(() => {
      seeded = true
      touchedBeforeSeed.clear()
    })
}

export function sessionTitleFor(sessionId: string | null | undefined): string | undefined {
  return sessionId ? titles.get(sessionId) : undefined
}

export function subscribeSessionTitles(listener: () => void): () => void {
  ensureStarted()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Reactive title for a session; `undefined` while unknown/untitled (or when
 * `sessionId` is null). Snapshot is a primitive string, so it is referentially
 * stable between changes.
 */
export function useSessionTitle(sessionId: string | null | undefined): string | undefined {
  return useSyncExternalStore(subscribeSessionTitles, () => sessionTitleFor(sessionId))
}

// Test-only.
export function __resetSessionTitlesForTests(): void {
  stopFeed?.()
  stopFeed = null
  titles = new Map()
  touchedBeforeSeed.clear()
  started = false
  seeded = false
  listeners.clear()
}
