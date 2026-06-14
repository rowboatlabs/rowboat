import type { SessionBusEvent } from '@x/shared/src/sessions.js'

// The ONE global consumer of the sessions:events IPC feed. A single
// window.ipc.on listener fans out in-memory to every subscriber, so hooks
// (useAgentTurn / useAgentSession) tap this shared feed instead of each opening
// their own IPC listener. Mirrors the old runtime's single global bus consumer.

type Listener = (event: SessionBusEvent) => void

const listeners = new Set<Listener>()
let detach: (() => void) | null = null

function ensureStarted(): void {
  if (detach) return
  detach = window.ipc.on('sessions:events', (event) => {
    // Copy to an array first so a listener that (un)subscribes during dispatch
    // doesn't mutate the set mid-iteration.
    for (const listener of [...listeners]) {
      try {
        listener(event)
      } catch {
        // A misbehaving subscriber must never break the feed for others.
      }
    }
  })
}

export function subscribeSessionFeed(listener: Listener): () => void {
  ensureStarted()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
