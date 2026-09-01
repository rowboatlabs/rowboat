"use client"

import * as React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AppWindow,
  ArrowUpRight,
  Bot,
  Code2,
  FileText,
  FilePlus,
  Folder,
  Globe,
  History,
  Home,
  LayoutGrid,
  LogIn,
  Mail,
  MessageSquare,
  MessagesSquare,
  Mic,
  MoreVertical,
  PanelLeftClose,
  Pencil,
  Pin,
  Plug,
  Plus,
  Settings,
  Square,
  SquarePen,
  Trash2,
  Video,
  type LucideIcon,
} from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { toast } from "@/lib/toast"
import { getPinnedApps, onPinnedAppsChanged, unpinApp } from "@/lib/pinned-apps"
import { isOutOfCredits, CREDIT_EXHAUSTED_EVENT, CREDIT_REPLENISHED_EVENT } from "@/lib/credit-status"
import { SettingsDialog } from "@/components/settings-dialog"
import { SidebarCreditRewards } from "@/components/sidebar-credit-rewards"
import { SPACES_ENABLED } from "@/lib/feature-flags"
import { AddOrgDialog, OrgMonogram, type SpaceSelection } from "@/components/spaces-view"
import { useSpacesOrgs, type OrgWithSpaces } from "@/hooks/use-spaces"
import { useSpacesUnreadCounts } from "@/hooks/use-space-chat"
import { MascotFaceIcon } from "@/components/talking-head"
import { extractConferenceLink } from "@/lib/calendar-event"
import { useBilling } from "@/hooks/useBilling"
import { useRowboatConfig } from "@/hooks/use-rowboat-config"
import { getBillingPlanData } from "@x/shared/dist/billing.js"
import { ServiceEvent } from "@x/shared/src/service-events.js"
import z from "zod"

// The app's left navigation as a macOS-Dock-style floating icon tray (design:
// "Rowboat Dock Sidebar" handoff): a frosted-glass vertical dock 18px from the
// window's left edge, with hover magnification, dark status tooltips, unread
// badges, running dots, frosted flyout panels for Chats and Spaces, and a
// Cmd-Tab-style keyboard switcher (⌥/⌃ + Tab or `). It replaces the old
// panel sidebar; content panes clear it via DOCK_GUTTER_PX.

// ---------------------------------------------------------------------------
// Geometry (from the design handoff)
// ---------------------------------------------------------------------------

const DOCK_EDGE_PX = 16 // dock's distance from the window's left edge
const DOCK_PAD = 10
const DOCK_GAP = 6
const DOCK_SEP_H = 8
const DOCK_ICON_MAX = 36
const DOCK_ICON_MIN = 24
const DOCK_MAG = 0.45 // hover magnification strength
const DOCK_MAG_RADIUS = 100 // px falloff radius around the cursor

/** Horizontal space the content panes leave for the dock. */
export const DOCK_GUTTER_PX = DOCK_EDGE_PX + DOCK_ICON_MAX + DOCK_PAD * 2 + 14

/** The most recently opened space — App writes it on every space navigation;
    the ⌥Tab switcher lands there instead of opening the flyout. */
export const LAST_SPACE_STORAGE_KEY = 'x:last-space'

/** Where flyout panels (Chats / Spaces) sit, just right of the tray. */
const DOCK_FLYOUT_LEFT_PX = DOCK_EDGE_PX + DOCK_ICON_MAX + DOCK_PAD * 2 + 20

// Light tile faces, each carrying a faint tint of its own glyph color
// (9% -> 18% of the hue mixed into white, top to bottom); the color proper
// lives in the glyph. The hues are the dark stops of the original palette.
const tileFace = (glyphColor: string): string =>
  `linear-gradient(145deg, color-mix(in oklab, ${glyphColor} 9%, white), color-mix(in oklab, ${glyphColor} 18%, white))`

// The Assistant tile stays untinted — a plain white face sets it apart
// from the tinted destination tiles.
const ASSISTANT_FACE = "linear-gradient(145deg, #ffffff, #f0f3f2)"
const GLYPH_COLORS: Record<string, string> = {
  assistant: "#0f766e",
  home: "#0f766e",
  email: "#1d4ed8",
  code: "#0f172a",
  meetings: "#c2352b",
  brain: "#c2740a",
  apps: "#6d28d9",
  agents: "#334155",
  workspaces: "#0369a1",
  browser: "#86198f",
  spaces: "#4338ca",
  chats: "#15803d",
  settings: "#4b5563",
}
const DEFAULT_GLYPH_COLOR = "#4b5563"


// Pinned apps get a stable glyph color hashed from their folder name, with a
// monogram for the drawing.
const APP_GLYPH_COLORS: string[] = [
  "#be185d", // pink
  "#be123c", // rose
  "#c2410c", // orange
  "#0e7490", // cyan
  "#4d7c0f", // lime
  "#a21caf", // fuchsia
  "#115e59", // teal
  "#1e40af", // periwinkle
]

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

const appGlyphColor = (folder: string): string =>
  APP_GLYPH_COLORS[hashString(folder) % APP_GLYPH_COLORS.length]

const appMonogram = (name: string): string => [...name.trim()][0]?.toUpperCase() ?? "A"

// ---------------------------------------------------------------------------
// Shared shapes (mirrors what App.tsx already passes around)
// ---------------------------------------------------------------------------

interface TreeNode {
  path: string
  name: string
  kind: "file" | "dir"
  children?: TreeNode[]
  loaded?: boolean
  stat?: { size: number; mtimeMs: number }
}

type TaskSummary = {
  slug: string
  name: string
  active: boolean
  createdAt: string
  lastAttemptAt?: string
  lastRunAt?: string
  lastRunError?: string
}

type DockKnowledgeActions = {
  createNote: (parentPath?: string) => void
  openKnowledgeView: () => void
  openWorkspaceAt: (path?: string) => void
}

export type DockSidebarProps = {
  tree: TreeNode[]
  knowledgeActions: DockKnowledgeActions
  bgTaskSummaries?: TaskSummary[]
  onOpenMeetings?: () => void
  onOpenCode?: () => void
  onOpenBgTasks?: () => void
  onOpenApps?: () => void
  /** Open a specific app (pinned via the Apps view) inside the Apps view. */
  onOpenApp?: (folder: string) => void
  /** Open one space (org + space) in the Spaces view. */
  onOpenSpace?: (orgId: string, spaceId: string) => void
  /** The space currently open, for highlighting its flyout row. */
  activeSpace?: SpaceSelection
  recentRuns?: { id: string; title?: string; createdAt: string; modifiedAt?: string }[]
  onOpenRun?: (runId: string) => void
  /** Persist a custom chat title (sessions:setTitle) and refresh the runs list. */
  onRenameRun?: (runId: string, title: string) => void
  /** Delete the chat's session (sessions:delete) and refresh the runs list. */
  onDeleteRun?: (runId: string) => void
  onOpenChatHistory?: () => void
  onOpenEmail?: (threadId?: string) => void
  onOpenHome?: () => void
  onNewChat?: () => void
  onToggleBrowser?: () => void
  /** Whether the browser overlay is up, for the Browser tile's running dot. */
  browserOpen?: boolean
  /** Render only the ⌥/⌃+Tab app switcher — no tray, no flyouts. Used while
      the panel sidebar is expanded, so the switcher works in both modes (and
      its most-recently-used order survives collapsing/expanding). */
  switcherOnly?: boolean
  /** Starts the mascot-guided product tour. */
  onStartTour?: () => void
  /** Which primary destination is currently active, for the running dot. */
  activeNav?: 'assistant' | 'home' | 'email' | 'meetings' | 'code' | 'knowledge' | 'agents' | 'apps' | 'spaces' | 'workspaces' | null
  /** Live meeting recording state, so the Meetings tile can show it. */
  meetingRecordingState?: 'idle' | 'connecting' | 'recording' | 'stopping'
  recordingMeetingSource?: string | null
  onToggleMeetingRecording?: () => void
}

