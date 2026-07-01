import { useEffect, useState } from "react"

export type AgentStatus = { installed: boolean; signedIn: boolean }
export type CodeModeAgentStatus = { claude: AgentStatus; codex: AgentStatus }

// Engine provisioning runs in the main process and keeps going even if the UI that
// started it (the Settings dialog OR the onboarding step) unmounts. Track its state at
// MODULE level — shared across both — so whichever view is mounted shows the live %
// instead of restarting. This is what lets a download kicked off from onboarding show
// its progress later in Settings → Code Mode. A single persistent listener on the
// progress channel feeds this store.
export type ProvState = { pct: number | null; error?: string }
const provStore: Record<string, ProvState | undefined> = {}
// Agents we provisioned this session — used to show "Ready" immediately on success
// without waiting for the async status refresh to round-trip (which caused the row to
// briefly flash the Enable button again).
export const enabledOptimistic = new Set<string>()
const provListeners = new Set<() => void>()
let provChannelHooked = false

function notifyProv() { provListeners.forEach((l) => l()) }

export function startProvisioning(agent: 'claude' | 'codex', onDone: () => void | Promise<void>): void {
  if (provStore[agent] && !provStore[agent]!.error) return // already in flight
  provStore[agent] = { pct: null }
  notifyProv()
  if (!provChannelHooked) {
    provChannelHooked = true
    window.ipc.on('codeMode:engineProgress', (p) => {
      const cur = provStore[p.agent]
      if (!cur) return
      const pct = p.totalBytes ? Math.floor(((p.receivedBytes ?? 0) / p.totalBytes) * 100) : cur.pct
      provStore[p.agent] = { pct }
      notifyProv()
    })
  }
  window.ipc.invoke('codeMode:provisionEngine', { agent })
    .then((res) => {
      if (res.success) {
        // Mark installed optimistically so the row shows "Ready" the instant the flag
        // clears — don't depend on the async status refresh (which re-renders the parent
        // separately and left a window showing the Enable button). loadStatus still runs
        // in the background to sync the real status.
        enabledOptimistic.add(agent)
        provStore[agent] = undefined
        void onDone()
      } else {
        provStore[agent] = { pct: null, error: res.error ?? 'Failed to enable' }
      }
    })
    .catch((e) => { provStore[agent] = { pct: null, error: e instanceof Error ? e.message : 'Failed to enable' } })
    .finally(notifyProv)
}

export function useProvisioning(agent: string): ProvState | undefined {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    provListeners.add(l)
    return () => { provListeners.delete(l) }
  }, [])
  return provStore[agent]
}
