"use client"

import * as React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowUpRight, CircleAlert, History, LogIn, Pencil, Plug, Settings, X } from "lucide-react"
// Rowboats uses Phosphor's chat bubbles, as Spaces did (2026-10-22).
import { ChatsCircle } from "@phosphor-icons/react"
import z from "zod"
import { ServiceEvent } from "@x/shared/src/service-events.js"
import { getBillingPlanData } from "@x/shared/dist/billing.js"
import { Keys } from '@/components/keys'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { SHORTCUTS } from '@/lib/shortcuts'
import { isOutOfCredits, CREDIT_EXHAUSTED_EVENT, CREDIT_REPLENISHED_EVENT } from "@/lib/credit-status"
import { ProfileSettings } from "@/components/spaces/profile-settings"
import { SettingsDialog } from "@/components/settings-dialog"
import { SidebarCreditRewards } from "@/components/sidebar-credit-rewards"
import { SPACES_ENABLED } from "@/lib/feature-flags"
import { useSpacesUnreadCounts } from "@/hooks/use-space-chat"
import { MascotFaceIcon } from "@/components/talking-head"
import { useBilling } from "@/hooks/useBilling"
import { useRowboatConfig } from "@/hooks/use-rowboat-config"

// The app's top-level navigation (2026-11-03, spaces-first desktop): a fixed,
// labelled rail with exactly two places, Rowboats (Spaces) and Assistant
// (everything else, in its own sidebar), and your account at the foot. It
// replaces the ten-tile icon dock and its ⌥Tab switcher. It never expands;
// content panes clear it via DOCK_GUTTER_PX.

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** 8px in from the window's left edge, 60px wide (room for a label under each
 *  icon), with an 8px gap before the content. */
const RAIL_LEFT_PX = 8
const RAIL_WIDTH_PX = 60
/** Horizontal space the content panes leave for the rail (inset + rail + gap). */
export const DOCK_GUTTER_PX = RAIL_LEFT_PX + RAIL_WIDTH_PX + 8

export { LAST_SPACE_STORAGE_KEY } from '@/lib/spaces-navigation'

// ---------------------------------------------------------------------------
// Sync status (ported from the old sidebar's SyncStatusBar)
// ---------------------------------------------------------------------------

type ServiceEventType = z.infer<typeof ServiceEvent>

const MAX_SYNC_EVENTS = 1000
const RUN_STALE_MS = 2 * 60 * 60 * 1000

const SERVICE_LABELS: Record<string, string> = {
  gmail: "Syncing Gmail",
  outlook: "Syncing Outlook",
  calendar: "Syncing Calendar",
  fireflies: "Syncing Fireflies",
  granola: "Syncing Granola",
  graph: "Updating knowledge",
  voice_memo: "Processing voice memo",
  email_labeling: "Labeling emails",
  note_tagging: "Tagging notes",
  agent_notes: "Updating agent notes",
}

function summarizeServiceError(error: string): string {
  const firstLine = error.split("\n").find((line) => line.trim().length > 0)
  return firstLine?.trim() || error.trim()
}

function collectServiceErrors(events: ServiceEventType[]): Map<string, string> {
  const errors = new Map<string, string>()
  for (const event of events) {
    if (event.type === "error") {
      errors.set(event.service, summarizeServiceError(event.error))
      continue
    }
    if (event.type === "run_complete" && event.outcome !== "error") {
      errors.delete(event.service)
    }
  }
  return errors
}

function formatEventTime(ts: string): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