// ---------------------------------------------------------------------------
// Helpers (ported from the old sidebar)
// ---------------------------------------------------------------------------

function formatAgo(ms: number): string {
  const diffMs = Math.max(0, Date.now() - ms)
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  const wk = Math.floor(day / 7)
  if (wk < 4) return `${wk}w ago`
  const mo = Math.max(1, Math.floor(day / 30))
  return `${mo}mo ago`
}

type UpcomingMeeting = {
  id: string
  summary: string
  start: Date
  isAllDay: boolean
  location: string | null
  htmlLink: string | null
  conferenceLink: string | null
  source: string
  rawStart: { dateTime?: string; date?: string } | undefined
  rawEnd: { dateTime?: string; date?: string } | undefined
}

type RawCalendarEvent = {
  id?: string
  summary?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  location?: string
  htmlLink?: string
  status?: string
  attendees?: Array<{ self?: boolean; responseStatus?: string }>
}

function parseAllDayDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function normalizeUpcomingMeeting(raw: RawCalendarEvent, sourcePath: string): UpcomingMeeting | null {
  if (raw.status === 'cancelled') return null
  const declined = raw.attendees?.find((a) => a.self)?.responseStatus === 'declined'
  if (declined) return null
  const allDayStart = raw.start?.date
  const timedStart = raw.start?.dateTime
  const isAllDay = !timedStart && Boolean(allDayStart)
  let start: Date | null = null
  let end: Date | null = null
  if (timedStart) {
    start = new Date(timedStart)
    end = raw.end?.dateTime ? new Date(raw.end.dateTime) : null
  } else if (allDayStart) {
    start = parseAllDayDate(allDayStart)
    end = raw.end?.date ? parseAllDayDate(raw.end.date) : null
  }
  if (!start || Number.isNaN(start.getTime())) return null
  const now = new Date()
  const effectiveEnd = end ?? (isAllDay ? new Date(start.getTime() + 24 * 60 * 60 * 1000) : start)
  if (effectiveEnd <= now) return null
  const conferenceLink = extractConferenceLink(raw as unknown as Record<string, unknown>) ?? null
  return {
    id: raw.id ?? sourcePath,
    summary: raw.summary?.trim() || '(No title)',
    start,
    isAllDay,
    location: raw.location?.trim() || null,
    htmlLink: raw.htmlLink ?? null,
    conferenceLink,
    source: sourcePath,
    rawStart: raw.start,
    rawEnd: raw.end,
  }
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function formatMeetingTime(event: UpcomingMeeting): string {
  if (event.isAllDay) return 'All day'
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const time = event.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (isSameLocalDay(event.start, now)) return time
  if (isSameLocalDay(event.start, tomorrow)) return `Tmrw ${time}`
  return event.start.toLocaleDateString([], { month: 'numeric', day: 'numeric' })
}

function triggerMeetingCapture(event: UpcomingMeeting, openConference: boolean) {
  window.__pendingCalendarEvent = {
    summary: event.summary,
    start: event.rawStart,
    end: event.rawEnd,
    location: event.location ?? undefined,
    htmlLink: event.htmlLink ?? undefined,
    conferenceLink: event.conferenceLink ?? undefined,
    source: event.source,
  }
  if (openConference && event.conferenceLink) {
    window.open(event.conferenceLink, '_blank')
  }
  window.dispatchEvent(new Event('calendar-block:join-meeting'))
}

function formatEmailFrom(from: string): string {
  const match = /^\s*"?([^"<]+?)"?\s*<.+>\s*$/.exec(from)
  if (match) return match[1].trim()
  return from
}

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
// Dock items
// ---------------------------------------------------------------------------

type DockItemDef = {
  key: string
  label: string
  icon: LucideIcon
  /** Overrides the GLYPH_COLORS lookup (pinned-app tiles). */
  glyphColor?: string
  /** Shorter name for the ⌥Tab switcher cell, when the full label truncates. */
  switcherLabel?: string
  /** Letter rendered instead of the icon (pinned-app tiles). */
  monogram?: string
  tourId?: string
  badge?: string
  badgeAmber?: boolean
  badgePulse?: boolean
  status?: string
  statusAlert?: boolean
  running?: boolean
  onClick: () => void
  /** What the ⌥Tab switcher runs on commit, when it differs from a tile
      click (e.g. tiles that open flyouts navigate somewhere real instead). */
  switchTo?: () => void
}

type DockRow = { sep: true } | { sep?: false; item: DockItemDef }

const PINNED_CHATS_STORAGE_KEY = 'x:pinned-chats'
const MAX_PINNED_CHATS = 3

// ---------------------------------------------------------------------------
// The dock
// ---------------------------------------------------------------------------

