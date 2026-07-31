import { useEffect, useSyncExternalStore } from 'react'

// Tab metadata reported by CONTENT, read by the tab strip.
//
// Ownership inversion: instead of the tab strip deriving a tab's title/busy
// state from app-level lists (App's `runs`, `processingRunIds`), the content
// component that lives inside the tab reports its own meta here, keyed by tab
// id. The strip prefers reported meta and falls back to its legacy
// `getTabTitle` / `isProcessing` props for content that has not migrated
// (notes/code/bases file tabs, draft chats with no resolved title).
//
// Design notes:
// - Fields are individually optional; `undefined` means "no claim" and hands
//   that field back to the strip's fallback derivation. `reportTabMeta` is a
//   MERGE: only keys present in the patch are written (an explicitly-undefined
//   key withdraws that field's claim).
// - Dedupe: reporting values identical to what is stored emits nothing and
//   allocates nothing. This matters because one chat renders as TWO live
//   ChatSession instances (full-screen App pane + side-pane chat) that report
//   the same values.
// - Snapshot stability: the store keeps one immutable Map snapshot, rebuilt
//   only on an actual change; per-tab entry objects are reused untouched when
//   another tab changes. `useTabMeta` / `useAllTabMeta` are therefore safe
//   with useSyncExternalStore (no fresh-object-per-read render loops).
// - Lifecycle: with two instances per chat, "clear on unmount" must not let
//   the last unmount wipe a still-live instance's report. Instances hold a
//   refcount via `retainTabMeta`; the entry is deleted only when the LAST
//   holder releases. `useReportTabMeta` bundles retain/release + merge
//   reporting for component use. `clearTabMeta` is the unconditional wipe
//   (owner/tests); live instances re-assert on their next report.

export interface TabMeta {
  title?: string
  busy?: boolean
}

const EMPTY_META: TabMeta = Object.freeze({})

let snapshot: ReadonlyMap<string, TabMeta> = new Map()
const refCounts = new Map<string, number>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function commit(mutate: (next: Map<string, TabMeta>) => void): void {
  const next = new Map(snapshot)
  mutate(next)
  snapshot = next
  emit()
}

/**
 * Merge `patch` into the tab's reported meta. Keys absent from the patch are
 * left as-is; keys present overwrite (explicit `undefined` withdraws the
 * claim). No-ops (identical resulting meta) do not emit.
 */
export function reportTabMeta(tabId: string, patch: TabMeta): void {
  const prev = snapshot.get(tabId)
  const next: TabMeta = {
    title: 'title' in patch ? patch.title : prev?.title,
    busy: 'busy' in patch ? patch.busy : prev?.busy,
  }
  if (prev && prev.title === next.title && prev.busy === next.busy) return
  if (!prev && next.title === undefined && next.busy === undefined) return
  commit((map) => map.set(tabId, next))
}

/** Unconditionally drop a tab's reported meta (falls back to strip props). */
export function clearTabMeta(tabId: string): void {
  if (!snapshot.has(tabId)) return
  commit((map) => map.delete(tabId))
}

export function getTabMeta(tabId: string): TabMeta {
  return snapshot.get(tabId) ?? EMPTY_META
}

export function getAllTabMeta(): ReadonlyMap<string, TabMeta> {
  return snapshot
}

export function subscribeTabMeta(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Register a live reporting instance for this tab. Returns a release function
 * (idempotent). The tab's meta is deleted only when the last holder releases,
 * so one of two co-mounted instances unmounting never wipes the other's
 * report.
 */
export function retainTabMeta(tabId: string): () => void {
  refCounts.set(tabId, (refCounts.get(tabId) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const remaining = (refCounts.get(tabId) ?? 1) - 1
    if (remaining > 0) {
      refCounts.set(tabId, remaining)
      return
    }
    refCounts.delete(tabId)
    clearTabMeta(tabId)
  }
}

export function useTabMeta(tabId: string): TabMeta {
  return useSyncExternalStore(subscribeTabMeta, () => getTabMeta(tabId))
}

export function useAllTabMeta(): ReadonlyMap<string, TabMeta> {
  return useSyncExternalStore(subscribeTabMeta, getAllTabMeta)
}

/**
 * Component-side reporter: holds a refcount for the component's lifetime and
 * merge-reports both fields whenever they change. Passing `undefined` for a
 * field withdraws the claim so the strip's fallback derivation shows through.
 */
export function useReportTabMeta(tabId: string, meta: TabMeta): void {
  useEffect(() => retainTabMeta(tabId), [tabId])
  useEffect(() => {
    reportTabMeta(tabId, { title: meta.title, busy: meta.busy })
  }, [tabId, meta.title, meta.busy])
}

// Test-only.
export function __resetTabMetaForTests(): void {
  snapshot = new Map()
  refCounts.clear()
  listeners.clear()
}
