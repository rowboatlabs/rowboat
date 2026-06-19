"use client"

import * as React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowUpRight,
  Bot,
  ChevronRight,
  Code2,
  FileText,
  FilePlus,
  Folder,
  Globe,
  AlertTriangle,
  Home,
  Mic,
  SquarePen,
  Plug,
  LoaderIcon,
  Mail,
  MessageSquare,
  Settings,
  Square,
  Video,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
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
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { SettingsDialog } from "@/components/settings-dialog"
import { extractConferenceLink } from "@/lib/calendar-event"
import { useBilling } from "@/hooks/useBilling"
import { toast } from "@/lib/toast"
import { getBillingPlanData } from "@x/shared/dist/billing.js"
import { ServiceEvent } from "@x/shared/src/service-events.js"
import z from "zod"

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

const SERVICE_LABELS: Record<string, string> = {
  gmail: "Syncing Gmail",
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
  onOpenAgent?: (slug: string) => void
  recentRuns?: { id: string; title?: string; createdAt: string; modifiedAt?: string }[]
  onOpenRun?: (runId: string) => void
  onOpenChatHistory?: () => void
  onOpenEmail?: (threadId?: string) => void
  onOpenHome?: () => void
  onNewChat?: () => void
  onToggleBrowser?: () => void
  onVoiceNoteCreated?: (path: string) => void
  /** Which primary destination is currently active, for nav highlighting. */
  activeNav?: 'home' | 'email' | 'meetings' | 'code' | 'knowledge' | 'agents' | 'workspaces' | null
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
      <SidebarFooter className="border-t border-sidebar-border px-2 py-2">
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1 text-xs hover:bg-sidebar-accent",
                hasServiceErrors && !isSyncing ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
              )}
            >
              <span className="flex items-center gap-2 min-w-0">
                {isSyncing ? (
                  <LoaderIcon className="h-3 w-3 shrink-0 animate-spin" />
                ) : hasServiceErrors ? (
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                ) : (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
                )}
                <span className="truncate">{statusLabel}</span>
              </span>
              <ChevronRight className="h-3 w-3 shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="end"
            sideOffset={4}
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
      </SidebarFooter>
    </>
  )
}

