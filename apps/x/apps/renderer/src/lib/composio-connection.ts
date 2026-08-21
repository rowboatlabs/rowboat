export interface ComposioConnectionStatus {
  isConnected: boolean
  status?: string
}

export type ComposioConnectionOutcome =
  | { state: "connected" }
  | { state: "failed"; status: string }
  | { state: "timeout" }
  | { state: "cancelled" }

const TERMINAL_FAILURE_STATUSES = new Set(["FAILED", "EXPIRED", "INACTIVE"])

export const COMPOSIO_CONNECTION_POLL_INTERVAL_MS = 1_000
// Main owns the callback server for five minutes. Give its timeout event a
// small delivery grace period before the renderer declares the flow stale.
export const COMPOSIO_CONNECTION_TIMEOUT_MS = 5 * 60_000 + 5_000

interface WaitForComposioConnectionOptions {
  readStatus: () => Promise<ComposioConnectionStatus>
  isCurrent: () => boolean
  timeoutMs?: number
  pollIntervalMs?: number
  now?: () => number
  wait?: (ms: number) => Promise<void>
}

/**
 * Reconcile a browser OAuth flow with the status persisted by main.
 *
 * `composio:didConnect` remains the fast path, but renderer events are
 * transient: a reload, remount, or unlucky delivery race can miss one even
 * though the callback completed. Polling the persisted status makes the UI
 * converge instead of displaying "Connecting…" forever.
 */
export async function waitForComposioConnection({
  readStatus,
  isCurrent,
  timeoutMs = COMPOSIO_CONNECTION_TIMEOUT_MS,
  pollIntervalMs = COMPOSIO_CONNECTION_POLL_INTERVAL_MS,
  now = Date.now,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: WaitForComposioConnectionOptions): Promise<ComposioConnectionOutcome> {
  const deadline = now() + timeoutMs

  while (isCurrent()) {
    try {
      const result = await readStatus()
      if (!isCurrent()) return { state: "cancelled" }
      if (result.isConnected || result.status === "ACTIVE") {
        return { state: "connected" }
      }
      if (result.status && TERMINAL_FAILURE_STATUSES.has(result.status)) {
        return { state: "failed", status: result.status }
      }
    } catch {
      // A transient IPC/read failure should not strand the button or abort a
      // browser flow that may still complete. Retry until the shared deadline.
    }

    const remaining = deadline - now()
    if (remaining <= 0) return { state: "timeout" }
    await wait(Math.min(pollIntervalMs, remaining))
  }

  return { state: "cancelled" }
}