function useSyncStatus() {
  const [activeServices, setActiveServices] = useState<Map<string, string>>(new Map())
  const [serviceErrors, setServiceErrors] = useState<Map<string, string>>(new Map())
  const runTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    const cleanup = window.ipc.on('services:events', (event) => {
      const nextEvent = event as ServiceEventType
      if (nextEvent.type === 'run_start') {
        setActiveServices((prev) => {
          const next = new Map(prev)
          next.set(nextEvent.runId, nextEvent.service)
          return next
        })
        const existingTimeout = runTimeoutsRef.current.get(nextEvent.runId)
        if (existingTimeout) clearTimeout(existingTimeout)
        const timeout = setTimeout(() => {
          setActiveServices((prev) => {
            if (!prev.has(nextEvent.runId)) return prev
            const next = new Map(prev)
            next.delete(nextEvent.runId)
            return next
          })
          runTimeoutsRef.current.delete(nextEvent.runId)
        }, RUN_STALE_MS)
        runTimeoutsRef.current.set(nextEvent.runId, timeout)
      } else if (nextEvent.type === 'run_complete') {
        setActiveServices((prev) => {
          const next = new Map(prev)
          next.delete(nextEvent.runId)
          return next
        })
        if (nextEvent.outcome !== 'error') {
          setServiceErrors((prev) => {
            if (!prev.has(nextEvent.service)) return prev
            const next = new Map(prev)
            next.delete(nextEvent.service)
            return next
          })
        }
        const existingTimeout = runTimeoutsRef.current.get(nextEvent.runId)
        if (existingTimeout) {
          clearTimeout(existingTimeout)
          runTimeoutsRef.current.delete(nextEvent.runId)
        }
      } else if (nextEvent.type === 'error') {
        setServiceErrors((prev) => {
          const next = new Map(prev)
          next.set(nextEvent.service, summarizeServiceError(nextEvent.error))
          return next
        })
      }
    })
    return cleanup
  }, [])

  useEffect(() => {
    return () => {
      runTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout))
      runTimeoutsRef.current.clear()
    }
  }, [])

  const isSyncing = activeServices.size > 0
  const errorEntries = Array.from(serviceErrors.entries())
  const hasServiceErrors = errorEntries.length > 0
  const activeServiceNames = [...new Set(activeServices.values())]
  const statusLabel = isSyncing
    ? activeServiceNames.map((s) => SERVICE_LABELS[s] || s).join(", ")
    : hasServiceErrors
      ? errorEntries.length === 1
        ? `${SERVICE_LABELS[errorEntries[0][0]] || errorEntries[0][0]} failed`
        : "Recent sync issues"
      : "All caught up"

  return { isSyncing, hasServiceErrors, statusLabel, setServiceErrors }
}


