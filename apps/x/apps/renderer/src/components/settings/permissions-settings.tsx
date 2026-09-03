"use client"

import { useCallback, useEffect, useState } from "react"
import { ExternalLink, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ipc as ipcShared } from "@x/shared"

/**
 * Settings → Permissions: every OS permission Rowboat uses, grouped by the
 * FEATURE it serves — the mental model is "enable what I use", never "make
 * the checklist green" (over-granting is attack surface, especially
 * Accessibility). Statuses are honest: where the OS gives us no read API
 * (input monitoring outside a call, notifications, unprobed automation) the
 * chip says so instead of faking a verdict. Just-in-time dialogs remain the
 * primary grant path; this panel is the audit-and-repair surface.
 */

type PermissionsStatus = ipcShared.IPCChannels["permissions:getStatus"]["res"]
type PermState = PermissionsStatus["microphone"]
type RequestablePermission = ipcShared.IPCChannels["permissions:request"]["req"]["permission"]
type SettingsSection = ipcShared.IPCChannels["app:openPrivacySettings"]["req"]["section"]

const CHIP_STYLES: Record<string, string> = {
  granted: "bg-[var(--rowboat-success)]/10 text-[var(--rowboat-success)]",
  denied: "bg-red-500/10 text-red-600 dark:text-red-400",
  restricted: "bg-red-500/10 text-red-600 dark:text-red-400",
  "not-determined": "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  unknown: "bg-muted text-muted-foreground",
}

const CHIP_LABELS: Record<string, string> = {
  granted: "Granted",
  denied: "Not granted",
  restricted: "Restricted",
  "not-determined": "Not requested yet",
  unknown: "Unknown",
}

function StatusChip({ state }: { state: PermState }) {
  if (state === "not-required") return null
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", CHIP_STYLES[state])}>
      {CHIP_LABELS[state]}
    </span>
  )
}

type RowSpec = {
  key: keyof Omit<PermissionsStatus, "platform">
  title: string
  why: string
  /** Extra guidance shown under the row for specific states. */
  hint?: Partial<Record<PermState, string>>
  /** Fires the OS grant flow (native prompt / dialog / probe), when one exists. */
  request?: RequestablePermission
  requestLabel?: string
  /** Deep link into the OS settings pane. */
  settingsSection: SettingsSection
  /** Row is link-only: no status chip is shown even when state is 'unknown'. */
  linkOnly?: boolean
}

type GroupSpec = {
  title: string
  description?: string
  rows: RowSpec[]
}

const GROUPS: GroupSpec[] = [
  {
    title: "Voice calls",
    rows: [
      {
        key: "microphone",
        title: "Microphone",
        why: "Hear you on calls and for dictation.",
        request: "microphone",
        requestLabel: "Grant",
        settingsSection: "microphone",
      },
      {
        key: "inputMonitoring",
        title: "Input Monitoring",
        why: "Right ⌘ push-to-talk while you're in any app.",
        hint: {
          unknown:
            "macOS gives no way to read this outside a call — it's verified the moment key events arrive on your next call. If holding right ⌘ from another app does nothing, grant it here.",
        },
        request: "input-monitoring",
        requestLabel: "Request",
        settingsSection: "input-monitoring",
      },
    ],
  },
  {
    title: "Video calls",
    rows: [
      {
        key: "camera",
        title: "Camera",
        why: "See you on video calls and practice sessions.",
        request: "camera",
        requestLabel: "Grant",
        settingsSection: "camera",
      },
    ],
  },
  {
    title: "Screen sharing",
    rows: [
      {
        key: "screenRecording",
        title: "Screen Recording",
        why: "Share your screen on calls so the assistant can see it.",
        hint: {
          granted: "Just granted it? macOS applies a fresh Screen Recording grant only after the app relaunches.",
          denied: "macOS doesn't allow apps to prompt for this — enable Rowboat in the pane, then relaunch the app.",
        },
        settingsSection: "screen-recording",
      },
    ],
  },
  {
    title: "Notifications",
    rows: [
      {
        key: "notifications",
        title: "Notifications",
        why: "Background agents and reminders can notify you when something needs attention.",
        settingsSection: "notifications",
        linkOnly: true,
      },
    ],
  },
]

export function PermissionsSettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [status, setStatus] = useState<PermissionsStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(() => {
    void window.ipc
      .invoke("permissions:getStatus", null)
      .then(setStatus)
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (dialogOpen) refresh()
  }, [dialogOpen, refresh])

  // Statuses change while the user is off in System Settings — re-poll when
  // the app window comes back into focus so the chips are fresh.
  useEffect(() => {
    window.addEventListener("focus", refresh)
    return () => window.removeEventListener("focus", refresh)
  }, [refresh])

  const request = useCallback(
    async (permission: RequestablePermission) => {
      setBusy(permission)
      try {
        await window.ipc.invoke("permissions:request", { permission })
      } catch {
        // Statuses re-read below either way.
      }
      setBusy(null)
      refresh()
    },
    [refresh],
  )

  const openPane = useCallback((section: SettingsSection) => {
    void window.ipc.invoke("app:openPrivacySettings", { section }).catch(() => {})
  }, [])

  if (!status) {
    return <div className="py-8 text-center text-sm text-muted-foreground">Checking permissions…</div>
  }

  const visibleGroups = GROUPS.map((group) => ({
    ...group,
    rows: group.rows.filter((row) => status[row.key] !== "not-required"),
  })).filter((group) => group.rows.length > 0)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          What Rowboat can access on this {status.platform === "darwin" ? "Mac" : "device"}, grouped by the feature
          that uses it. Grant what you use — nothing here is required except for its feature.
        </p>
        <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1.5 text-xs" onClick={refresh}>
          <RefreshCw className="h-3 w-3" />
          Refresh
        </Button>
      </div>

      {visibleGroups.map((group) => (
        <div key={group.title} className="space-y-2">
          <h4 className="text-sm font-semibold">{group.title}</h4>
          {group.description && <p className="text-xs text-muted-foreground">{group.description}</p>}
          <div className="divide-y rounded-md border">
            {group.rows.map((row) => {
              const state = status[row.key]
              const hint = row.hint?.[state]
              const showGrant = Boolean(row.request) && state !== "granted"
              return (
                <div key={row.key} className="flex flex-col gap-1.5 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{row.title}</span>
                        {!row.linkOnly && <StatusChip state={state} />}
                      </div>
                      <p className="text-xs text-muted-foreground">{row.why}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {showGrant && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={busy === row.request}
                          onClick={() => row.request && void request(row.request)}
                        >
                          {busy === row.request ? "Requesting…" : row.requestLabel}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 text-xs text-muted-foreground"
                        onClick={() => openPane(row.settingsSection)}
                      >
                        <ExternalLink className="h-3 w-3" />
                        System Settings
                      </Button>
                    </div>
                  </div>
                  {hint && <p className="text-xs text-muted-foreground/80">{hint}</p>}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