export function SidebarContentPanel({
  tree,
  knowledgeActions,
  bgTaskSummaries = [],
  onOpenMeetings,
  onOpenCode,
  onOpenBgTasks,
  recentRuns = [],
  onOpenRun,
  onOpenChatHistory,
  onOpenEmail,
  onOpenHome,
  onNewChat,
  onToggleBrowser,
  onVoiceNoteCreated,
  activeNav,
  meetingRecordingState = 'idle',
  recordingMeetingSource = null,
  onToggleMeetingRecording,
  ...props
}: SidebarContentPanelProps) {
  const [hasOauthError, setHasOauthError] = useState(false)
  const [showOauthAlert, setShowOauthAlert] = useState(true)
  const [connectionsSettingsOpen, setConnectionsSettingsOpen] = useState(false)
  const [openConnectionsAfterClose, setOpenConnectionsAfterClose] = useState(false)
  const connectorsButtonRef = useRef<HTMLButtonElement | null>(null)
  const [isRowboatConnected, setIsRowboatConnected] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const [appUrl, setAppUrl] = useState<string | null>(null)
  const { billing } = useBilling(isRowboatConnected)
  const currentBillingPlan = billing ? getBillingPlanData(billing.catalog, billing.subscriptionPlanId) : null

  // Nav previews: unread important emails + next upcoming meetings (top 2 each).
  const [unreadEmailCount, setUnreadEmailCount] = useState(0)
  const [emailThreads, setEmailThreads] = useState<SidebarEmailThread[]>([])
  const [meetings, setMeetings] = useState<UpcomingMeeting[]>([])
  const [chatsExpanded, setChatsExpanded] = useState(true)
  // The Code section only makes sense with a coding agent available — same
  // flag the chat composer's code chip uses (auto-on when Claude Code or
  // Codex is installed + signed in; explicit toggle in settings wins).
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

  // Chats: the 5 most recently modified chats, newest first.
  const recentChats = React.useMemo(() => {
    const chatRecency = (r: { createdAt: string; modifiedAt?: string }) => {
      const ms = new Date(r.modifiedAt ?? r.createdAt).getTime()
      return Number.isFinite(ms) ? ms : 0
    }
    return [...recentRuns]
      .sort((a, b) => chatRecency(b) - chatRecency(a))
      .slice(0, 10)
  }, [recentRuns])

  // Workspace count for the Workspaces sublabel — top-level dir children of
  // knowledge/Workspace (matches WorkspaceView's root listing).
  const workspaceCount = React.useMemo(() => {
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
        if (connected && mounted) {
          try {
            const account = await window.ipc.invoke('account:getRowboat', null)
            if (mounted) setAppUrl(account.config?.appUrl ?? null)
          } catch { /* ignore */ }
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
  const meetingSublabel = meetingIsRecording
    ? (recordingMeeting?.summary ?? 'Recording…')
    : (previewMeeting ? `${previewMeeting.summary} · ${formatMeetingTime(previewMeeting)}` : null)

  return (
    <Sidebar className="rowboat-sidebar border-r-0" {...props}>
      <SidebarHeader className="titlebar-drag-region">
        {/* Top spacer to clear the traffic lights + fixed toggle row */}
        <div className="h-8" />
        {/* Quick actions */}
        <div className="titlebar-no-drag flex items-center gap-1.5 px-3 pb-2">
          {onNewChat && (
            <ActionButton icon={SquarePen} label="New chat" onClick={onNewChat} />
          )}
          <ActionButton icon={FilePlus} label="New note" onClick={() => knowledgeActions.createNote()} />
          <VoiceNoteButton onNoteCreated={onVoiceNoteCreated} variant="action" />
          {onToggleBrowser && (
            <ActionButton icon={Globe} label="Run browser task" onClick={onToggleBrowser} />
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {/* Primary navigation */}
        <SidebarGroup className="flex flex-col">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={activeNav === 'home'} onClick={onOpenHome}>
                  <Home className="size-4 shrink-0" />
                  <span className="flex-1 truncate">Home</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeNav === 'email'}
                  onClick={() => onOpenEmail?.()}
                  className={previewEmail ? 'h-auto py-1.5' : undefined}
                >
                  <Mail className="size-4 shrink-0" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">Email</span>
                    {previewEmail && (
                      <span className="truncate text-[11px] text-muted-foreground">
                        {formatEmailFrom(previewEmail.from)} · {previewEmail.subject}
                      </span>
                    )}
                  </div>
                  {unreadEmailCount > 0 && (
                    <span className="shrink-0 self-center rounded-full bg-sidebar-accent px-1.5 text-[10px] font-medium text-sidebar-accent-foreground tabular-nums">
                      {unreadEmailCount}
                    </span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeNav === 'meetings'}
                  onClick={onOpenMeetings}
                  className={meetingSublabel ? 'h-auto py-1.5' : undefined}
                >
                  <Mic className={cn('size-4 shrink-0', meetingIsRecording && 'text-red-500')} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">Meetings</span>
                    {meetingSublabel && (
                      <span className={cn(
                        'truncate text-[11px]',
                        meetingIsRecording ? 'text-red-500' : 'text-muted-foreground',
                      )}>
                        {meetingSublabel}
                      </span>
                    )}
                  </div>
                </SidebarMenuButton>
                {meetingIsRecording ? (
                  <div className="absolute inset-y-0 right-1 flex items-center gap-1.5">
                    <span className="relative flex size-2">
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
                          className="flex aspect-square w-5 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 disabled:opacity-50"
                        >
                          {meetingIsBusy ? <LoaderIcon className="size-4 animate-spin" /> : <Square className="size-3.5 fill-current" />}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        {meetingRecordingState === 'connecting' ? 'Starting…' : meetingRecordingState === 'stopping' ? 'Stopping…' : 'Stop recording'}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                ) : previewMeeting ? (
                  <div className="absolute inset-y-0 right-1 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label="Take notes"
                          onClick={(e) => { e.stopPropagation(); triggerMeetingCapture(previewMeeting, false) }}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="flex aspect-square w-5 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        >
                          <Mic className="size-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Take notes</TooltipContent>
                    </Tooltip>
                    {previewMeeting.conferenceLink && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label="Join & take notes"
                            onClick={(e) => { e.stopPropagation(); triggerMeetingCapture(previewMeeting, true) }}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="flex aspect-square w-5 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                          >
                            <Video className="size-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Join & take notes</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                ) : null}
              </SidebarMenuItem>
              {codeModeEnabled && (
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={activeNav === 'code'} onClick={onOpenCode}>
                    <Code2 className="size-4 shrink-0" />
                    <span className="flex-1 truncate">Code</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeNav === 'knowledge'}
                  onClick={() => knowledgeActions.openKnowledgeView()}
                  className={knowledgeUpdatedLabel ? 'h-auto py-1.5' : undefined}
                >
                  <FileText className="size-4 shrink-0" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">Brain</span>
                    {knowledgeUpdatedLabel && (
                      <span className="truncate text-[11px] text-muted-foreground">{knowledgeUpdatedLabel}</span>
                    )}
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>

            <div className="mx-3 my-2 border-t border-sidebar-border" />

            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeNav === 'agents'}
                  onClick={onOpenBgTasks}
                  className={bgAgentsLabel ? 'h-auto py-1.5' : undefined}
                >
                  <Bot className="size-4 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-muted-foreground">Background agents</span>
                    {bgAgentsLabel && (
                      <span className={cn(
                        'truncate text-[11px]',
                        bgTaskSummaries.some((t) => t.lastRunError) ? 'text-destructive' : 'text-muted-foreground',
                      )}>
                        {bgAgentsLabel}
                      </span>
                    )}
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeNav === 'workspaces'}
                  onClick={() => knowledgeActions.openWorkspaceAt()}
                  className="h-auto py-1.5"
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-muted-foreground">Workspaces</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {workspaceCount === 0 ? 'No workspaces' : `${workspaceCount} workspace${workspaceCount === 1 ? '' : 's'}`}
                    </span>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <div className="mx-3 border-t border-sidebar-border" />

        {/* Chats */}
        <SidebarGroup className="flex flex-col">
          <SidebarGroupContent>
            <button
              type="button"
              onClick={() => setChatsExpanded((v) => !v)}
              className="flex w-full items-center gap-1.5 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              <ChevronRight className={cn('size-3 transition-transform', chatsExpanded && 'rotate-90')} />
              <span className="flex-1 text-left">Chats</span>
            </button>
            {chatsExpanded && (
              recentChats.length === 0 ? (
                <div className="px-4 pb-2 text-[11.5px] italic text-muted-foreground">
                  Your recent chats show up here.
                </div>
              ) : (
                <SidebarMenu>
                  {recentChats.map((chat) => (
                    <SidebarMenuItem key={chat.id}>
                      <SidebarMenuButton onClick={() => onOpenRun?.(chat.id)}>
                        <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">{chat.title || '(Untitled chat)'}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                  {onOpenChatHistory && (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        onClick={() => onOpenChatHistory()}
                        className="text-muted-foreground"
                      >
                        <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">View all</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                </SidebarMenu>
              )
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {/* Billing / upgrade CTA or Log in CTA */}
      {isRowboatConnected && billing ? (
        <div className="px-3 py-2">
          <div className="flex items-center justify-between rounded-lg border border-sidebar-border bg-sidebar-accent/20 px-3 py-2">
            <div className="min-w-0">
              <span className="text-xs font-medium capitalize text-sidebar-foreground">
                {currentBillingPlan?.displayName ?? (billing.subscriptionPlanId ? 'Unknown' : 'No plan')}
              </span>
              {billing.subscriptionStatus === 'trialing' && billing.trialExpiresAt && (() => {
                const days = Math.max(0, Math.ceil((new Date(billing.trialExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
                return (
                  <p className="text-[10px] text-sidebar-foreground/60">
                    {days === 0 ? 'Trial expires today' : days === 1 ? '1 day left' : `${days} days left`}
                  </p>
                )
              })()}
            </div>
            <button
              onClick={() => appUrl && window.open(`${appUrl}?intent=upgrade`)}
              className="shrink-0 rounded-md bg-sidebar-foreground/10 px-2.5 py-1 text-[11px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-foreground/20"
            >
              {!billing.subscriptionPlanId || currentBillingPlan?.category === 'free' || currentBillingPlan?.category === 'starter' ? 'Upgrade' : 'Manage'}
            </button>
          </div>
        </div>
      ) : null}
      {/* Sign in CTA */}
      {!isRowboatConnected && (
        <div className="px-3 py-2">
          <button
            onClick={handleRowboatLogin}
            disabled={loggingIn}
            className="flex w-full items-center justify-center rounded-lg border border-sidebar-border bg-sidebar-accent/20 px-3 py-2.5 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent/40 disabled:opacity-50"
          >
            {loggingIn ? 'Signing in…' : 'Sign in to Rowboat'}
          </button>
        </div>
      )}
      {/* Bottom actions */}
      <div className="border-t border-sidebar-border px-2 py-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <button
              ref={connectorsButtonRef}
              onClick={() => setConnectionsSettingsOpen(true)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              <Plug className="size-4" />
              <span>Connect Accounts</span>
            </button>
            {hasOauthError && (
              <AlertDialog
                open={showOauthAlert}
                onOpenChange={setShowOauthAlert}
              >
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center"
                    aria-label="OAuth connection issues"
                  >
                    <AlertTriangle className="size-3 text-amber-500/90 animate-pulse" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent
                  onCloseAutoFocus={(event) => {
                    event.preventDefault()
                    if (openConnectionsAfterClose) {
                      setOpenConnectionsAfterClose(false)
                      setConnectionsSettingsOpen(true)
                    }
                    connectorsButtonRef.current?.focus()
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
          </div>
          <SettingsDialog>
            <button className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors">
              <Settings className="size-4" />
              <span>Settings</span>
            </button>
          </SettingsDialog>
        </div>
      </div>
      <SettingsDialog
        defaultTab="connections"
        open={connectionsSettingsOpen}
        onOpenChange={setConnectionsSettingsOpen}
      />
      <SyncStatusBar />
      <SidebarRail />
    </Sidebar>
  )
}

async function transcribeWithDeepgram(audioBlob: Blob): Promise<string | null> {
  try {
    const configResult = await window.ipc.invoke('workspace:readFile', {
      path: 'config/deepgram.json',
      encoding: 'utf8',
    })
    const { apiKey } = JSON.parse(configResult.data) as { apiKey: string }
    if (!apiKey) throw new Error('No apiKey in deepgram.json')

    const response = await fetch(
      'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true',
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': audioBlob.type,
        },
        body: audioBlob,
      },
    )

    if (!response.ok) throw new Error(`Deepgram API error: ${response.status}`)
    const result = await response.json()
    return result.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? null
  } catch (err) {
    console.error('Deepgram transcription failed:', err)
    return null
  }
}

// Voice Note Recording Button
export function VoiceNoteButton({ onNoteCreated, variant = 'icon' }: { onNoteCreated?: (path: string) => void; variant?: 'icon' | 'action' }) {
  const [isRecording, setIsRecording] = React.useState(false)
  const [hasDeepgramKey, setHasDeepgramKey] = React.useState(false)
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null)
  const chunksRef = React.useRef<Blob[]>([])
  const notePathRef = React.useRef<string | null>(null)
  const timestampRef = React.useRef<string | null>(null)
  const relativePathRef = React.useRef<string | null>(null)
  // Keep a ref to always call the latest onNoteCreated (avoids stale closure in recorder.onstop)
  const onNoteCreatedRef = React.useRef(onNoteCreated)
  React.useEffect(() => { onNoteCreatedRef.current = onNoteCreated }, [onNoteCreated])

  React.useEffect(() => {
    window.ipc.invoke('workspace:readFile', {
      path: 'config/deepgram.json',
      encoding: 'utf8',
    }).then((result: { data: string }) => {
      const { apiKey } = JSON.parse(result.data) as { apiKey: string }
      setHasDeepgramKey(!!apiKey)
    }).catch(() => {
      setHasDeepgramKey(false)
    })
  }, [])

  const startRecording = async () => {
    try {
      // Generate timestamp and paths immediately
      const now = new Date()
      const timestamp = now.toISOString().replace(/[:.]/g, '-')
      const dateStr = now.toISOString().split('T')[0] // YYYY-MM-DD
      const noteName = `voice-memo-${timestamp}`
      const notePath = `knowledge/Voice Memos/${dateStr}/${noteName}.md`

      timestampRef.current = timestamp
      notePathRef.current = notePath
      // Relative path for linking (from knowledge/ root, without .md extension)
      const relativePath = `Voice Memos/${dateStr}/${noteName}`
      relativePathRef.current = relativePath

      // Create the note immediately with a "Recording..." placeholder
      await window.ipc.invoke('workspace:mkdir', {
        path: `knowledge/Voice Memos/${dateStr}`,
        recursive: true,
      })

      const initialContent = `---
type: voice memo
recorded: "${now.toISOString()}"
path: ${relativePath}
---
# Voice Memo

## Transcript

*Recording in progress...*
`
      await window.ipc.invoke('workspace:writeFile', {
        path: notePath,
        data: initialContent,
        opts: { encoding: 'utf8' },
      })

      // Select the note so the user can see it
      onNoteCreatedRef.current?.(notePath)

      // Start actual recording
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: mimeType })
        const ext = mimeType === 'audio/mp4' ? 'm4a' : 'webm'
        const audioFilename = `voice-memo-${timestampRef.current}.${ext}`

        // Save audio file to voice_memos folder (for backup/reference)
        try {
          await window.ipc.invoke('workspace:mkdir', {
            path: 'voice_memos',
            recursive: true,
          })

          const arrayBuffer = await blob.arrayBuffer()
          const base64 = btoa(
            new Uint8Array(arrayBuffer).reduce(
              (data, byte) => data + String.fromCharCode(byte),
              '',
            ),
          )

          await window.ipc.invoke('workspace:writeFile', {
            path: `voice_memos/${audioFilename}`,
            data: base64,
            opts: { encoding: 'base64' },
          })
        } catch {
          console.error('Failed to save audio file')
        }

        // Update note to show transcribing status
        const currentNotePath = notePathRef.current
        const currentRelativePath = relativePathRef.current
        if (currentNotePath && currentRelativePath) {
          const transcribingContent = `---
type: voice memo
recorded: "${new Date().toISOString()}"
path: ${currentRelativePath}
---
# Voice Memo

## Transcript

*Transcribing...*
`
          await window.ipc.invoke('workspace:writeFile', {
            path: currentNotePath,
            data: transcribingContent,
            opts: { encoding: 'utf8' },
          })
        }

        // Transcribe and update the note with the transcript
        const transcript = await transcribeWithDeepgram(blob)
        if (currentNotePath && currentRelativePath) {
          const finalContent = transcript
            ? `---
type: voice memo
recorded: "${new Date().toISOString()}"
path: ${currentRelativePath}
---
# Voice Memo

## Transcript

${transcript}
`
            : `---
type: voice memo
recorded: "${new Date().toISOString()}"
path: ${currentRelativePath}
---
# Voice Memo

## Transcript

*Transcription failed. Please try again.*
`
          await window.ipc.invoke('workspace:writeFile', {
            path: currentNotePath,
            data: finalContent,
            opts: { encoding: 'utf8' },
          })

          // Re-select to trigger refresh
          onNoteCreatedRef.current?.(currentNotePath)

          if (transcript) {
            toast('Voice note transcribed', 'success')
          } else {
            toast('Transcription failed', 'error')
          }
        }
      }

      recorder.start()
      mediaRecorderRef.current = recorder
      setIsRecording(true)
      toast('Recording started', 'success')
    } catch {
      toast('Could not access microphone', 'error')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    mediaRecorderRef.current = null
    setIsRecording(false)
  }

  if (!hasDeepgramKey) return null

  const actionClass = "flex h-9 flex-1 items-center justify-center rounded-md border border-sidebar-border text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
  const iconClass = "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded p-1.5 transition-colors"

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={isRecording ? stopRecording : startRecording}
          className={variant === 'action' ? actionClass : iconClass}
          aria-label={isRecording ? 'Stop recording' : 'New voice note'}
        >
          {isRecording ? (
            <Square className="size-4 fill-red-500 text-red-500 animate-pulse" />
          ) : (
            <Mic className="size-4" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isRecording ? 'Stop Recording' : 'New Voice Note'}
      </TooltipContent>
    </Tooltip>
  )
}

function ActionButton({ icon: Icon, label, onClick }: { icon: typeof Mic; label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="flex h-9 flex-1 items-center justify-center rounded-md border border-sidebar-border text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <Icon className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
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

function formatEmailFrom(from: string): string {
  const match = /^\s*"?([^"<]+?)"?\s*<.+>\s*$/.exec(from)
  if (match) return match[1].trim()
  return from
}
