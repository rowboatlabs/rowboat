import { useCallback, useEffect, useState } from 'react'
import type { LiveNote } from '@x/shared/dist/live-note.js'
import { useLiveNoteAgentStatus, type LiveNoteAgentState } from './use-live-note-agent-status'

export interface UseLiveNoteForPathResult {
  /** Parsed `live:` block, or null when the note is passive. */
  live: LiveNote | null
  /** Knowledge-relative path (no leading "knowledge/"). Empty when no path is provided. */
  knowledgeRelPath: string
  /** Most recent run state from the agent bus. */
  agentState: LiveNoteAgentState | null
  /** Whether the agent is currently running. Convenience read off agentState. */
  isRunning: boolean
  /** Loading flag for the initial fetch. */
  loading: boolean
  /** Force a refetch — useful after a mutation. */
  refresh: () => Promise<void>
  /** Tick value that increments once a minute so callers can keep relative-time labels fresh. */
  tick: number
}

function stripKnowledgePrefix(p: string | null | undefined): string {
  if (!p) return ''
  return p.replace(/^knowledge\//, '')
}

function isSamePath(a: string, b: string | undefined): boolean {
  if (!b) return false
  return a === b.replace(/^knowledge\//, '')
}

/**
 * Reactive view of a single note's `live:` block.
 *
 * - Fetches `live-note:get` on mount and whenever the path changes.
 * - Subscribes to `live-note-agent:events` (via `useLiveNoteAgentStatus`) to
 *   surface the running flag in real time.
 * - Listens to `workspace:didChange` so external edits to the file trigger a
 *   refetch.
 * - Refetches one extra time when an agent run completes so callers see fresh
 *   `lastRunAt` / `lastRunSummary` / `lastRunError` values.
 * - Ticks every minute so callers using `formatRelativeTime` get a fresh label
 *   without the underlying data changing.
 *
 * `notePath` may be either knowledge-relative (`Digest.md`) or workspace-rooted
 * (`knowledge/Digest.md`); the hook normalises internally.
 */
export function useLiveNoteForPath(notePath: string | null | undefined): UseLiveNoteForPathResult {
  const knowledgeRelPath = stripKnowledgePrefix(notePath ?? null)
  const [live, setLive] = useState<LiveNote | null>(null)
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)
  const agentStatusMap = useLiveNoteAgentStatus()
  const agentState = knowledgeRelPath ? agentStatusMap.get(knowledgeRelPath) ?? null : null
  const isRunning = agentState?.status === 'running'

  const refresh = useCallback(async () => {
    if (!knowledgeRelPath) { setLive(null); return }
    setLoading(true)
    try {
      const res = await window.ipc.invoke('live-note:get', { filePath: knowledgeRelPath })
      if (res.success) {
        setLive(res.live ?? null)
      }
    } catch {
      // Swallow — passive notes / missing files are fine; the next refresh retries.
    } finally {
      setLoading(false)
    }
  }, [knowledgeRelPath])

  // Initial fetch + on path change.
  useEffect(() => {
    void refresh()
  }, [refresh])

  // Refetch when the agent run completes (status flips to done/error) so
  // lastRunAt / lastRunError values picked up off disk are fresh.
  const agentStatus = agentState?.status
  useEffect(() => {
    if (agentStatus === 'done' || agentStatus === 'error') {
      void refresh()
    }
  }, [agentStatus, refresh])

  // Refetch on external file changes — covers the case where the runner
  // patched lastRunSummary on the same file we're viewing.
  useEffect(() => {
    if (!knowledgeRelPath) return
    const fullPath = `knowledge/${knowledgeRelPath}`
    const cleanup = window.ipc.on('workspace:didChange', (event) => {
      switch (event.type) {
        case 'created':
        case 'changed':
        case 'deleted':
          if (event.path === fullPath) void refresh()
          break
        case 'moved':
          if (event.from === fullPath || event.to === fullPath) void refresh()
          break
        case 'bulkChanged':
          if (event.paths?.some(p => isSamePath(knowledgeRelPath, p))) void refresh()
          break
      }
    })
    return cleanup
  }, [knowledgeRelPath, refresh])

  // Minute-by-minute tick to keep relative-time labels fresh.
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  return {
    live,
    knowledgeRelPath,
    agentState,
    isRunning,
    loading,
    refresh,
    tick,
  }
}