export function DockSidebar({
  tree,
  knowledgeActions,
  bgTaskSummaries = [],
  onOpenMeetings,
  onOpenCode,
  onOpenBgTasks,
  onOpenApps,
  onOpenApp,
  onOpenSpace,
  activeSpace = null,
  recentRuns = [],
  onOpenRun,
  onRenameRun,
  onDeleteRun,
  onOpenChatHistory,
  onOpenEmail,
  onOpenHome,
  onNewChat,
  onToggleBrowser,
  browserOpen = false,
  switcherOnly = false,
  onStartTour,
  activeNav,
  meetingRecordingState = 'idle',
  recordingMeetingSource = null,
  onToggleMeetingRecording,
}: DockSidebarProps) {
  // ----- interaction state -----
  const [mouseY, setMouseY] = useState<number | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [chatsOpen, setChatsOpen] = useState(false)
  const [spacesOpen, setSpacesOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [switcherIndex, setSwitcherIndex] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [connectionsSettingsOpen, setConnectionsSettingsOpen] = useState(false)
  const [syncLogOpen, setSyncLogOpen] = useState(false)
  const [addOrgOpen, setAddOrgOpen] = useState(false)
  const [winH, setWinH] = useState(() => window.innerHeight)

  useEffect(() => {
    const onResize = () => setWinH(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const closeFlyouts = useCallback(() => {
    setChatsOpen(false)
    setSpacesOpen(false)
  }, [])

  // Expanding back to the panel drops the tray — take any open flyout with
  // it, so it neither lingers over the panel nor reappears stale on the next
  // collapse.
  useEffect(() => {
    if (switcherOnly) closeFlyouts()
  }, [switcherOnly, closeFlyouts])

  // ----- data: account / billing -----
  const [hasOauthError, setHasOauthError] = useState(false)
  const [isRowboatConnected, setIsRowboatConnected] = useState(false)
  const [outOfCredits, setOutOfCredits] = useState(false)
  const outOfCreditsRef = useRef(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const appUrl = useRowboatConfig()?.appUrl ?? null
  const { billing, refresh: refreshBilling } = useBilling(isRowboatConnected)
  const currentBillingPlan = billing ? getBillingPlanData(billing.catalog, billing.subscriptionPlanId) : null

  useEffect(() => {
    let mounted = true
    const refreshOauthError = async () => {
      try {
        const result = await window.ipc.invoke('oauth:getState', null)
        const config = result.config || {}
        const hasError = Object.values(config).some((entry) => Boolean(entry?.error))
        const connected = config['rowboat']?.connected ?? false
        if (mounted) {
          setHasOauthError(hasError)
          setIsRowboatConnected(connected)
        }
      } catch (error) {
        console.error('Failed to fetch OAuth state:', error)
        if (mounted) {
          setHasOauthError(false)
          setIsRowboatConnected(false)
        }
      }
    }
    void refreshOauthError()
    const cleanup = window.ipc.on('oauth:didConnect', () => {
      void refreshOauthError()
      setLoggingIn(false)
    })
    return () => {
      mounted = false
      cleanup()
    }
  }, [])

  // Re-anchor the warning whenever billing (re)loads — billing is authoritative.
  useEffect(() => {
    if (billing) {
      const next = isOutOfCredits(billing)
      outOfCreditsRef.current = next
      setOutOfCredits(next)
    }
  }, [billing])

  // Live signals: a usage API error flips it on; a successful cost-incurring
  // call flips it off and triggers a single billing refresh to reconcile.
  useEffect(() => {
    const onExhausted = () => {
      outOfCreditsRef.current = true
      setOutOfCredits(true)
    }
    const onReplenished = () => {
      const wasOut = outOfCreditsRef.current
      outOfCreditsRef.current = false
      setOutOfCredits(false)
      if (wasOut) void refreshBilling()
    }
    window.addEventListener(CREDIT_EXHAUSTED_EVENT, onExhausted)
    window.addEventListener(CREDIT_REPLENISHED_EVENT, onReplenished)
    return () => {
      window.removeEventListener(CREDIT_EXHAUSTED_EVENT, onExhausted)
      window.removeEventListener(CREDIT_REPLENISHED_EVENT, onReplenished)
    }
  }, [refreshBilling])

  const handleRowboatLogin = useCallback(async () => {
    try {
      setLoggingIn(true)
      const result = await window.ipc.invoke('oauth:connect', { provider: 'rowboat' })
      if (!result.success) setLoggingIn(false)
    } catch {
      setLoggingIn(false)
    }
  }, [])

  // ----- data: email preview + unread count -----
  const [unreadEmailCount, setUnreadEmailCount] = useState(0)
  const [emailThreads, setEmailThreads] = useState<{ threadId: string; subject: string; from: string; date: string }[]>([])
  useEffect(() => {
    let cancelled = false
    const loadEmail = async () => {
      try {
        const result = await window.ipc.invoke('gmail:getImportant', { limit: 50 })
        if (cancelled) return
        const unread = result.threads.filter((t) => t.unread === true)
        setUnreadEmailCount(unread.length)
        setEmailThreads(unread.slice(0, 1).map((t) => ({
          threadId: t.threadId,
          subject: t.subject ?? '(No subject)',
          from: t.from ?? '',
          date: t.date ?? '',
        })))
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

  // ----- data: next upcoming meeting -----
  const [meetings, setMeetings] = useState<UpcomingMeeting[]>([])
  useEffect(() => {
    let cancelled = false
    const loadNext = async () => {
      try {
        const exists = await window.ipc.invoke('workspace:exists', { path: 'calendar_sync' })
        if (!exists.exists) { if (!cancelled) setMeetings([]); return }
        const entries = await window.ipc.invoke('workspace:readdir', {
          path: 'calendar_sync',
          opts: { recursive: false, includeHidden: false, includeStats: false },
        })
        const jsonEntries = entries.filter((e) => e.kind === 'file' && e.name.endsWith('.json'))
        const settled = await Promise.allSettled(jsonEntries.map(async (entry) => {
          const result = await window.ipc.invoke('workspace:readFile', { path: entry.path, encoding: 'utf8' })
          return normalizeUpcomingMeeting(JSON.parse(result.data) as RawCalendarEvent, entry.path)
        }))
        const items: UpcomingMeeting[] = []
        for (const r of settled) if (r.status === 'fulfilled' && r.value) items.push(r.value)
        items.sort((a, b) => {
          if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1
          return a.start.getTime() - b.start.getTime()
        })
        if (!cancelled) setMeetings(items.slice(0, 1))
      } catch { /* ignore */ }
    }
    void loadNext()
    const cleanup = window.ipc.on('workspace:didChange', (event) => {
      const paths = event.type === 'bulkChanged' ? (event.paths ?? [])
        : event.type === 'moved' ? [event.from, event.to]
        : 'path' in event ? [event.path] : []
      if (paths.some((p) => typeof p === 'string' && p.startsWith('calendar_sync'))) void loadNext()
    })
    const tick = setInterval(() => void loadNext(), 60 * 60 * 1000)
    return () => { cancelled = true; clearInterval(tick); cleanup() }
  }, [])

  // ----- data: code mode flag -----
  const [codeModeEnabled, setCodeModeEnabled] = useState(false)
  useEffect(() => {
    const load = () => {
      window.ipc.invoke('codeMode:getConfig', null)
        .then((r) => setCodeModeEnabled(r.enabled))
        .catch(() => setCodeModeEnabled(false))
    }
    load()
    window.addEventListener('code-mode-config-changed', load)
    return () => window.removeEventListener('code-mode-config-changed', load)
  }, [])

  // ----- data: pinned apps (right-click an app card in the Apps view) -----
  const [pinnedAppFolders, setPinnedAppFolders] = useState<string[]>(() => getPinnedApps())
  const [pinnedAppNames, setPinnedAppNames] = useState<Map<string, string> | null>(null)
  useEffect(() => onPinnedAppsChanged(setPinnedAppFolders), [])
  useEffect(() => {
    if (pinnedAppFolders.length === 0) return
    let cancelled = false
    void window.ipc.invoke('apps:list', {})
      .then((r) => {
        if (cancelled) return
        setPinnedAppNames(new Map(r.apps.map((a) => [a.folder, a.manifest?.name ?? a.folder])))
      })
      .catch(() => { /* fall back to folder names */ })
    return () => { cancelled = true }
  }, [pinnedAppFolders])
  const pinnedApps = useMemo(() => pinnedAppFolders
    .filter((f) => pinnedAppNames === null || pinnedAppNames.has(f))
    .map((f) => ({ folder: f, name: pinnedAppNames?.get(f) ?? f })), [pinnedAppFolders, pinnedAppNames])

  // ----- data: knowledge "Updated Xm ago" -----
  const latestNoteMtime = useMemo(() => {
    let latest = 0
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.path === 'knowledge/Meetings' || n.path === 'knowledge/Workspace' || n.path === 'knowledge/Agent Notes') continue
        if (n.kind === 'file') {
          if (n.stat?.mtimeMs && n.stat.mtimeMs > latest) latest = n.stat.mtimeMs
        } else if (n.children?.length) walk(n.children)
      }
    }
    walk(tree)
    return latest || null
  }, [tree])
  const [knowledgeUpdatedLabel, setKnowledgeUpdatedLabel] = useState<string | null>(null)
  useEffect(() => {
    if (!latestNoteMtime) { setKnowledgeUpdatedLabel(null); return }
    const update = () => setKnowledgeUpdatedLabel(`Updated ${formatAgo(latestNoteMtime)}`)
    update()
    const tick = setInterval(update, 60 * 1000)
    return () => clearInterval(tick)
  }, [latestNoteMtime])

  // ----- data: workspace count -----
  const workspaceCount = useMemo(() => {
    const find = (nodes: TreeNode[]): TreeNode | null => {
      for (const n of nodes) {
        if (n.path === 'knowledge/Workspace') return n
        if (n.kind === 'dir' && n.children?.length) {
          const found = find(n.children)
          if (found) return found
        }
      }
      return null
    }
    const node = find(tree)
    return node?.children?.filter((c) => c.kind === 'dir').length ?? 0
  }, [tree])

  // ----- data: background agents label -----
  const [bgAgentsLabel, setBgAgentsLabel] = useState<string | null>(null)
  const bgAgentsFailed = bgTaskSummaries.some((t) => t.lastRunError)
  useEffect(() => {
    const update = () => {
      const failed = bgTaskSummaries.filter((t) => t.lastRunError).length
      if (failed > 0) {
        setBgAgentsLabel(`${failed} failed · Needs review`)
        return
      }
      const active = bgTaskSummaries.filter((t) => t.active).length
      const lastRunMs = bgTaskSummaries.reduce((max, t) => {
        const ms = t.lastRunAt ? new Date(t.lastRunAt).getTime() : 0
        return Number.isFinite(ms) && ms > max ? ms : max
      }, 0)
      const parts: string[] = [active > 0 ? `${active} active` : 'No active agents']
      if (lastRunMs > 0) parts.push(`Last run ${formatAgo(lastRunMs)}`)
      setBgAgentsLabel(parts.join(' · '))
    }
    update()
    const tick = setInterval(update, 60 * 1000)
    return () => clearInterval(tick)
  }, [bgTaskSummaries])

  // ----- data: chats (pinned first, then most recent) -----
  const [pinnedChatIds, setPinnedChatIds] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem(PINNED_CHATS_STORAGE_KEY)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  })
  const toggleChatPin = useCallback((chatId: string) => {
    const isPinned = pinnedChatIds.includes(chatId)
    // Count only pins that still resolve to a chat — deleted chats leave
    // stale ids in localStorage and must not eat pin slots.
    const activePinCount = pinnedChatIds.filter((id) => recentRuns.some((r) => r.id === id)).length
    if (!isPinned && activePinCount >= MAX_PINNED_CHATS) {
      toast(`You can pin up to ${MAX_PINNED_CHATS} chats`, 'error')
      return
    }
    const next = isPinned ? pinnedChatIds.filter((id) => id !== chatId) : [...pinnedChatIds, chatId]
    try {
      window.localStorage.setItem(PINNED_CHATS_STORAGE_KEY, JSON.stringify(next))
    } catch { /* ignore */ }
    setPinnedChatIds(next)
  }, [pinnedChatIds, recentRuns])

  const recentChats = useMemo(() => {
    const chatRecency = (r: { createdAt: string; modifiedAt?: string }) => {
      const ms = new Date(r.modifiedAt ?? r.createdAt).getTime()
      return Number.isFinite(ms) ? ms : 0
    }
    const sorted = [...recentRuns].sort((a, b) => chatRecency(b) - chatRecency(a))
    const pinned = sorted.filter((r) => pinnedChatIds.includes(r.id))
    const rest = sorted.filter((r) => !pinnedChatIds.includes(r.id))
    return [...pinned, ...rest.slice(0, Math.max(0, 10 - pinned.length))]
  }, [recentRuns, pinnedChatIds])

  const [deleteChatTarget, setDeleteChatTarget] = useState<{ id: string; title: string } | null>(null)

  // ----- data: spaces (safe when the flag is off — the store stays empty) -----
  const { orgs, loading: spacesLoading, refresh: refreshSpaces } = useSpacesOrgs()
  const spacesUnread = useSpacesUnreadCounts()
  const totalSpacesUnread = useMemo(() => {
    let sum = 0
    for (const count of spacesUnread.values()) sum += count
    return sum
  }, [spacesUnread])
  const totalSpaces = useMemo(() => orgs.reduce((n, o) => n + o.spaces.length, 0), [orgs])

  // ----- data: sync status (for the Settings tooltip + activity popover) -----
  const { isSyncing, hasServiceErrors, statusLabel: syncStatusLabel, setServiceErrors } = useSyncStatus()

  // Where the ⌥Tab switcher lands for Spaces: the most recently opened space
  // (persisted by App), falling back to the first space anywhere; only when
  // there is none at all does it fall back to the flyout.
  const openLastSpace = useCallback((): boolean => {
    let last: { orgId: string; spaceId: string } | null = null
    try {
      last = JSON.parse(window.localStorage.getItem(LAST_SPACE_STORAGE_KEY) ?? 'null') as { orgId: string; spaceId: string } | null
    } catch { /* ignore */ }
    const isValid = last != null
      && orgs.some((o) => o.id === last.orgId && o.spaces.some((s) => s.id === last.spaceId))
    const target = isValid && last
      ? last
      : (() => {
        const org = orgs.find((o) => o.spaces.length > 0)
        return org ? { orgId: org.id, spaceId: org.spaces[0].id } : null
      })()
    if (!target) return false
    onOpenSpace?.(target.orgId, target.spaceId)
    return true
  }, [orgs, onOpenSpace])

  // ----- derived: meetings sublabel -----
  const previewEmail = emailThreads[0]
  const previewMeeting = meetings[0]
  const meetingIsRecording = meetingRecordingState === 'recording'
    || meetingRecordingState === 'connecting'
    || meetingRecordingState === 'stopping'
  const meetingIsBusy = meetingRecordingState === 'connecting' || meetingRecordingState === 'stopping'
  const recordingMeeting = previewMeeting != null && recordingMeetingSource === previewMeeting.source
    ? previewMeeting
    : null
  const meetingSublabel = meetingIsRecording
    ? (recordingMeeting?.summary ? `Recording · ${recordingMeeting.summary}` : 'Recording…')
    : (previewMeeting ? `${previewMeeting.summary} · ${formatMeetingTime(previewMeeting)}` : undefined)

  // ----- derived: settings status line -----
  const settingsStatus = outOfCredits
    ? 'Out of credits'
    : hasOauthError
      ? 'Accounts need attention'
      : !isRowboatConnected
        ? 'Sign in to Rowboat'
        : (isSyncing || hasServiceErrors)
          ? syncStatusLabel
          : (currentBillingPlan?.displayName ?? syncStatusLabel)
  const settingsAlert = outOfCredits || hasOauthError || (!isSyncing && hasServiceErrors)

  // The most recently touched chat, for the Assistant tile (recency only —
  // pinning shouldn't hijack "continue where I left off").
  const lastChat = useMemo(() => {
    const recency = (r: { createdAt: string; modifiedAt?: string }) => {
      const ms = new Date(r.modifiedAt ?? r.createdAt).getTime()
      return Number.isFinite(ms) ? ms : 0
    }
    return [...recentRuns].sort((a, b) => recency(b) - recency(a))[0] ?? null
  }, [recentRuns])

  // ----- the item list -----
  const rows = useMemo<DockRow[]>(() => {
    const items: DockRow[] = [
      // The top section: Assistant (resumes the most recent chat, falling
      // back to a fresh one — white tile) with Spaces right under it, then a
      // divider before the destinations.
      ...(onOpenRun || onNewChat ? [
        {
          item: {
            key: 'assistant', label: 'Assistant', icon: MascotFaceIcon as unknown as LucideIcon,
            status: 'Rowboat assistant',
            running: activeNav === 'assistant',
            onClick: () => {
              closeFlyouts()
              if (lastChat && onOpenRun) onOpenRun(lastChat.id)
              else onNewChat?.()
            },
          },
        },
      ] : []),
      ...(SPACES_ENABLED && (!switcherOnly || totalSpaces > 0) ? [{
        item: {
          key: 'spaces', label: 'Spaces', icon: MessagesSquare, tourId: 'nav-spaces',
          badge: totalSpacesUnread > 0 ? (totalSpacesUnread > 99 ? '99+' : String(totalSpacesUnread)) : undefined,
          status: totalSpacesUnread > 0
            ? `${totalSpacesUnread} unread`
            : totalSpaces > 0 ? `${totalSpaces} space${totalSpaces === 1 ? '' : 's'}` : undefined,
          running: activeNav === 'spaces' || spacesOpen,
          onClick: () => {
            if (!openLastSpace() && !switcherOnly) {
              setChatsOpen(false)
              setSpacesOpen(true)
            }
          },
          switchTo: () => {
            if (!openLastSpace() && !switcherOnly) {
              setChatsOpen(false)
              setSpacesOpen(true)
            }
          },
        },
      }] : []),
      { sep: true as const },
      {
        item: {
          key: 'home', label: 'Home', icon: Home, tourId: 'nav-home',
          running: activeNav === 'home',
          onClick: () => { closeFlyouts(); onOpenHome?.() },
        },
      },
      {
        item: {
          key: 'email', label: 'Email', icon: Mail, tourId: 'nav-email',
          badge: unreadEmailCount > 0 ? (unreadEmailCount > 99 ? '99+' : String(unreadEmailCount)) : undefined,
          status: previewEmail ? `${formatEmailFrom(previewEmail.from)} · ${previewEmail.subject}` : undefined,
          running: activeNav === 'email',
          onClick: () => { closeFlyouts(); onOpenEmail?.() },
        },
      },
      ...(codeModeEnabled ? [{
        item: {
          key: 'code', label: 'Code', icon: Code2, tourId: 'nav-code',
          running: activeNav === 'code',
          onClick: () => { closeFlyouts(); onOpenCode?.() },
        },
      }] : []),
      {
        item: {
          key: 'meetings', label: 'Meetings', icon: Mic, tourId: 'nav-meetings',
          badge: meetingIsRecording ? '●' : undefined,
          badgePulse: meetingIsRecording,
          status: meetingSublabel,
          statusAlert: meetingIsRecording,
          running: activeNav === 'meetings',
          onClick: () => { closeFlyouts(); onOpenMeetings?.() },
        },
      },
      {
        item: {
          key: 'brain', label: 'Brain', icon: FileText, tourId: 'nav-knowledge',
          status: knowledgeUpdatedLabel ?? undefined,
          running: activeNav === 'knowledge',
          onClick: () => { closeFlyouts(); knowledgeActions.openKnowledgeView() },
        },
      },
      {
        item: {
          key: 'apps', label: 'Apps', icon: LayoutGrid, tourId: 'nav-apps',
          running: activeNav === 'apps',
          onClick: () => { closeFlyouts(); onOpenApps?.() },
        },
      },
      // Apps pinned from the Apps view get their own tile: a monogram in a
      // color hashed from the folder, right-click to remove.
      ...pinnedApps.map(({ folder, name }) => ({
        item: {
          key: `app:${folder}`, label: name, icon: AppWindow,
          glyphColor: appGlyphColor(folder),
          monogram: appMonogram(name),
          onClick: () => { closeFlyouts(); onOpenApp?.(folder) },
        },
      })),
      {
        item: {
          key: 'agents', label: 'Background agents', switcherLabel: 'Agents', icon: Bot, tourId: 'nav-agents',
          badge: bgAgentsFailed ? '!' : undefined,
          status: bgAgentsLabel ?? undefined,
          statusAlert: bgAgentsFailed,
          running: activeNav === 'agents',
          onClick: () => { closeFlyouts(); onOpenBgTasks?.() },
        },
      },
      {
        item: {
          key: 'workspaces', label: 'Workspaces', icon: Folder, tourId: 'nav-workspaces',
          status: workspaceCount === 0 ? 'No workspaces' : `${workspaceCount} workspace${workspaceCount === 1 ? '' : 's'}`,
          running: activeNav === 'workspaces',
          onClick: () => { closeFlyouts(); knowledgeActions.openWorkspaceAt() },
        },
      },
      ...(onToggleBrowser ? [{
        item: {
          key: 'browser', label: 'Browser', icon: Globe,
          running: browserOpen,
          onClick: () => { closeFlyouts(); onToggleBrowser() },
        },
      }] : []),
      { sep: true },
      {
        item: {
          key: 'chats', label: 'Chats', icon: MessageSquare, tourId: 'nav-chats',
          running: chatsOpen,
          // Tile click opens the flyout; the switcher lands on all chats.
          onClick: () => { setSpacesOpen(false); setChatsOpen((v) => !v) },
          switchTo: () => onOpenChatHistory?.(),
        },
      },
      {
        item: {
          key: 'settings', label: 'Settings', icon: Settings,
          badge: (outOfCredits || hasOauthError) ? '!' : undefined,
          badgeAmber: !outOfCredits && hasOauthError,
          status: settingsStatus,
          statusAlert: settingsAlert,
          onClick: () => { closeFlyouts(); setSettingsOpen(true) },
        },
      },
    ]
    return items
  }, [
    activeNav, closeFlyouts, onOpenHome, unreadEmailCount, previewEmail, onOpenEmail,
    codeModeEnabled, onOpenCode, meetingIsRecording, meetingSublabel, onOpenMeetings,
    knowledgeUpdatedLabel, knowledgeActions, onOpenApps, pinnedApps, onOpenApp,
    bgAgentsFailed, bgAgentsLabel, onToggleBrowser, browserOpen,
    switcherOnly, openLastSpace, onOpenChatHistory,
    onNewChat, lastChat, onOpenRun,
    onOpenBgTasks, workspaceCount, totalSpacesUnread, totalSpaces, spacesOpen, chatsOpen,
    outOfCredits, hasOauthError, settingsStatus, settingsAlert,
  ])

  // ----- geometry: base icon size shrinks so the dock always fits the window -----
  const iconCount = rows.filter((r) => !r.sep).length
  const sepCount = rows.length - iconCount
  const base = Math.max(
    DOCK_ICON_MIN,
    Math.min(
      DOCK_ICON_MAX,
      Math.floor((winH - 96 - DOCK_PAD * 2 - sepCount * DOCK_SEP_H - (rows.length - 1) * DOCK_GAP) / iconCount),
    ),
  )

  // Row centers at rest, for the magnification falloff.
  const centers = useMemo(() => {
    let y = DOCK_PAD
    return rows.map((r) => {
      const h = r.sep ? DOCK_SEP_H : base
      const c = y + h / 2
      y += h + DOCK_GAP
      return c
    })
  }, [rows, base])

  const moving = mouseY != null
  const sizeFor = (i: number) => {
    if (!moving) return base
    const dist = Math.abs((mouseY as number) - centers[i])
    const f = Math.max(0, 1 - (dist / DOCK_MAG_RADIUS) * (dist / DOCK_MAG_RADIUS))
    return Math.round(base * (1 + DOCK_MAG * f))
  }

  // ----- app switcher (⌥/⌃ + Tab or `) -----
  // Sections in most-recently-used order (macOS ⌘Tab style): whenever a
  // section becomes active it moves to the front, so the switcher leads with
  // the current section and one ⌥Tab lands on the previous one.
  const [mruKeys, setMruKeys] = useState<string[]>([])
  useEffect(() => {
    const key = activeNav === 'knowledge' ? 'brain' : activeNav
    if (!key) return
    setMruKeys((prev) => (prev[0] === key ? prev : [key, ...prev.filter((k) => k !== key)]))
  }, [activeNav])

  // Never-visited items keep their dock order at the end (stable sort).
  const switcherItems = useMemo(() => {
    const items = rows
      .filter((r): r is { item: DockItemDef } => !r.sep)
      .map((r) => r.item)
    const rank = (key: string) => {
      const i = mruKeys.indexOf(key)
      return i === -1 ? mruKeys.length : i
    }
    return [...items].sort((a, b) => rank(a.key) - rank(b.key))
  }, [rows, mruKeys])
  const switcherRef = useRef({ open: switcherOpen, index: switcherIndex, items: switcherItems })
  switcherRef.current = { open: switcherOpen, index: switcherIndex, items: switcherItems }
  useEffect(() => {
    const commit = () => {
      const { index, items } = switcherRef.current
      setSwitcherOpen(false)
      const item = items[index]
      if (item) (item.switchTo ?? item.onClick)()
    }
    const cycle = (shift: boolean) => {
      const n = switcherRef.current.items.length
      if (n === 0) return
      if (!switcherRef.current.open) {
        setSwitcherOpen(true)
        setSwitcherIndex((shift ? n - 1 : 1) % n)
      } else {
        setSwitcherIndex((i) => (i + (shift ? n - 1 : 1)) % n)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Tab' || e.code === 'Backquote') && (e.altKey || e.ctrlKey) && !e.metaKey) {
        e.preventDefault()
        cycle(e.shiftKey)
      } else if (e.key === 'Escape') {
        if (switcherRef.current.open) {
          e.preventDefault()
          setSwitcherOpen(false)
        } else {
          closeFlyouts()
        }
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (switcherRef.current.open && ['Alt', 'Control'].includes(e.key)) commit()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    // Same chord forwarded from the main process while an embedded page (the
    // browser <webview>) holds keyboard focus — those keys never reach the
    // window listeners above.
    const cleanupForwarded = window.ipc.on('shortcuts:switcherKey', (msg) => {
      if (msg.type === 'keyDown' && (msg.key === 'Tab' || msg.code === 'Backquote') && (msg.alt || msg.control)) {
        cycle(msg.shift)
      } else if (msg.type === 'keyDown' && msg.key === 'Escape') {
        if (switcherRef.current.open) setSwitcherOpen(false)
      } else if (msg.type === 'keyUp' && switcherRef.current.open) {
        commit()
      }
    })
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      cleanupForwarded()
    }
  }, [closeFlyouts])

  // ----- flyouts close on outside click -----
  useEffect(() => {
    if (!chatsOpen && !spacesOpen) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null
      if (!t) return
      // Clicks inside the dock, a flyout, or any portalled Radix layer
      // (dropdowns, dialogs) don't dismiss.
      if (t.closest('[data-dock-root], [data-dock-flyout], [data-radix-popper-content-wrapper], [role="dialog"], [role="alertdialog"], [data-slot="alert-dialog-overlay"], [data-slot="dialog-overlay"]')) return
      closeFlyouts()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [chatsOpen, spacesOpen, closeFlyouts])

  // ----- per-item context menus -----
  const contextMenuFor = (key: string): React.ReactNode | null => {
    if (key.startsWith('app:')) {
      const folder = key.slice('app:'.length)
      return (
        <ContextMenuItem onClick={() => unpinApp(folder)}>
          <PanelLeftClose className="mr-2 size-3.5" /> Remove from sidebar
        </ContextMenuItem>
      )
    }
    switch (key) {
      case 'brain':
        return (
          <>
            <ContextMenuItem onClick={() => knowledgeActions.createNote()}>
              <FilePlus className="mr-2 size-3.5" /> New note
            </ContextMenuItem>
          </>
        )
      case 'meetings': {
        if (meetingIsRecording) {
          return (
            <ContextMenuItem disabled={meetingIsBusy} onClick={() => onToggleMeetingRecording?.()}>
              <Square className="mr-2 size-3.5 fill-red-500 text-red-500" />
              {meetingRecordingState === 'connecting' ? 'Starting…' : meetingRecordingState === 'stopping' ? 'Stopping…' : 'Stop recording'}
            </ContextMenuItem>
          )
        }
        if (!previewMeeting) return null
        return (
          <>
            <ContextMenuItem onClick={() => triggerMeetingCapture(previewMeeting, false)}>
              <Mic className="mr-2 size-3.5" /> Take notes
            </ContextMenuItem>
            {previewMeeting.conferenceLink && (
              <ContextMenuItem onClick={() => triggerMeetingCapture(previewMeeting, true)}>
                <Video className="mr-2 size-3.5" /> Join & take notes
              </ContextMenuItem>
            )}
          </>
        )
      }
      case 'spaces': {
        // Click goes straight to the last space, so the picker lives here.
        if (totalSpaces === 0) return null
        return (
          <>
            {orgs.flatMap((org) => org.spaces.map((space) => (
              <ContextMenuItem key={`${org.id}/${space.id}`} onClick={() => onOpenSpace?.(org.id, space.id)}>
                <MessagesSquare className="mr-2 size-3.5 text-muted-foreground" />
                <span className="truncate">{space.name}</span>
                {orgs.length > 1 && <span className="ml-2 truncate text-xs text-muted-foreground">{org.name}</span>}
              </ContextMenuItem>
            )))}
          </>
        )
      }
      case 'chats':
        return (
          <>
            {onNewChat && (
              <ContextMenuItem onClick={onNewChat}>
                <SquarePen className="mr-2 size-3.5" /> New chat
              </ContextMenuItem>
            )}
            {onOpenChatHistory && (
              <ContextMenuItem onClick={onOpenChatHistory}>
                <ArrowUpRight className="mr-2 size-3.5" /> View all chats
              </ContextMenuItem>
            )}
          </>
        )
      case 'settings':
        return (
          <>
            <ContextMenuItem onClick={() => setConnectionsSettingsOpen(true)}>
              <Plug className="mr-2 size-3.5" /> Connect accounts
              {hasOauthError && <span className="ml-auto size-1.5 rounded-full bg-amber-500" />}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => setSyncLogOpen(true)}>
              <History className="mr-2 size-3.5" /> Sync activity
            </ContextMenuItem>
            {onStartTour && (
              <ContextMenuItem onClick={onStartTour}>
                <MascotFaceIcon className="mr-2 size-3.5" /> Take a tour
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            {isRowboatConnected ? (
              appUrl && (
                <ContextMenuItem onClick={() => window.open(`${appUrl}?intent=upgrade`)}>
                  <ArrowUpRight className="mr-2 size-3.5" />
                  {outOfCredits
                    ? 'Out of credits · Upgrade'
                    : !billing?.subscriptionPlanId || currentBillingPlan?.category === 'free' || currentBillingPlan?.category === 'starter'
                      ? `${currentBillingPlan?.displayName ?? 'Free'} plan · Upgrade`
                      : `${currentBillingPlan?.displayName ?? 'Plan'} · Manage`}
                </ContextMenuItem>
              )
            ) : (
              <ContextMenuItem disabled={loggingIn} onClick={() => void handleRowboatLogin()}>
                <LogIn className="mr-2 size-3.5" />
                {loggingIn ? 'Signing in…' : 'Sign in to Rowboat'}
              </ContextMenuItem>
            )}
          </>
        )
      default:
        return null
    }
  }

  // ----- render -----
  return (
    <>
      {!switcherOnly && (
      <div
        data-dock-root=""
        className="rowboat-dock titlebar-no-drag"
        style={{ left: DOCK_EDGE_PX, width: base + DOCK_PAD * 2, gap: DOCK_GAP, padding: DOCK_PAD }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setMouseY(e.clientY - r.top)
        }}
        onMouseLeave={() => { setMouseY(null); setHoverIndex(null) }}
      >
        {rows.map((row, i) => {
          if (row.sep) {
            return (
              <div key={`sep-${i}`} style={{ width: base, height: DOCK_SEP_H, flex: 'none', display: 'flex', alignItems: 'center' }}>
                <div className="rowboat-dock-sep" />
              </div>
            )
          }
          const item = row.item
          const s = sizeFor(i)
          const Icon = item.icon
          const glyphColor = item.glyphColor ?? GLYPH_COLORS[item.key] ?? DEFAULT_GLYPH_COLOR
          // No tooltip while the switcher, or this tile's own flyout, is up.
          const flyoutOpen = (item.key === 'chats' && chatsOpen) || (item.key === 'spaces' && spacesOpen)
          const showTip = hoverIndex === i && !switcherOpen && !flyoutOpen
          const tile = (
            <div
              key={item.key}
              role="button"
              aria-label={item.label}
              data-tour-id={item.tourId}
              style={{
                position: 'relative',
                width: s,
                height: s,
                flex: 'none',
                cursor: 'pointer',
                transition: moving ? 'none' : 'width .22s cubic-bezier(.3,.9,.4,1), height .22s cubic-bezier(.3,.9,.4,1)',
              }}
              onMouseEnter={() => setHoverIndex(i)}
              onClick={item.onClick}
            >
              <div
                className="rowboat-dock-tile"
                style={{ borderRadius: Math.round(s * 0.24), background: item.key === 'assistant' ? ASSISTANT_FACE : tileFace(glyphColor) }}
              >
                {item.monogram ? (
                  <span className="font-bold" style={{ fontSize: Math.round(s * 0.44), lineHeight: 1, color: glyphColor }}>
                    {item.monogram}
                  </span>
                ) : (
                  <Icon size={Math.round(s * 0.56)} strokeWidth={2} style={{ color: glyphColor }} />
                )}
              </div>
              {item.badge && (
                <span className={cn('rowboat-dock-badge', item.badgeAmber && 'rowboat-dock-badge-amber', item.badgePulse && 'animate-pulse')}>
                  {item.badge}
                </span>
              )}
              {item.running && <span className="rowboat-dock-dot" />}
              {showTip && (
                <span className="rowboat-dock-tip" style={{ left: s + 16, padding: item.status ? '6px 12px' : '4px 10px' }}>
                  <span>{item.label}</span>
                  {item.status && (
                    <span className={cn('rowboat-dock-tip-status', item.statusAlert && 'rowboat-dock-tip-status-alert')}>
                      {item.status}
                    </span>
                  )}
                </span>
              )}
            </div>
          )
          const menu = contextMenuFor(item.key)
          const wrapped = menu ? (
            <ContextMenu key={item.key}>
              <ContextMenuTrigger asChild>{tile}</ContextMenuTrigger>
              <ContextMenuContent>{menu}</ContextMenuContent>
            </ContextMenu>
          ) : tile
          // The Settings tile doubles as the anchor for the sync-activity popover.
          if (item.key === 'settings') {
            return (
              <Popover key="settings-popover" open={syncLogOpen} onOpenChange={setSyncLogOpen}>
                <PopoverAnchor asChild>{wrapped}</PopoverAnchor>
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
            )
          }
          return wrapped
        })}
      </div>
      )}

      {/* Chats flyout */}
      {!switcherOnly && chatsOpen && (
        <ChatsFlyout
          recentChats={recentChats}
          pinnedChatIds={pinnedChatIds}
          onNewChat={onNewChat ? () => { closeFlyouts(); onNewChat() } : undefined}
          onOpenRun={onOpenRun ? (id) => { closeFlyouts(); onOpenRun(id) } : undefined}
          onOpenChatHistory={onOpenChatHistory ? () => { closeFlyouts(); onOpenChatHistory() } : undefined}
          onTogglePin={toggleChatPin}
          onRenameRun={onRenameRun}
          onRequestDelete={onDeleteRun ? (id, title) => setDeleteChatTarget({ id, title }) : undefined}
        />
      )}

      {/* Spaces flyout */}
      {SPACES_ENABLED && !switcherOnly && spacesOpen && (
        <SpacesFlyout
          orgs={orgs}
          loading={spacesLoading}
          unread={spacesUnread}
          activeSpace={activeSpace}
          onOpenSpace={(orgId, spaceId) => { closeFlyouts(); onOpenSpace?.(orgId, spaceId) }}
          onAddOrg={() => setAddOrgOpen(true)}
          onChanged={() => void refreshSpaces()}
        />
      )}

      {/* App switcher overlay (⌥/⌃ + Tab or `) */}
      {switcherOpen && (
        <div data-slot="dock-overlay" data-state="open" className="fixed inset-0 z-50 flex items-center justify-center bg-black/10">
          <div className="flex flex-col items-center gap-2.5">
            <div className="rowboat-dock-switcher">
              {switcherItems.map((item, i) => {
                const Icon = item.icon
                const glyphColor = item.glyphColor ?? GLYPH_COLORS[item.key] ?? DEFAULT_GLYPH_COLOR
                const selected = i === switcherIndex
                return (
                  <div
                    key={item.key}
                    className={cn(
                      'flex cursor-pointer flex-col items-center gap-2 rounded-2xl px-3 pb-2.5 pt-3.5',
                      selected && 'bg-black/10 dark:bg-white/10',
                    )}
                    onClick={() => { setSwitcherOpen(false); (item.switchTo ?? item.onClick)() }}
                  >
                    <div
                      className="rowboat-dock-tile"
                      style={{ width: 72, height: 72, borderRadius: 17, background: tileFace(glyphColor) }}
                    >
                      {item.monogram ? (
                        <span className="font-bold" style={{ fontSize: 32, lineHeight: 1, color: glyphColor }}>{item.monogram}</span>
                      ) : (
                        <Icon size={40} strokeWidth={2} style={{ color: glyphColor }} />
                      )}
                    </div>
                    <span
                      className={cn(
                        'max-w-[86px] truncate text-center text-xs',
                        selected ? 'font-bold text-foreground' : 'font-medium text-muted-foreground',
                      )}
                    >
                      {item.switcherLabel ?? item.label}
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="rounded-full bg-background/60 px-3 py-1 text-xs text-foreground/45 backdrop-blur-md">
              hold ⌥ or ⌃, tap Tab or ` to cycle · release to switch · Esc to cancel
            </div>
          </div>
        </div>
      )}

      {/* First-time-action credit rewards (feature-flagged, signed-in only).
          The expanded panel carries its own copy, so dock mode only. */}
      {!switcherOnly && (
      <div className="titlebar-no-drag fixed bottom-2 left-2 z-30 w-60">
        <SidebarCreditRewards
          onOpenEmail={onOpenEmail}
          onOpenMeetings={onOpenMeetings}
          onOpenAgents={onOpenBgTasks}
          onOpenApps={onOpenApps}
          onConnectAccounts={() => setConnectionsSettingsOpen(true)}
        />
      </div>
      )}

      {/* Chat pending delete confirmation */}
      <AlertDialog open={!!deleteChatTarget} onOpenChange={(open) => { if (!open) setDeleteChatTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleteChatTarget?.title}&rdquo; and its full history will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (deleteChatTarget) onDeleteRun?.(deleteChatTarget.id)
                setDeleteChatTarget(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Settings dialogs (main + a connections-tab shortcut) */}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <SettingsDialog
        defaultTab="connections"
        open={connectionsSettingsOpen}
        onOpenChange={setConnectionsSettingsOpen}
      />

      {/* Add-org dialog lives at the root so closing the flyout can't unmount it */}
      {SPACES_ENABLED && (
        <AddOrgDialog open={addOrgOpen} onOpenChange={setAddOrgOpen} onAdded={() => void refreshSpaces()} />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Chats flyout
// ---------------------------------------------------------------------------

function ChatsFlyout({
  recentChats,
  pinnedChatIds,
  onNewChat,
  onOpenRun,
  onOpenChatHistory,
  onTogglePin,
  onRenameRun,
  onRequestDelete,
}: {
  recentChats: { id: string; title?: string }[]
  pinnedChatIds: string[]
  onNewChat?: () => void
  onOpenRun?: (runId: string) => void
  onOpenChatHistory?: () => void
  onTogglePin: (chatId: string) => void
  onRenameRun?: (runId: string, title: string) => void
  onRequestDelete?: (chatId: string, title: string) => void
}) {
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const commitRename = (chatId: string) => {
    const title = renameDraft.trim()
    const current = recentChats.find((c) => c.id === chatId)
    setRenamingChatId(null)
    if (!title || title === (current?.title ?? '')) return
    onRenameRun?.(chatId, title)
  }

  return (
    <div data-dock-flyout="" data-slot="dock-overlay" data-state="open" className="rowboat-dock-flyout titlebar-no-drag" style={{ left: DOCK_FLYOUT_LEFT_PX }}>
      <div className="flex items-center justify-between px-2 pb-2.5 pt-1">
        <span className="text-[13px] font-bold text-foreground/70">Chats</span>
        {onNewChat && (
          <button
            type="button"
            onClick={onNewChat}
            className="flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300"
          >
            <SquarePen className="size-3" /> New chat
          </button>
        )}
      </div>
      {recentChats.length === 0 ? (
        <div className="px-2.5 pb-2 text-[11.5px] italic text-muted-foreground">
          Your recent chats show up here.
        </div>
      ) : (
        recentChats.map((chat) => (
          <div key={chat.id} className="group/chat-row relative">
            {renamingChatId === chat.id ? (
              <div className="flex h-9 items-center gap-2.5 rounded-[9px] px-2.5">
                <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitRename(chat.id)
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      e.stopPropagation()
                      setRenamingChatId(null)
                    }
                  }}
                  onBlur={() => commitRename(chat.id)}
                  className="h-6 min-w-0 flex-1 rounded-sm border border-border bg-background px-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onOpenRun?.(chat.id)}
                  className="flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[13.5px] text-foreground/90 hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate pr-5">{chat.title || '(Untitled chat)'}</span>
                  {pinnedChatIds.includes(chat.id) && (
                    <Pin className="size-3 shrink-0 text-muted-foreground/70 transition-opacity group-hover/chat-row:opacity-0" />
                  )}
                </button>
                {onRenameRun && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="Chat options"
                        onClick={(e) => e.stopPropagation()}
                        className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/chat-row:opacity-100 data-[state=open]:opacity-100"
                      >
                        <MoreVertical className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" align="start">
                      <DropdownMenuItem onClick={() => onTogglePin(chat.id)}>
                        <Pin className="mr-2 size-3.5" />
                        {pinnedChatIds.includes(chat.id) ? 'Unpin' : 'Pin'}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setRenameDraft(chat.title || '')
                          setRenamingChatId(chat.id)
                        }}
                      >
                        <Pencil className="mr-2 size-3.5" />
                        Rename
                      </DropdownMenuItem>
                      {onRequestDelete && (
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => onRequestDelete(chat.id, chat.title || '(Untitled chat)')}
                        >
                          <Trash2 className="mr-2 size-3.5" />
                          Delete
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </>
            )}
          </div>
        ))
      )}
      {onOpenChatHistory && recentChats.length > 0 && (
        <button
          type="button"
          onClick={onOpenChatHistory}
          className="flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[13px] text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
        >
          <ArrowUpRight className="size-4 shrink-0" />
          View all
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Spaces flyout (ported from the old sidebar's SPACES section)
// ---------------------------------------------------------------------------

function SpacesFlyout({
  orgs,
  loading,
  unread,
  activeSpace,
  onOpenSpace,
  onAddOrg,
  onChanged,
}: {
  orgs: OrgWithSpaces[]
  loading: boolean
  unread: Map<string, number>
  activeSpace: SpaceSelection
  onOpenSpace: (orgId: string, spaceId: string) => void
  onAddOrg: () => void
  onChanged: () => void
}) {
  return (
    <div data-dock-flyout="" data-slot="dock-overlay" data-state="open" className="rowboat-dock-flyout titlebar-no-drag" style={{ left: DOCK_FLYOUT_LEFT_PX }}>
      <div className="flex items-center justify-between px-2 pb-2.5 pt-1">
        <span className="text-[13px] font-bold text-foreground/70">Spaces</span>
        <button
          type="button"
          onClick={onAddOrg}
          className="flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300"
        >
          <Plus className="size-3" /> Add org
        </button>
      </div>
      {loading ? (
        <div className="px-2.5 pb-2 text-[11.5px] text-muted-foreground">Loading…</div>
      ) : orgs.length === 0 ? (
        <button
          type="button"
          onClick={onAddOrg}
          className="px-2.5 pb-2 text-left text-[11.5px] italic text-muted-foreground hover:text-foreground"
        >
          Add an org to see its spaces here.
        </button>
      ) : (
        orgs.map((org) => (
          <FlyoutOrgRows
            key={org.id}
            org={org}
            activeSpace={activeSpace}
            unread={unread}
            onOpenSpace={onOpenSpace}
            onChanged={onChanged}
          />
        ))
      )}
    </div>
  )
}

function FlyoutOrgRows({ org, activeSpace, unread, onOpenSpace, onChanged }: {
  org: OrgWithSpaces
  activeSpace: SpaceSelection
  unread: Map<string, number>
  onOpenSpace: (orgId: string, spaceId: string) => void
  onChanged: () => void
}) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  // A dead OAuth session shows as a gentle "Sign in again" (org.authError, from core);
  // an unreachable org shows Retry.
  const needsSignIn = !!org.authError
  const [signingIn, setSigningIn] = useState(false)
  const signInAgain = async () => {
    setSigningIn(true)
    try {
      await window.ipc.invoke('spaces:signInOrg', { orgId: org.id })
      toast(`Signed back into ${org.name}`, 'success')
      onChanged()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Sign-in failed', 'error')
    } finally {
      setSigningIn(false)
    }
  }

  const createSpace = async () => {
    const name = newName.trim()
    if (!name) return
    try {
      const { space } = await window.ipc.invoke('spaces:createSpace', { orgId: org.id, name })
      setCreating(false)
      setNewName('')
      onChanged()
      onOpenSpace(org.id, space.id)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create the space', 'error')
    }
  }

  return (
    <>
      <div className="group/org flex h-8 items-center gap-1.5 rounded-[9px] px-2 text-[11.5px] text-muted-foreground" title={`${org.address} · you are ${org.memberId}`}>
        <OrgMonogram org={org} size="sm" />
        <span className="flex-1 truncate">{org.name}</span>
        {needsSignIn ? (
          <button
            type="button"
            onClick={() => void signInAgain()}
            disabled={signingIn}
            className="rounded-sm border border-border bg-background px-1.5 py-px text-[10.5px] text-foreground/80 hover:bg-accent disabled:opacity-50"
            title={`Session expired — ${org.authError}`}
          >
            {signingIn ? 'Signing in…' : 'Sign in again'}
          </button>
        ) : org.error ? (
          <button
            type="button"
            onClick={onChanged}
            className="rounded-sm border border-border bg-background px-1.5 py-px text-[10.5px] text-foreground/80 hover:bg-accent"
            title={org.error}
          >
            Retry
          </button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Org options"
              className="flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/org:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreVertical className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start">
            <DropdownMenuItem onClick={() => setCreating(true)}>
              <Plus className="mr-2 size-3.5" /> New space
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => {
                void window.ipc.invoke('spaces:removeOrg', { orgId: org.id }).then(onChanged)
              }}
            >
              <Trash2 className="mr-2 size-3.5" /> Remove org
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {org.spaces.map((space) => {
        const active = activeSpace?.orgId === org.id && activeSpace.spaceId === space.id
        const count = unread.get(`${org.id}/${space.id}`) ?? 0
        return (
          <button
            key={space.id}
            type="button"
            onClick={() => onOpenSpace(org.id, space.id)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-[9px] py-2 pl-5 pr-2.5 text-left text-[13.5px] text-foreground/90 hover:bg-black/5 dark:hover:bg-white/10',
              active && 'bg-black/5 dark:bg-white/10',
            )}
          >
            <span className={cn('min-w-0 flex-1 truncate', count > 0 && !active && 'font-medium text-foreground')}>{space.name}</span>
            {count > 0 && (
              <span className="shrink-0 text-[11px] font-semibold tabular-nums text-foreground/80">{count}</span>
            )}
          </button>
        )
      })}
      {org.spaces.length === 0 && !org.error && !creating && (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex w-full items-center gap-2 rounded-[9px] py-2 pl-5 pr-2.5 text-left text-xs text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
        >
          <Plus className="size-3.5 shrink-0" />
          <span className="flex-1 truncate">Create the first space</span>
        </button>
      )}
      {creating && (
        <div className="flex items-center gap-1 py-0.5 pl-5 pr-2">
          <Input
            autoFocus
            value={newName}
            placeholder="Space name"
            className="h-7 text-xs"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createSpace()
              if (e.key === 'Escape') {
                e.stopPropagation()
                setCreating(false)
                setNewName('')
              }
            }}
            onBlur={() => {
              if (!newName.trim()) setCreating(false)
            }}
          />
        </div>
      )}
    </>
  )
}
