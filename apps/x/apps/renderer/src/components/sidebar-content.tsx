"use client"

import { SidebarChatContextMenu } from "./sidebar-chat-context-menu"
import * as React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AppWindow,
  Bot,
  FileText,
  Folder,
  AlertTriangle,
  LayoutGrid,
  ListTodo,
  Mic,
  PanelLeftClose,
  Pencil,
  Pin,
  Trash2,
  Plug,
  LoaderIcon,
  Mail,
  MoreHorizontal,
  Search,
  Settings,
  SquarePen,
  Square,
  Video,
  CircleAlert,
  X,
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
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverArrow,
  PopoverAnchor,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import { getPinnedApps, onPinnedAppsChanged, unpinApp } from "@/lib/pinned-apps"
import { isOutOfCredits, CREDIT_EXHAUSTED_EVENT, CREDIT_REPLENISHED_EVENT } from "@/lib/credit-status"
import { SettingsDialog } from "@/components/settings-dialog"
import { SidebarCreditRewards } from "@/components/sidebar-credit-rewards"
import { SpacesSidebarSection } from "@/components/spaces-sidebar-section"
import { SidebarSection } from "@/components/sidebar-section"
import { Keys } from "@/components/keys"
import { SHORTCUTS } from "@/lib/shortcuts"
import { useCodeSessions } from "@/components/code/use-code-sessions"
import { useUnreadCodeSessions } from "@/components/code/session-read-state"
import { UnreadBadge } from "@/components/spaces/unread-badge"
import { SPACES_ENABLED } from "@/lib/feature-flags"
import type { SpaceSelection } from "@/components/spaces-view"
import { MascotFaceIcon } from "@/components/talking-head"
import { extractConferenceLink } from "@/lib/calendar-event"
import { useBilling } from "@/hooks/useBilling"
import { useRowboatConfig } from "@/hooks/use-rowboat-config"
import { toast } from "@/lib/toast"
import { getBillingPlanData } from "@x/shared/dist/billing.js"
import { ServiceEvent } from "@x/shared/src/service-events.js"
import z from "zod"
import "@/styles/sidebar.css"

interface TreeNode {
  path: string
  name: string
  kind: "file" | "dir"
  children?: TreeNode[]
  loaded?: boolean
  stat?: { size: number; mtimeMs: number }
}

type KnowledgeActions = {
  createNote: (parentPath?: string) => void
  createFolder: (parentPath?: string) => Promise<string>
  openGraph: () => void
  openBases: () => void
  openKnowledgeView: () => void
  openWorkspaceAt: (path?: string) => void
  createWorkspace: (name: string) => Promise<string>
  expandAll: () => void
  collapseAll: () => void
  rename: (path: string, newName: string, isDir: boolean) => Promise<void>
  remove: (path: string) => Promise<void>
  copyPath: (path: string) => void
  revealInFileManager: (path: string, isDir: boolean) => void
  onOpenInNewTab?: (path: string) => void
}

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

type TaskSummary = {
  slug: string
  name: string
  active: boolean
  createdAt: string
  lastAttemptAt?: string
  lastRunAt?: string
  lastRunError?: string
}

type ServiceEventType = z.infer<typeof ServiceEvent>

const MAX_SYNC_EVENTS = 1000
const RUN_STALE_MS = 2 * 60 * 60 * 1000
const PINNED_CHATS_STORAGE_KEY = 'x:pinned-chats'
const MAX_PINNED_CHATS = 3
const MIN_CHATS = 10
const MAX_CHATS = 60
/** One chat row: 32px tall plus the 2px gap (styles/sidebar.css). */
const CHAT_ROW_PX = 34

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

type SidebarContentPanelProps = {
  tree: TreeNode[]
  onSelectFile: (path: string, kind: "file" | "dir") => void
  knowledgeActions: KnowledgeActions
  bgTaskSummaries?: TaskSummary[]
  onOpenMeetings?: () => void
  onOpenCode?: () => void
  onOpenBgTasks?: () => void
  onOpenApps?: () => void
  /** Open a specific app (pinned in the sidebar) inside the Apps view. */
  onOpenApp?: (folder: string) => void
  /** Open one space (org + space) in the Spaces view. */
  onOpenSpace?: (orgId: string, spaceId: string) => void
  onOpenSpaces?: () => void
  /** The space currently open, for highlighting its sidebar row. */
  activeSpace?: SpaceSelection
  onOpenAgent?: (slug: string) => void
  recentRuns?: { id: string; title?: string; createdAt: string; modifiedAt?: string }[]
  onOpenAssistant?: () => void
  onOpenRun?: (runId: string) => void
  /** Persist a custom chat title (sessions:setTitle) and refresh the runs list. */
  onRenameRun?: (runId: string, title: string) => void
  /** Delete the chat's session (sessions:delete) and refresh the runs list. */
  onDeleteRun?: (runId: string) => void
  onOpenChatHistory?: () => void
  onOpenEmail?: (threadId?: string) => void
  onOpenHome?: () => void
  onNewChat?: () => void
  /** Opens the command palette (⌘K). */
  onOpenSearch?: () => void
  onVoiceNoteCreated?: (path: string) => void
  /** Starts the mascot-guided product tour. */
  onStartTour?: () => void
  /** Which primary destination is currently active, for nav highlighting. */
  activeNav?: 'assistant' | 'home' | 'email' | 'meetings' | 'code' | 'knowledge' | 'agents' | 'apps' | 'spaces' | 'workspaces' | null
  /** Live meeting recording state, so the recording row can show its indicator/stop. */
  meetingRecordingState?: 'idle' | 'connecting' | 'recording' | 'stopping'
  recordingMeetingSource?: string | null
  onToggleMeetingRecording?: () => void
} & React.ComponentProps<typeof Sidebar>