/** The "Sync activity" log, shown in a popover anchored to the Settings tile. */
function SyncActivityLog({ onErrors }: { onErrors: (errors: Map<string, string>) => void }) {
  const [logEvents, setLogEvents] = useState<ServiceEventType[]>([])
  const [logLoading, setLogLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function loadLogs() {
      try {
        const result = await window.ipc.invoke('workspace:readFile', {
          path: 'logs/services.jsonl',
          encoding: 'utf8',
        })
        if (cancelled) return
        const lines = result.data.trim().split('\n').filter(Boolean)
        const parsed: ServiceEventType[] = []
        for (const line of lines) {
          try {
            parsed.push(JSON.parse(line))
          } catch {
            // skip malformed lines
          }
        }
        onErrors(collectServiceErrors(parsed))
        // Newest first, limit to 1000
        setLogEvents(parsed.reverse().slice(0, MAX_SYNC_EVENTS))
      } catch {
        if (!cancelled) setLogEvents([])
      } finally {
        if (!cancelled) setLogLoading(false)
      }
    }
    void loadLogs()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="max-h-80 overflow-y-auto p-2">
      {logLoading ? (
        <div className="py-4 text-center text-xs text-muted-foreground">Loading…</div>
      ) : logEvents.length === 0 ? (
        <div className="py-4 text-center text-xs text-muted-foreground">No recent activity.</div>
      ) : (
        <div className="space-y-0.5">
          {logEvents.map((event, idx) => (
            <div
              key={`${event.runId}-${event.ts}-${idx}`}
              className="flex items-start gap-2 rounded px-2 py-1 text-xs hover:bg-accent"
            >
              <span className="shrink-0 text-[10px] leading-4 text-muted-foreground/70">
                {formatEventTime(event.ts)}
              </span>
              <span className="shrink-0">
                <span className={cn(
                  "inline-block rounded px-1 py-0.5 text-[10px] font-medium leading-none",
                  event.level === 'error' ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                  event.level === 'warn' ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" :
                  "bg-muted text-muted-foreground"
                )}>
                  {SERVICE_LABELS[event.service]?.split(" ").slice(-1)[0] || event.service}
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="leading-4 text-foreground/80">{event.message}</p>
                {event.type === 'error' && (
                  <p
                    className="truncate text-[11px] leading-4 text-red-600/90 dark:text-red-400/90"
                    title={event.error}
                  >
                    {summarizeServiceError(event.error)}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


// ---------------------------------------------------------------------------
// The rail
// ---------------------------------------------------------------------------

export type RailArea = 'rowboats' | 'assistant'

export type MainRailProps = {
  /** Which of the two places is showing. */
  area: RailArea
  onOpenRowboats: () => void
  onOpenAssistant: () => void
  onOpenEmail?: () => void
  onOpenMeetings?: () => void
  onOpenBgTasks?: () => void
  onOpenApps?: () => void
  onStartTour?: () => void
  /** The Assistant sidebar is showing and carries its own credit rewards. */
  assistantSidebarVisible?: boolean
  /** Live meeting recording state: it must stay visible from Rowboats too. */
  meetingRecordingState?: 'idle' | 'connecting' | 'recording' | 'stopping'
}

type RailItem = {
  key: RailArea
  label: string
  icon: React.ReactNode
  tourId: string
  shortcut?: readonly string[]
  status?: string
  badge?: string
  /** The recording dot: red and pulsing, above any count. */
  recording?: boolean
  notification?: 'muted' | 'alert'
  onClick: () => void
}

export function MainRail({
  area,
  onOpenRowboats,
  onOpenAssistant,
  onOpenEmail,
  onOpenMeetings,
  onOpenBgTasks,
  onOpenApps,
  onStartTour,
  assistantSidebarVisible = false,
  meetingRecordingState = 'idle',
}: MainRailProps) {
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [connectionsSettingsOpen, setConnectionsSettingsOpen] = useState(false)
  const [syncLogOpen, setSyncLogOpen] = useState(false)
  const [creditPopoverOpen, setCreditPopoverOpen] = useState(false)

  // ----- data: account / billing -----
  const [hasOauthError, setHasOauthError] = useState(false)
  const [isRowboatConnected, setIsRowboatConnected] = useState(false)
  const [outOfCredits, setOutOfCredits] = useState(false)
  const outOfCreditsRef = useRef(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const appUrl = useRowboatConfig()?.appUrl ?? null
  const { billing, refresh: refreshBilling } = useBilling(isRowboatConnected)
  const currentBillingPlan = billing ? getBillingPlanData(billing.catalog, billing.subscriptionPlanId) : null

  // Your first name from the Gmail account, else from the email address.
  const [gmailName, setGmailName] = useState('')
  useEffect(() => {
    let cancelled = false
    window.ipc.invoke('gmail:getAccountName', {})
      .then((res) => { if (!cancelled && res?.name) setGmailName(res.name) })
      .catch(() => { /* fall back to the email address */ })
    return () => { cancelled = true }
  }, [])
  const emailName = (billing?.userEmail?.split('@')[0] ?? '').split(/[._+-]/)[0] ?? ''
  const accountName = gmailName.trim().split(/\s+/)[0]
    || (emailName ? emailName.charAt(0).toUpperCase() + emailName.slice(1) : '')
    || (isRowboatConnected ? 'Rowboat' : 'Not signed in')
  const accountInitial = accountName === 'Not signed in' ? '?' : accountName.charAt(0).toUpperCase()

  useEffect(() => {
    let mounted = true
    const refreshOauthState = async () => {
      try {
        const result = await window.ipc.invoke('oauth:getState', null)
        const config = result.config || {}
        if (mounted) {
          setHasOauthError(Object.values(config).some((entry) => Boolean(entry?.error)))
          setIsRowboatConnected(config['rowboat']?.connected ?? false)
        }
      } catch (error) {
        console.error('Failed to fetch OAuth state:', error)
        if (mounted) {
          setHasOauthError(false)
          setIsRowboatConnected(false)
        }
      }
    }
    void refreshOauthState()
    const cleanup = window.ipc.on('oauth:didConnect', () => {
      void refreshOauthState()
      setLoggingIn(false)
    })
    return () => {
      mounted = false
      cleanup()
    }
  }, [])

  // Billing is authoritative; the live events flip the flag between loads.
  // Running out opens the notice by the avatar once per episode.
  const setCredits = useCallback((next: boolean) => {
    if (next && !outOfCreditsRef.current) setCreditPopoverOpen(true)
    if (!next) setCreditPopoverOpen(false)
    outOfCreditsRef.current = next
    setOutOfCredits(next)
  }, [])
  useEffect(() => {
    if (billing) setCredits(isOutOfCredits(billing))
  }, [billing, setCredits])
  useEffect(() => {
    const onExhausted = () => setCredits(true)
    const onReplenished = () => {
      const wasOut = outOfCreditsRef.current
      setCredits(false)
      if (wasOut) void refreshBilling()
    }
    window.addEventListener(CREDIT_EXHAUSTED_EVENT, onExhausted)
    window.addEventListener(CREDIT_REPLENISHED_EVENT, onReplenished)
    return () => {
      window.removeEventListener(CREDIT_EXHAUSTED_EVENT, onExhausted)
      window.removeEventListener(CREDIT_REPLENISHED_EVENT, onReplenished)
    }
  }, [refreshBilling, setCredits])

  const handleRowboatLogin = useCallback(async () => {
    try {
      setLoggingIn(true)
      const result = await window.ipc.invoke('oauth:connect', { provider: 'rowboat' })
      if (!result.success) setLoggingIn(false)
    } catch {
      setLoggingIn(false)
    }
  }, [])
  const openUpgrade = () => { if (appUrl) window.open(`${appUrl}?intent=upgrade`) }

  // ----- data: unread email, rolled up onto Assistant -----
  const [unreadEmailCount, setUnreadEmailCount] = useState(0)
  useEffect(() => {
    let cancelled = false
    const loadEmail = async () => {
      try {
        const result = await window.ipc.invoke('gmail:getImportant', { limit: 50 })
        if (!cancelled) setUnreadEmailCount(result.threads.filter((t) => t.unread === true).length)
      } catch { /* ignore */ }
    }
    void loadEmail()
    const cleanup = window.ipc.on('workspace:didChange', (event) => {
      const paths = event.type === 'bulkChanged' ? (event.paths ?? [])
        : event.type === 'moved' ? [event.from, event.to]
        : 'path' in event ? [event.path] : []
      if (paths.some((p) => typeof p === 'string' && p.startsWith('gmail_sync'))) void loadEmail()
    })
    return () => { cancelled = true; cleanup() }
  }, [])

  // ----- data: Spaces unread, on Rowboats and the OS dock icon -----
  const spacesUnread = useSpacesUnreadCounts()
  const spacesNotification = useMemo(() => {
    let unread = 0
    let forYou = 0
    for (const badge of spacesUnread.values()) {
      unread += badge.unread
      forYou += badge.forYou
    }
    return { unread, forYou }
  }, [spacesUnread])
  useEffect(() => {
    void window.ipc.invoke('app:setSpacesDockBadge', {
      unread: spacesNotification.unread,
      forYou: spacesNotification.forYou,
    }).catch((error: unknown) => {
      console.warn('[dock-badge] Failed to sync unread counts:', error)
    })
    // No cleanup: retain the last badge when the main window closes.
  }, [spacesNotification.unread, spacesNotification.forYou])

  const { isSyncing, hasServiceErrors, statusLabel: syncStatusLabel, setServiceErrors } = useSyncStatus()

  const meetingIsRecording = meetingRecordingState !== 'idle'
  const settingsStatus = outOfCredits
    ? 'Out of credits'
    : hasOauthError
      ? 'Accounts need attention'
      : !isRowboatConnected
        ? 'Sign in to Rowboat'
        : (isSyncing || hasServiceErrors)
          ? syncStatusLabel
          : (currentBillingPlan?.displayName ?? syncStatusLabel)

  const items: RailItem[] = [
    ...(SPACES_ENABLED ? [{
      key: 'rowboats' as const,
      label: 'Rowboats',
      icon: <ChatsCircle size={22} />,
      tourId: 'nav-spaces',
      shortcut: SHORTCUTS.spaces,
      notification: spacesNotification.unread > 0
        ? (spacesNotification.forYou > 0 ? 'alert' as const : 'muted' as const)
        : undefined,
      status: spacesNotification.unread > 0
        ? `${spacesNotification.unread} unread${spacesNotification.forYou > 0 ? ` · ${spacesNotification.forYou} for you` : ''}`
        : undefined,
      onClick: onOpenRowboats,
    }] : []),
    {
      key: 'assistant',
      label: 'Assistant',
      icon: <MascotFaceIcon className="size-[22px]" />,
      tourId: 'nav-assistant',
      shortcut: SHORTCUTS.assistant,
      recording: meetingIsRecording,
      badge: unreadEmailCount > 0 ? (unreadEmailCount > 99 ? '99+' : String(unreadEmailCount)) : undefined,
      status: meetingIsRecording
        ? 'Recording a meeting'
        : unreadEmailCount > 0 ? `${unreadEmailCount} unread email${unreadEmailCount === 1 ? '' : 's'}` : undefined,
      onClick: onOpenAssistant,
    },
  ]

  return (
    <>
      <nav aria-label="Main" data-dock-root="" className="rowboat-dock titlebar-no-drag" style={{ left: RAIL_LEFT_PX, width: RAIL_WIDTH_PX }}>
        <div className="flex min-h-0 flex-1 flex-col items-center gap-1 px-1.5 pt-2">
          {items.map((item) => (
            <Tooltip key={item.key} delayDuration={300}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={item.label}
                  aria-current={area === item.key ? 'page' : undefined}
                  data-tour-id={item.tourId}
                  data-active={area === item.key || undefined}
                  className="rowboat-dock-tile rowboat-rail-tile"
                  onClick={item.onClick}
                >
                  <span className="relative flex">
                    {item.icon}
                    {item.recording ? (
                      <span className="rowboat-rail-recording" aria-label="Recording a meeting" role="status">
                        <span className="animate-ping" />
                      </span>
                    ) : item.badge ? (
                      <span className="rowboat-dock-badge">{item.badge}</span>
                    ) : item.notification && (
                      <span
                        className={cn('rowboat-dock-notification', item.notification === 'alert' ? 'rowboat-dock-notification-alert' : 'rowboat-dock-notification-muted')}
                        aria-label={item.notification === 'alert' ? 'Unread Spaces activity for you' : 'Unread Spaces activity'}
                      />
                    )}
                  </span>
                  <span className="rowboat-rail-label">{item.label}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={12} className="flex flex-col items-start gap-0.5">
                <span className="flex items-center gap-2">
                  {item.label}
                  {item.shortcut && <Keys keys={item.shortcut} tone="dark" />}
                </span>
                {item.status && <span className="text-[11px] font-normal opacity-75">{item.status}</span>}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        {/* The account at the foot: plan, accounts, sync, tour and Settings.
            It carries a dot when something needs attention, anchors the sync
            log, and the out-of-credits notice that the panel's footer used
            to hold. */}
        <div className="flex shrink-0 justify-center pb-2 pt-1">
          <Popover open={creditPopoverOpen && outOfCredits} onOpenChange={setCreditPopoverOpen}>
            <PopoverAnchor asChild>
              <span className="inline-flex">
                <Popover open={syncLogOpen} onOpenChange={setSyncLogOpen}>
                  <PopoverAnchor asChild>
                    <span className="inline-flex">
                      <DropdownMenu>
                        <Tooltip delayDuration={300}>
                          <TooltipTrigger asChild>
                            <DropdownMenuTrigger asChild>
                              <button type="button" aria-label={`${accountName}: account and settings`} className={cn('sb-avatar-button', isSyncing && 'is-syncing')}>
                                <span className="sb-avatar" aria-hidden="true">
                                  {accountInitial}
                                  {(outOfCredits || hasOauthError) && <span className={cn('sb-avatar-flag', outOfCredits && 'is-alert')} />}
                                </span>
                              </button>
                            </DropdownMenuTrigger>
                          </TooltipTrigger>
                          <TooltipContent side="right" sideOffset={12}>{accountName} · {settingsStatus}</TooltipContent>
                        </Tooltip>
                        <DropdownMenuContent side="right" align="end" sideOffset={12} className="sb-menu w-[248px] rounded-xl p-1.5">
                          <div className="flex items-center gap-2.5 px-2 pb-2 pt-1.5">
                            <span className="sb-avatar size-8! text-[13px]!" aria-hidden="true">{accountInitial}</span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13px] font-semibold">{accountName}</div>
                              <div className="truncate text-[11.5px] text-muted-foreground">{billing?.userEmail ?? 'Not signed in'}</div>
                            </div>
                          </div>
                          {isRowboatConnected ? (
                            appUrl && (
                              <DropdownMenuItem onSelect={openUpgrade}>
                                <ArrowUpRight />
                                {outOfCredits
                                  ? 'Out of credits · Upgrade'
                                  : !billing?.subscriptionPlanId || currentBillingPlan?.category === 'free' || currentBillingPlan?.category === 'starter'
                                    ? `${currentBillingPlan?.displayName ?? 'Free'} plan · Upgrade`
                                    : `${currentBillingPlan?.displayName ?? 'Plan'} · Manage`}
                              </DropdownMenuItem>
                            )
                          ) : (
                            <DropdownMenuItem disabled={loggingIn} onSelect={() => void handleRowboatLogin()}>
                              <LogIn />
                              {loggingIn ? 'Signing in…' : 'Sign in to Rowboat'}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onSelect={() => setProfileSettingsOpen(true)}><Pencil /> Edit Spaces profile</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setConnectionsSettingsOpen(true)}>
                            <Plug /> Connect accounts
                            {hasOauthError && <span className="ml-auto size-1.5 rounded-full bg-amber-500" />}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setSyncLogOpen(true)}>
                            <History /> Sync activity
                          </DropdownMenuItem>
                          {onStartTour && (
                            <DropdownMenuItem onSelect={onStartTour}>
                              <MascotFaceIcon className="size-4" /> Take a tour
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                            <Settings /> Settings
                            <Keys keys={SHORTCUTS.settings} className="ml-auto" />
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </span>
                  </PopoverAnchor>
                  <PopoverContent side="right" align="end" sideOffset={16} className="w-96 p-0">
                    <div className="border-b p-3">
                      <h4 className="text-sm font-semibold">Sync Activity</h4>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {isSyncing || hasServiceErrors ? syncStatusLabel : 'All services up to date'}
                      </p>
                    </div>
                    <SyncActivityLog onErrors={setServiceErrors} />
                  </PopoverContent>
                </Popover>
              </span>
            </PopoverAnchor>
            <PopoverContent side="right" align="end" sideOffset={16} className="w-72">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-red-500/15 text-red-500">
                    <CircleAlert className="size-4" />
                  </span>
                  <h4 className="text-sm font-bold text-foreground">You&apos;ve run out of credits</h4>
                </div>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setCreditPopoverOpen(false)}
                  className="rounded-md p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Upgrade your plan to continue using all features.
              </p>
              <button
                onClick={() => { openUpgrade(); setCreditPopoverOpen(false) }}
                className="mt-3 w-full rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600"
              >
                Upgrade now
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </nav>

      {/* First-time-action credit rewards (feature-flagged, signed-in only).
          The Assistant sidebar carries its own copy while it shows. */}
      {!assistantSidebarVisible && (
        <div className="titlebar-no-drag fixed bottom-2 z-30 w-60" style={{ left: DOCK_GUTTER_PX }}>
          <SidebarCreditRewards
            onOpenEmail={onOpenEmail}
            onOpenMeetings={onOpenMeetings}
            onOpenAgents={onOpenBgTasks}
            onOpenApps={onOpenApps}
            onConnectAccounts={() => setConnectionsSettingsOpen(true)}
          />
        </div>
      )}

      {profileSettingsOpen && <ProfileSettings onClose={() => setProfileSettingsOpen(false)} />}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <SettingsDialog
        defaultTab="connections"
        open={connectionsSettingsOpen}
        onOpenChange={setConnectionsSettingsOpen}
      />
    </>
  )
}
