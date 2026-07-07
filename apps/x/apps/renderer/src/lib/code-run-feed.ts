import { useSyncExternalStore } from 'react'
import type { CodeRunEvent, CodeRunFeedEvent } from '@x/shared/src/code-mode.js'

// Renderer half of the ephemeral CodeRunFeed side-channel: buffers the live
// `codeRun:events` broadcast per toolCallId so tool cards can render a
// code_agent_run's activity while it streams. Module-level (not tied to any
// session store) so the buffer survives session switches mid-run. Nothing here
// is persisted — on settle the durable code-run-events-batch in the turn
// record supersedes the buffer, which is then dropped.
const buffers = new Map<string, CodeRunEvent[]>()
const listeners = new Set<() => void>()
const EMPTY: CodeRunEvent[] = []
// Backstop so abandoned runs can't grow the map forever (a run's buffer is
// normally dropped explicitly once its durable batch lands).
const MAX_TRACKED_RUNS = 32

let attached = false
function ensureAttached(): void {
  if (attached) return
  attached = true
  window.ipc.on('codeRun:events', ((raw: unknown) => {
    const { toolCallId, event } = raw as CodeRunFeedEvent
    if (!toolCallId || !event) return
    if (!buffers.has(toolCallId) && buffers.size >= MAX_TRACKED_RUNS) {
      const oldest = buffers.keys().next().value
      if (oldest !== undefined) buffers.delete(oldest)
    }
    // Immutable append: useSyncExternalStore consumers compare by reference.
    buffers.set(toolCallId, [...(buffers.get(toolCallId) ?? EMPTY), event])
    for (const listener of [...listeners]) listener()
  }) as never)
}

function subscribe(onChange: () => void): () => void {
  ensureAttached()
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

export function clearCodeRunBuffer(toolCallId: string): void {
  if (buffers.delete(toolCallId)) {
    for (const listener of [...listeners]) listener()
  }
}

// Live events for one code_agent_run tool call, empty once the durable batch
// takes over (or if the buffer never existed — e.g. after an app reload).
export function useCodeRunFeed(toolCallId: string): CodeRunEvent[] {
  return useSyncExternalStore(subscribe, () => buffers.get(toolCallId) ?? EMPTY)
}