function formatEventTime(ts: string): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

function SyncStatusBar() {
  const { state } = useSidebar()
  const [activeServices, setActiveServices] = useState<Map<string, string>>(new Map())
  const [serviceErrors, setServiceErrors] = useState<Map<string, string>>(new Map())
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [logEvents, setLogEvents] = useState<ServiceEventType[]>([])
  const [logLoading, setLogLoading] = useState(false)
  const runTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Track active runs from real-time events
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

  // Load logs from JSONL file when popover opens
  useEffect(() => {
    if (!popoverOpen) return
    let cancelled = false
    async function loadLogs() {
      setLogLoading(true)
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
        setServiceErrors(collectServiceErrors(parsed))
        // Newest first, limit to 1000
        setLogEvents(parsed.reverse().slice(0, MAX_SYNC_EVENTS))
      } catch {
        if (!cancelled) {
          setLogEvents([])
          setServiceErrors(new Map())
        }
      } finally {
        if (!cancelled) setLogLoading(false)
      }
    }
    loadLogs()
    return () => { cancelled = true }
  }, [popoverOpen])

  const isSyncing = activeServices.size > 0
  const isCollapsed = state === "collapsed"
  const errorEntries = Array.from(serviceErrors.entries())
  const primaryErrorService = errorEntries[0]?.[0] ?? null
  const hasServiceErrors = errorEntries.length > 0

  // Build status label from active services
  const activeServiceNames = [...new Set(activeServices.values())]
  const statusLabel = isSyncing
    ? activeServiceNames.map((s) => SERVICE_LABELS[s] || s).join(", ")
    : hasServiceErrors
      ? errorEntries.length === 1
        ? `${SERVICE_LABELS[primaryErrorService ?? ""] || primaryErrorService} failed`
        : "Recent sync issues"
      : "All caught up"

  // Sidebar redesign (2026-10-21): sync status is a small mark at the right of
  // the account row instead of its own footer strip; it opens the same log.
  return (
    <>
      {isCollapsed && isSyncing && (
        <div
          className="fixed bottom-4 z-40 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background shadow-sm"
          style={{ left: "0.5rem" }}
          aria-label="Syncing"
        >
          <LoaderIcon className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <Tooltip delayDuration={400}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`Sync activity: ${statusLabel}`}
                className={cn("sb-row-action sb-sync", hasServiceErrors && !isSyncing && "text-destructive!")}
              >
                {isSyncing ? (
                  <LoaderIcon className="animate-spin" />
                ) : hasServiceErrors ? (
                  <AlertTriangle />
                ) : (
                  <span className="size-1.5 rounded-full bg-emerald-500/80" />
                )}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>{statusLabel}</TooltipContent>
        </Tooltip>
        <PopoverContent
          side="right"
          align="end"
          sideOffset={12}
          className="w-96 p-0"
        >
          <div className="p-3 border-b">
            <h4 className="font-semibold text-sm">Sync Activity</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isSyncing || hasServiceErrors ? statusLabel : "All services up to date"}
            </p>
          </div>
          <div className="max-h-80 overflow-y-auto p-2">
            {logLoading ? (
              <div className="flex items-center justify-center py-4">
                <LoaderIcon className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : logEvents.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                No recent activity.
              </div>
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
        </PopoverContent>
      </Popover>
    </>
  )
}

export function SidebarContentPanel({
  tree,
  knowledgeActions,
  bgTaskSummaries = [],
  onOpenMeetings,
  onOpenBgTasks,
  onOpenApps,
  onOpenApp,
  onOpenSpace,
  onOpenSpaces,
  activeSpace,
  recentRuns = [],
  onOpenRun,
  onOpenAssistant,
  onRenameRun,
  onDeleteRun,
  onOpenChatHistory,
  onOpenEmail,
  onOpenHome,
  onNewChat,
  onOpenSearch,
  onVoiceNoteCreated,
  onStartTour,
  activeNav,
  meetingRecordingState = 'idle',
  recordingMeetingSource = null,
  onToggleMeetingRecording,
  ...props
}: SidebarContentPanelProps) {
  const { sessions: projectSessions, statusOf: projectSessionStatusOf } = useCodeSessions()
  const hasWorkingProjectSession = projectSessions.some((session) => projectSessionStatusOf(session.id) === 'working')
  const unreadProjectSessions = useUnreadCodeSessions()
  const unreadProjectCount = projectSessions.filter((session) => unreadProjectSessions.has(session.id)).length
  const [hasOauthError, setHasOauthError] = useState(false)
  const [showOauthAlert, setShowOauthAlert] = useState(true)
  const [connectionsSettingsOpen, setConnectionsSettingsOpen] = useState(false)
  const [openConnectionsAfterClose, setOpenConnectionsAfterClose] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isRowboatConnected, setIsRowboatConnected] = useState(false)
  const [creditPopoverOpen, setCreditPopoverOpen] = useState(false)
  // 2026-10-07: the sidebar collapses offcanvas, sliding the plan card off-screen,
  // and a popover anchored to it is cut off. Hide it while collapsed; the open
  // state is kept, so an out-of-credits auto-open still shows on expand.
  const { state: sidebarState } = useSidebar()
  const sidebarCollapsed = sidebarState === "collapsed"
  const [outOfCredits, setOutOfCredits] = useState(false)
  const outOfCreditsRef = useRef(false)
  const creditPopoverAutoShownRef = useRef(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const appUrl = useRowboatConfig()?.appUrl ?? null
  const { billing, refresh: refreshBilling } = useBilling(isRowboatConnected)
  const currentBillingPlan = billing ? getBillingPlanData(billing.catalog, billing.subscriptionPlanId) : null

  // The Gmail account's display name, for the footer.
  const [gmailName, setGmailName] = useState('')
  useEffect(() => {
    let cancelled = false
    window.ipc.invoke('gmail:getAccountName', {})
      .then((res) => { if (!cancelled && res?.name) setGmailName(res.name) })
      .catch(() => { /* fall back to the email address */ })
    return () => { cancelled = true }
  }, [])

  // Nav previews: unread important emails + next upcoming meetings (top 2 each).
  const [unreadEmailCount, setUnreadEmailCount] = useState(0)
  const [emailThreads, setEmailThreads] = useState<SidebarEmailThread[]>([])
  const [meetings, setMeetings] = useState<UpcomingMeeting[]>([])
  // A minute clock for "in 12m" and trial days, so they stay current.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60 * 1000)
    return () => clearInterval(tick)
  }, [])
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

  const recentNotes = React.useMemo<TreeNode[]>(() => {
    const out: TreeNode[] = []
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.path === 'knowledge/Meetings' || n.path === 'knowledge/Workspace' || n.path === 'knowledge/Agent Notes') continue
        if (n.kind === 'file') out.push(n)
        else if (n.children?.length) walk(n.children)
      }
    }
    walk(tree)
    return out
      .filter((n) => n.stat?.mtimeMs)
      .sort((a, b) => (b.stat?.mtimeMs ?? 0) - (a.stat?.mtimeMs ?? 0))
      .slice(0, 10)
  }, [tree])

  // The most recently touched chat, for the Assistant row (recency only —
  // pinning shouldn't hijack "continue where I left off"). Mirrors the dock.
  const lastChat = useMemo(() => {
    const recency = (r: { createdAt: string; modifiedAt?: string }) => {
      const ms = new Date(r.modifiedAt ?? r.createdAt).getTime()
      return Number.isFinite(ms) ? ms : 0
    }
    return [...recentRuns].sort((a, b) => recency(b) - recency(a))[0] ?? null
  }, [recentRuns])

  // Pinned chats: a per-machine UI preference, persisted in localStorage.
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

  // Chats: pinned first, then the most recently modified, 10 rows total.
  const [chatLimit, setChatLimit] = useState(MIN_CHATS)
  const recentChats = React.useMemo(() => {
    const chatRecency = (r: { createdAt: string; modifiedAt?: string }) => {
      const ms = new Date(r.modifiedAt ?? r.createdAt).getTime()
      return Number.isFinite(ms) ? ms : 0
    }
    const sorted = [...recentRuns].sort((a, b) => chatRecency(b) - chatRecency(a))
    const pinned = sorted.filter((r) => pinnedChatIds.includes(r.id))
    const rest = sorted.filter((r) => !pinnedChatIds.includes(r.id))
    return [...pinned, ...rest.slice(0, Math.max(0, chatLimit - pinned.length))]
  }, [recentRuns, pinnedChatIds, chatLimit])

  // Chats fill whatever height the sidebar has left (2026-10-21): fold Spaces
  // or make the window taller and more recent chats show, never fewer than 10.
  const contentRef = useRef<HTMLDivElement | null>(null)
  const runCount = recentRuns.length
  useEffect(() => {
    const el = contentRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      // Free room = the box's height minus where its last section ends
      // (scrollHeight can't say: it never drops below the box's height).
      const last = Array.from(el.children).reverse().find((c) => (c as HTMLElement).offsetHeight > 0)
      if (!last) return
      const used = last.getBoundingClientRect().bottom - el.getBoundingClientRect().top + el.scrollTop
      const slack = el.clientHeight - used - parseFloat(getComputedStyle(el).paddingBottom)
      setChatLimit((n) => {
        if (slack >= CHAT_ROW_PX) return Math.max(n, Math.min(n + Math.floor(slack / CHAT_ROW_PX), runCount, MAX_CHATS))
        if (slack < 0 && n > MIN_CHATS) return Math.max(MIN_CHATS, n - Math.ceil(-slack / CHAT_ROW_PX))
        return n
      })
    })
    observer.observe(el)
    for (const child of Array.from(el.children)) observer.observe(child)
    return () => observer.disconnect()
  }, [runCount])

  // Apps pinned to the sidebar (right-click an app card in the Apps view).
  // Names resolve via apps:list; until then rows show the folder slug, and
  // pins whose app no longer exists are hidden (but kept in storage).
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
  const pinnedApps = pinnedAppFolders
    .filter((f) => pinnedAppNames === null || pinnedAppNames.has(f))
    .map((f) => ({ folder: f, name: pinnedAppNames?.get(f) ?? f }))

  // Chats that arrive after the list first loads slide in; the first load
  // doesn't animate.
  const [chatBaseline, setChatBaseline] = useState<ReadonlySet<string> | null>(null)
  if (chatBaseline === null && recentChats.length > 0) {
    setChatBaseline(new Set(recentChats.map((chat) => chat.id)))
  }

  // Chat pending delete confirmation, if any.
  const [deleteChatTarget, setDeleteChatTarget] = useState<{ id: string; title: string } | null>(null)

  // Inline chat rename: which row is editing and its draft text.
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const commitChatRename = useCallback((chatId: string) => {
    const title = renameDraft.trim()
    const current = recentChats.find((c) => c.id === chatId)
    setRenamingChatId(null)
    if (!title || title === (current?.title ?? '')) return
    onRenameRun?.(chatId, title)
  }, [renameDraft, recentChats, onRenameRun])

  // "Updated 4m ago" sublabel under Knowledge, based on the most recently
  // modified note. Recomputed in an effect (not during render) and ticked so
  // the relative time stays fresh.
  const latestNoteMtime = recentNotes[0]?.stat?.mtimeMs ?? null
  const [knowledgeUpdatedLabel, setKnowledgeUpdatedLabel] = useState<string | null>(null)
  useEffect(() => {
    if (!latestNoteMtime) { setKnowledgeUpdatedLabel(null); return }
    const update = () => setKnowledgeUpdatedLabel(`Updated ${formatAgo(latestNoteMtime)}`)
    update()
    const tick = setInterval(update, 60 * 1000)
    return () => clearInterval(tick)
  }, [latestNoteMtime])

  // "2 active · Last run 3m ago" sublabel under Background agents, overridden by
  // "N failed · Needs review" when any task's last run errored.
  const [bgAgentsLabel, setBgAgentsLabel] = useState<string | null>(null)
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

  const handleRowboatLogin = useCallback(async () => {
    try {
      setLoggingIn(true)
      const result = await window.ipc.invoke('oauth:connect', { provider: 'rowboat' })
      if (!result.success) {
        setLoggingIn(false)
      }
    } catch {
      setLoggingIn(false)
    }
  }, [])

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
          if (!hasError) {
            setShowOauthAlert(true)
          }
        }
      } catch (error) {
        console.error('Failed to fetch OAuth state:', error)
        if (mounted) {
          setHasOauthError(false)
          setIsRowboatConnected(false)
          setShowOauthAlert(true)
        }
      }
    }

    refreshOauthError()
    const cleanup = window.ipc.on('oauth:didConnect', () => {
      refreshOauthError()
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

  // Auto-open the popover the first time we go out of credits; reset when
  // credits return so it can auto-open again on a future episode.
  useEffect(() => {
    if (outOfCredits) {
      if (!creditPopoverAutoShownRef.current) {
        creditPopoverAutoShownRef.current = true
        setCreditPopoverOpen(true)
      }
    } else {
      creditPopoverAutoShownRef.current = false
      setCreditPopoverOpen(false)
    }
  }, [outOfCredits])

  // Single preview shown as a sublabel on the Email / Meetings nav buttons.
  const previewEmail = emailThreads[0]
  const previewMeeting = meetings[0]
  // Drive the recording indicator off the global recording state — there is only
  // one active recording, so it must show even for ad-hoc recordings or meetings
  // that aren't the upcoming one previewed here.
  const meetingIsRecording = meetingRecordingState === 'recording'
    || meetingRecordingState === 'connecting'
    || meetingRecordingState === 'stopping'
  const meetingIsBusy = meetingRecordingState === 'connecting' || meetingRecordingState === 'stopping'
  // Title of the meeting being recorded, when it's the upcoming one we preview.
  const recordingMeeting = previewMeeting != null && recordingMeetingSource === previewMeeting.source
    ? previewMeeting
    : null

  // Sidebar redesign (2026-10-21): every row is one height. What used to be a
  // grey second line (sender, next meeting, last update) is a count or time at
  // the row's right, with the full line in a tooltip.
  const meetingMeta = previewMeeting ? formatMeetingMeta(previewMeeting, now) : null
  const meetingTip = meetingIsRecording
    ? `Recording · ${recordingMeeting?.summary ?? 'meeting'}`
    : (previewMeeting ? `${previewMeeting.summary} · ${formatMeetingTime(previewMeeting)}` : null)
  const emailTip = previewEmail ? `${formatEmailFrom(previewEmail.from)} · ${previewEmail.subject}` : null
  const bgFailed = bgTaskSummaries.filter((t) => t.lastRunError).length
  const bgActive = bgTaskSummaries.filter((t) => t.active).length

  // The footer's one account row: who you are, your plan, and everything that
  // used to be stacked under the chats (plan card, Connect Accounts, tour,
  // Settings, sync) behind it.
  const planName = billing
    ? (currentBillingPlan?.displayName ?? (billing.subscriptionPlanId ? 'Unknown plan' : 'No plan'))
    : null
  const trialDays = billing?.subscriptionStatus === 'trialing' && billing.trialExpiresAt
    ? Math.max(0, Math.ceil((new Date(billing.trialExpiresAt).getTime() - now) / (1000 * 60 * 60 * 24)))
    : null
  const trialLabel = trialDays === null ? null : trialDays === 0 ? 'Trial ends today' : trialDays === 1 ? '1 day left' : `${trialDays} days left`
  const upgradeLabel = billing && (!billing.subscriptionPlanId || currentBillingPlan?.category === 'free' || currentBillingPlan?.category === 'starter') ? 'Upgrade' : 'Manage'
  const userEmail = billing?.userEmail ?? null
  // Your first name: from the connected Gmail account, else read off the
  // email address ("gagan.p@…" → "Gagan"). The account API has no name.
  const accountName = firstName(gmailName) || nameFromEmail(userEmail) || (isRowboatConnected ? 'Rowboat' : 'Not signed in')
  const accountInitial = accountName === 'Not signed in' ? '?' : accountName.charAt(0).toUpperCase()
  // The pill beside the name: Upgrade on a trial or a free plan, otherwise
  // Manage; red once credits run out.
  const pillLabel = outOfCredits || billing?.subscriptionStatus === 'trialing' ? 'Upgrade' : upgradeLabel
  const pillTip = outOfCredits ? 'Out of credits' : [planName, trialLabel].filter(Boolean).join(' · ')
  const openUpgrade = () => { if (appUrl) window.open(`${appUrl}?intent=upgrade`) }

  return (
    <Sidebar className="rowboat-sidebar border-r-0" {...props}>
      <SidebarHeader className="titlebar-drag-region gap-0 pb-0">
        {/* Clears the traffic lights and the fixed sidebar toggle. */}
        <div className="h-8" />
      </SidebarHeader>
      <SidebarContent ref={contentRef} className="gap-0 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <SidebarGroup className="pb-0 pt-1">
          <SidebarMenu>
            {/* New chat and Search share one row (2026-10-21): the wide button
                is the primary action, search a square beside it. */}
            <SidebarMenuItem className="flex items-center gap-1.5">
              {onNewChat && (
                <SidebarMenuButton className="sb-primary min-w-0 flex-1" onClick={onNewChat}>
                  <SquarePen />
                  <span className="flex-1 truncate">New chat</span>
                  <Keys keys={SHORTCUTS.newChat} className="sb-row-keys" />
                </SidebarMenuButton>
              )}
              {onOpenSearch && (
                <Tooltip delayDuration={400}>
                  <TooltipTrigger asChild>
                    <button type="button" className="sb-square" aria-label="Search" onClick={onOpenSearch}>
                      <Search />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={6} className="flex items-center gap-2">Search <Keys keys={SHORTCUTS.search} tone="dark" /></TooltipContent>
                </Tooltip>
              )}
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className="pb-0 pt-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={activeNav === 'assistant'}
                onClick={() => {
                  if (onOpenAssistant) onOpenAssistant()
                  else if (lastChat && onOpenRun) onOpenRun(lastChat.id)
                  else onNewChat?.()
                }}
              >
                <MascotFaceIcon className="sb-icon" />
                <span className="flex-1 truncate">Assistant</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className="pb-0 pt-0.5">
          <SidebarMenu>
            <SidebarMenuItem>
              <RowTip tip={emailTip}>
                <SidebarMenuButton data-tour-id="nav-email" isActive={activeNav === 'email'} onClick={() => onOpenEmail?.()}>
                  <Mail />
                  <span className="flex-1 truncate">Email</span>
                  {unreadEmailCount > 0 && <span className="sb-count">{unreadEmailCount > 99 ? '99+' : unreadEmailCount}</span>}
                  <Keys keys={SHORTCUTS.email} className="sb-row-keys" />
                </SidebarMenuButton>
              </RowTip>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <RowTip tip={meetingTip}>
                <SidebarMenuButton data-tour-id="nav-meetings" isActive={activeNav === 'meetings'} onClick={onOpenMeetings}>
                  <Mic className={cn(meetingIsRecording && 'text-red-500!')} />
                  <span className="flex-1 truncate">Meetings</span>
                  {meetingIsRecording
                    ? <span className="w-12 shrink-0" aria-hidden="true" />
                    : meetingMeta && <span className="sb-meta">{meetingMeta}</span>}
                  {/* With a meeting coming up, hover shows its buttons instead. */}
                  {!meetingIsRecording && !previewMeeting && <Keys keys={SHORTCUTS.meetings} className="sb-row-keys" />}
                </SidebarMenuButton>
              </RowTip>
              {meetingIsRecording ? (
                <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
                  <span className="relative flex size-2" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-red-500" />
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="Stop recording"
                        disabled={meetingIsBusy}
                        onClick={(e) => { e.stopPropagation(); onToggleMeetingRecording?.() }}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="sb-row-action text-destructive! disabled:opacity-50"
                      >
                        {meetingIsBusy ? <LoaderIcon className="animate-spin" /> : <Square className="size-3! fill-current" />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      {meetingRecordingState === 'connecting' ? 'Starting…' : meetingRecordingState === 'stopping' ? 'Stopping…' : 'Stop recording'}
                    </TooltipContent>
                  </Tooltip>
                </div>
              ) : previewMeeting ? (
                <div className="sb-row-actions">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="Take notes"
                        onClick={(e) => { e.stopPropagation(); triggerMeetingCapture(previewMeeting, false) }}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="sb-row-action"
                      >
                        <Mic />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>Take notes</TooltipContent>
                  </Tooltip>
                  {previewMeeting.conferenceLink && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label="Join & take notes"
                          onClick={(e) => { e.stopPropagation(); triggerMeetingCapture(previewMeeting, true) }}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="sb-row-action"
                        >
                          <Video />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={8}>Join & take notes</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              ) : null}
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton data-tour-id="nav-home" isActive={activeNav === 'home'} onClick={onOpenHome}>
                <ListTodo />
                <span className="flex-1 truncate">Todo</span>
                <Keys keys={SHORTCUTS.todo} className="sb-row-keys" />
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <RowTip tip={knowledgeUpdatedLabel}>
                <SidebarMenuButton data-tour-id="nav-knowledge" isActive={activeNav === 'knowledge'} onClick={() => knowledgeActions.openKnowledgeView()}>
                  <FileText />
                  <span className="flex-1 truncate">Brain</span>
                  <Keys keys={SHORTCUTS.brain} className="sb-row-keys" />
                </SidebarMenuButton>
              </RowTip>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className="pb-0 pt-0.5">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                data-tour-id="nav-workspaces"
                isActive={activeNav === 'workspaces' || activeNav === 'code'}
                onClick={() => knowledgeActions.openWorkspaceAt()}
              >
                <Folder />
                <span className="flex-1 truncate">Projects</span>
                <span className="sb-meta flex items-center gap-2">
                  {hasWorkingProjectSession && (
                    <span role="status" aria-label="Project session working" className="code-working-dot size-2 shrink-0 rounded-full bg-[var(--rowboat-git)]" />
                  )}
                  <UnreadBadge badge={{ unread: unreadProjectCount, forYou: unreadProjectCount }} direct />
                </span>
                <Keys keys={SHORTCUTS.projects} className="sb-row-keys" />
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <RowTip tip={bgAgentsLabel}>
                <SidebarMenuButton data-tour-id="nav-agents" isActive={activeNav === 'agents'} onClick={onOpenBgTasks}>
                  <Bot />
                  <span className="flex-1 truncate">Background agents</span>
                  {bgFailed > 0
                    ? <span className="sb-meta is-alert">{bgFailed} failed</span>
                    : bgActive > 0 && <span className="sb-meta">{bgActive} active</span>}
                  <Keys keys={SHORTCUTS.agents} className="sb-row-keys" />
                </SidebarMenuButton>
              </RowTip>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton data-tour-id="nav-apps" isActive={activeNav === 'apps'} onClick={onOpenApps}>
                <LayoutGrid />
                <span className="flex-1 truncate">Apps</span>
                <Keys keys={SHORTCUTS.apps} className="sb-row-keys" />
              </SidebarMenuButton>
            </SidebarMenuItem>
            {pinnedApps.map(({ folder, name }) => (
              <SidebarMenuItem key={folder}>
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <SidebarMenuButton onClick={() => onOpenApp?.(folder)}>
                      <AppWindow />
                      <span className="flex-1 truncate">{name}</span>
                    </SidebarMenuButton>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => unpinApp(folder)}>
                      <PanelLeftClose className="mr-2 size-3.5" />
                      Remove from sidebar
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {/* Trying Spaces right after Apps (2026-10-21). */}
        {SPACES_ENABLED && (
          <SpacesSidebarSection active={activeNav === 'spaces'} activeSpace={activeSpace}
            onOpenSpace={(orgId, spaceId) => onOpenSpace?.(orgId, spaceId)} onOpenSpaces={onOpenSpaces} />
        )}

        <SidebarSection id="chats" label="Chats" tourId="nav-chats">
          {recentChats.length === 0 ? (
            <p className="px-2.5 py-1.5 text-[12.5px] text-sidebar-foreground/45">
              Your recent chats show up here.
            </p>
          ) : (
            <SidebarMenu>
              {recentChats.map((chat) => {
                const pinned = pinnedChatIds.includes(chat.id)
                const title = chat.title || '(Untitled chat)'
                return (
                  <SidebarMenuItem key={chat.id} className={chatBaseline && !chatBaseline.has(chat.id) ? 'sb-row-in' : undefined}>
                    {renamingChatId === chat.id ? (
                      <div className="flex h-8 items-center gap-2.5 rounded-lg bg-sidebar-accent pl-2.5 pr-1">
                        <span className="size-4 shrink-0" aria-hidden="true" />
                        <input
                          autoFocus
                          aria-label="Chat name"
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              commitChatRename(chat.id)
                            } else if (e.key === 'Escape') {
                              e.preventDefault()
                              setRenamingChatId(null)
                            }
                          }}
                          onBlur={() => commitChatRename(chat.id)}
                          className="h-6 min-w-0 flex-1 rounded-md bg-background px-1.5 text-sm text-sidebar-foreground outline-none ring-1 ring-sidebar-ring/60"
                        />
                      </div>
                    ) : (
                      <>
                        <SidebarChatContextMenu
                          pinned={pinned}
                          onOpen={onOpenRun ? () => onOpenRun(chat.id) : undefined}
                          onTogglePin={() => toggleChatPin(chat.id)}
                          onRename={onRenameRun ? () => { setRenameDraft(chat.title || ''); setRenamingChatId(chat.id) } : undefined}
                          onRequestDelete={onDeleteRun ? () => setDeleteChatTarget({ id: chat.id, title }) : undefined}
                        >
                          <SidebarMenuButton onClick={() => onOpenRun?.(chat.id)}>
                            <span className="sb-icon flex items-center justify-center" aria-hidden="true">
                              {pinned && <Pin className="size-3.5" />}
                            </span>
                            <span className="flex-1 truncate">{title}</span>
                          </SidebarMenuButton>
                        </SidebarChatContextMenu>
                        {onRenameRun && (
                          <div className="sb-row-actions">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  aria-label="Chat options"
                                  onClick={(e) => e.stopPropagation()}
                                  className="sb-row-action"
                                >
                                  <MoreHorizontal />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent side="right" align="start" sideOffset={6}>
                                <DropdownMenuItem onClick={() => toggleChatPin(chat.id)}>
                                  <Pin className="mr-2 size-3.5" />
                                  {pinned ? 'Unpin' : 'Pin'}
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
                                {onDeleteRun && (
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => setDeleteChatTarget({ id: chat.id, title })}
                                  >
                                    <Trash2 className="mr-2 size-3.5" />
                                    Delete
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        )}
                      </>
                    )}
                  </SidebarMenuItem>
                )
              })}
              {onOpenChatHistory && (
                <SidebarMenuItem>
                  <SidebarMenuButton className="sb-quiet" onClick={() => onOpenChatHistory()}>
                    <span className="sb-icon" aria-hidden="true" />
                    <span className="flex-1 truncate">View all</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          )}
        </SidebarSection>
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
      </SidebarContent>
      {/* First-time-action credit rewards (feature-flagged, signed-in only) */}
      <SidebarCreditRewards
        onOpenEmail={onOpenEmail}
        onOpenMeetings={onOpenMeetings}
        onOpenAgents={onOpenBgTasks}
        onOpenApps={onOpenApps}
        onConnectAccounts={() => setConnectionsSettingsOpen(true)}
      />
      <SidebarFooter className="gap-0 px-2 pb-2 pt-1">
        {/* The out-of-credits notice anchors to the account row and opens by
            itself once per episode, as the plan card's did. */}
        <Popover open={creditPopoverOpen && outOfCredits && !sidebarCollapsed} onOpenChange={setCreditPopoverOpen}>
          <PopoverAnchor asChild>
            <div className="sb-account-bar">
              {/* Name and plan pill share one hover surface (2026-10-21). */}
              <div className="sb-account-group">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="sb-account" aria-label={`${accountName}: account and settings`}>
                    <span className="sb-avatar" aria-hidden="true">
                      {accountInitial}
                      {(outOfCredits || hasOauthError) && <span className={cn('sb-avatar-flag', outOfCredits && 'is-alert')} />}
                    </span>
                    <span className="sb-account-name">{accountName}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="top"
                  align="start"
                  sideOffset={8}
                  className="sb-menu w-[248px] rounded-xl p-1.5"
                >
                  <div className="flex items-center gap-2.5 px-2 pb-2 pt-1.5">
                    <span className="sb-avatar size-8! text-[13px]!" aria-hidden="true">{accountInitial}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold">{accountName}</div>
                      <div className="truncate text-[11.5px] text-muted-foreground">{userEmail ?? 'Not signed in'}</div>
                    </div>
                  </div>
                  {isRowboatConnected ? (
                    billing && (
                      <div className="mb-1 flex items-center gap-3 rounded-lg bg-foreground/[0.04] px-2.5 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium capitalize">{planName}</div>
                          <div className={cn('truncate text-[11.5px]', outOfCredits ? 'text-destructive' : 'text-muted-foreground')}>
                            {outOfCredits ? 'Out of credits' : (trialLabel ?? 'Current plan')}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={openUpgrade}
                          className="h-7 shrink-0 rounded-md bg-foreground/[0.08] px-2.5 text-xs font-medium transition-colors hover:bg-foreground/[0.14]"
                        >
                          {upgradeLabel}
                        </button>
                      </div>
                    )
                  ) : (
                    <button
                      type="button"
                      onClick={handleRowboatLogin}
                      disabled={loggingIn}
                      className="mb-1 flex h-9 w-full items-center justify-center rounded-lg bg-foreground text-[13px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {loggingIn ? 'Signing in…' : 'Sign in to Rowboat'}
                    </button>
                  )}
                  <DropdownMenuItem onSelect={() => setConnectionsSettingsOpen(true)}>
                    <Plug />
                    Connect accounts
                    {hasOauthError && <AlertTriangle className="ml-auto text-amber-500" aria-label="Needs attention" />}
                  </DropdownMenuItem>
                  {onStartTour && (
                    <DropdownMenuItem onSelect={onStartTour}>
                      <MascotFaceIcon className="size-4" />
                      Take a tour
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                    <Settings />
                    Settings
                    <Keys keys={SHORTCUTS.settings} className="ml-auto" />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {!isRowboatConnected ? (
                <button type="button" className="sb-plan-pill" onClick={handleRowboatLogin} disabled={loggingIn}>
                  {loggingIn ? 'Signing in…' : 'Sign in'}
                </button>
              ) : billing && (
                <Tooltip delayDuration={400}>
                  <TooltipTrigger asChild>
                    <button type="button" className={cn('sb-plan-pill', outOfCredits && 'is-alert')} onClick={openUpgrade}>
                      {pillLabel}
                    </button>
                  </TooltipTrigger>
                  {pillTip && <TooltipContent side="top" sideOffset={6}>{pillTip}</TooltipContent>}
                </Tooltip>
              )}
              </div>
              <span className="flex-1" aria-hidden="true" />
              <SyncStatusBar />
            </div>
          </PopoverAnchor>
          <PopoverContent side="top" align="start" sideOffset={10} className="w-72">
            <PopoverArrow className="fill-popover" />
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
      </SidebarFooter>
      {hasOauthError && (
        <AlertDialog open={showOauthAlert} onOpenChange={setShowOauthAlert}>
          <AlertDialogContent
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              if (openConnectionsAfterClose) {
                setOpenConnectionsAfterClose(false)
                setConnectionsSettingsOpen(true)
              }
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Reconnect your accounts</AlertDialogTitle>
              <AlertDialogDescription>
                One or more connected accounts need attention. Open Connected accounts
                to review the status and reconnect if needed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => {
                  setOpenConnectionsAfterClose(false)
                  setShowOauthAlert(false)
                }}
              >
                Dismiss
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setOpenConnectionsAfterClose(true)
                  setShowOauthAlert(false)
                }}
              >
                View connected accounts
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <SettingsDialog
        defaultTab="connections"
        open={connectionsSettingsOpen}
        onOpenChange={setConnectionsSettingsOpen}
      />
      <SidebarRail />
    </Sidebar>
  )
}

/** A row's full detail (sender, next meeting, last update) after a short hover. */
function RowTip({ tip, children }: { tip: string | null | undefined; children: React.ReactElement }) {
  if (!tip) return children
  return (
    <Tooltip delayDuration={700}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} className="max-w-72 truncate">{tip}</TooltipContent>
    </Tooltip>
  )
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

/** The short time at the Meetings row's right: "Now", "in 12m", or the clock time. */
function formatMeetingMeta(event: UpcomingMeeting, now: number): string {
  if (event.isAllDay) return 'All day'
  const minutes = Math.round((event.start.getTime() - now) / 60000)
  if (minutes <= 0) return 'Now'
  if (minutes < 60) return `in ${minutes}m`
  return formatMeetingTime(event)
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

type SidebarEmailThread = {
  threadId: string
  subject: string
  from: string
  date: string
}

function firstName(name: string): string {
  return name.trim().replace(/^["']|["']$/g, '').split(/\s+/)[0] ?? ''
}

function nameFromEmail(email: string | null): string {
  const first = email?.split('@')[0]?.split(/[._+-]/)[0] ?? ''
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : ''
}

function formatEmailFrom(from: string): string {
  const match = /^\s*"?([^"<]+?)"?\s*<.+>\s*$/.exec(from)
  if (match) return match[1].trim()
  return from
}
