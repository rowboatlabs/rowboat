"use client"

import * as React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  Bot,
  ArrowUpRight,
  ChevronRight,
  ExternalLink,
  FileText,
  FilePlus,
  Folder,
  FolderPlus,
  Globe,
  AlertTriangle,
  HelpCircle,
  Mic,
  Plug,
  Lightbulb,
  LoaderIcon,
  Mail,
  Settings,
  Square,
  Trash2,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Button } from "@/components/ui/button"
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import { ConnectorsPopover } from "@/components/connectors-popover"
import { HelpPopover } from "@/components/help-popover"
import { SettingsDialog } from "@/components/settings-dialog"
import { toast } from "@/lib/toast"
import { formatRelativeTime as formatRunTime } from "@/lib/relative-time"
import { useBilling } from "@/hooks/useBilling"
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

function displayNoteName(node: TreeNode): string {
  if (node.kind === 'file' && node.name.toLowerCase().endsWith('.md')) {
    return node.name.slice(0, -3)
  }
  return node.name
}

type RunListItem = {
  id: string
  title?: string
  createdAt: string
  agentId: string
}

type TaskSummary = {
  slug: string
  name: string
  active: boolean
  createdAt: string
  lastAttemptAt?: string
  lastRunAt?: string
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

type TasksActions = {
  onNewChat: () => void
  onSelectRun: (runId: string) => void
  onDeleteRun: (runId: string) => void
  onOpenInNewTab?: (runId: string) => void
  onSelectBackgroundTask?: (taskName: string) => void
  onOpenChatHistoryView?: () => void
}

type SidebarContentPanelProps = {
  tree: TreeNode[]
  selectedPath: string | null
  onSelectFile: (path: string, kind: "file" | "dir") => void
  knowledgeActions: KnowledgeActions
  runs?: RunListItem[]
  currentRunId?: string | null
  processingRunIds?: Set<string>
  tasksActions?: TasksActions
  bgTaskSummaries?: TaskSummary[]
  onOpenBgTask?: (slug: string) => void
  isSearchOpen?: boolean
  isBrowserOpen?: boolean
  onToggleBrowser?: () => void
  isSuggestedTopicsOpen?: boolean
  onOpenSuggestedTopics?: () => void
  isMeetingsOpen?: boolean
  onOpenMeetings?: () => void
  onOpenBgTasks?: () => void
  isEmailOpen?: boolean
  onOpenEmail?: () => void
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
  selectedPath,
  onSelectFile,
  knowledgeActions,
  runs = [],
  currentRunId,
  processingRunIds,
  tasksActions,
  bgTaskSummaries = [],
  onOpenBgTask,
  isSearchOpen = false,
  isBrowserOpen = false,
  onToggleBrowser,
  isSuggestedTopicsOpen = false,
  onOpenSuggestedTopics,
  isMeetingsOpen = false,
  onOpenMeetings,
  onOpenBgTasks,
  isEmailOpen = false,
  onOpenEmail,
  ...props
}: SidebarContentPanelProps) {
  const [hasOauthError, setHasOauthError] = useState(false)
  const [showOauthAlert, setShowOauthAlert] = useState(true)
  const [connectorsOpen, setConnectorsOpen] = useState(false)
  const [openConnectorsAfterClose, setOpenConnectorsAfterClose] = useState(false)
  const connectorsButtonRef = useRef<HTMLButtonElement | null>(null)
  const [isRowboatConnected, setIsRowboatConnected] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const [appUrl, setAppUrl] = useState<string | null>(null)
  const { billing } = useBilling(isRowboatConnected)
  const isBrowserQuickActionSelected = isBrowserOpen && !isSearchOpen
  const isSuggestedTopicsQuickActionSelected = isSuggestedTopicsOpen && !isBrowserOpen
  const isMeetingsQuickActionSelected = isMeetingsOpen && !isBrowserOpen
  const isEmailQuickActionSelected = isEmailOpen && !isBrowserOpen

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

  return (
    <Sidebar className="rowboat-sidebar border-r-0" {...props}>
      <SidebarHeader className="titlebar-drag-region">
        {/* Top spacer to clear the traffic lights + fixed toggle row */}
        <div className="h-8" />
        {/* Quick action buttons */}
        <div className="rowboat-quick-actions titlebar-no-drag flex flex-col gap-0.5 px-2 pb-1">
          {onOpenEmail && (
            <button
              type="button"
              onClick={onOpenEmail}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                isEmailQuickActionSelected
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Mail className="size-4" />
              <span>Email</span>
            </button>
          )}
          {onOpenMeetings && (
            <button
              type="button"
              onClick={onOpenMeetings}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                isMeetingsQuickActionSelected
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Mic className="size-4" />
              <span>Meetings</span>
            </button>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <TasksSidebarSection
          tasks={bgTaskSummaries}
          onOpenTask={onOpenBgTask}
          onOpenTasksView={onOpenBgTasks}
        />
        <KnowledgeSection
          tree={tree}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
          actions={knowledgeActions}
        />
        <WorkspaceSection tree={tree} actions={knowledgeActions} />
        <TasksSection
          runs={runs}
          currentRunId={currentRunId}
          processingRunIds={processingRunIds}
          actions={tasksActions}
        />
      </SidebarContent>
      {/* Billing / upgrade CTA or Log in CTA */}
      {isRowboatConnected && billing ? (
        <div className="px-3 py-2">
          <div className="flex items-center justify-between rounded-lg border border-sidebar-border bg-sidebar-accent/20 px-3 py-2">
            <div className="min-w-0">
              <span className="text-xs font-medium capitalize text-sidebar-foreground">
                {billing.subscriptionPlan ? `${billing.subscriptionPlan} plan` : 'No plan'}
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
              {!billing.subscriptionPlan || billing.subscriptionPlan === 'free' || billing.subscriptionPlan === 'starter' ? 'Upgrade' : 'Manage'}
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
      {/* Secondary quick actions (above bottom divider) */}
      {(onToggleBrowser || onOpenSuggestedTopics) && (
        <div className="px-2 pb-1">
          <div className="flex flex-col gap-0.5">
            {onToggleBrowser && (
              <button
                type="button"
                onClick={onToggleBrowser}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors",
                  isBrowserQuickActionSelected
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <Globe className="size-4" />
                <span>Run browser task</span>
              </button>
            )}
            {onOpenSuggestedTopics && (
              <button
                type="button"
                onClick={onOpenSuggestedTopics}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors",
                  isSuggestedTopicsQuickActionSelected
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <Lightbulb className="size-4" />
                <span>Suggested Topics</span>
              </button>
            )}
          </div>
        </div>
      )}
      {/* Bottom actions */}
      <div className="border-t border-sidebar-border px-2 py-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <ConnectorsPopover open={connectorsOpen} onOpenChange={setConnectorsOpen} mode="unconnected">
              <button
                ref={connectorsButtonRef}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
              >
                <Plug className="size-4" />
                <span>Connect Accounts</span>
              </button>
            </ConnectorsPopover>
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
                    if (openConnectorsAfterClose) {
                      setOpenConnectorsAfterClose(false)
                      setConnectorsOpen(true)
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
                        setOpenConnectorsAfterClose(false)
                        setShowOauthAlert(false)
                      }}
                    >
                      Dismiss
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        setOpenConnectorsAfterClose(true)
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
          <HelpPopover>
            <button className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors">
              <HelpCircle className="size-4" />
              <span>Help</span>
            </button>
          </HelpPopover>
        </div>
      </div>
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
export function VoiceNoteButton({ onNoteCreated }: { onNoteCreated?: (path: string) => void }) {
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

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={isRecording ? stopRecording : startRecording}
          className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded p-1.5 transition-colors"
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

// Knowledge Section
function KnowledgeSection({
  tree,
  selectedPath,
  onSelectFile,
  actions,
}: {
  tree: TreeNode[]
  selectedPath: string | null
  onSelectFile: (path: string, kind: "file" | "dir") => void
  actions: KnowledgeActions
}) {
  const visibleTree = React.useMemo(
    () => tree.filter((item) => item.path !== 'knowledge/Meetings' && item.path !== 'knowledge/Workspace'),
    [tree],
  )
  const recentNotes = React.useMemo<TreeNode[]>(() => {
    const out: TreeNode[] = []
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.kind === 'file') out.push(n)
        else if (n.children?.length) walk(n.children)
      }
    }
    walk(visibleTree)
    return out
      .filter((n) => n.stat?.mtimeMs !== undefined)
      .sort((a, b) => (b.stat?.mtimeMs ?? 0) - (a.stat?.mtimeMs ?? 0))
      .slice(0, 3)
  }, [visibleTree])

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <SidebarGroup className="flex flex-col">
          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
            Knowledge
          </div>
          <SidebarGroupContent>
            <SidebarMenu>
              {recentNotes.map((note) => (
                <SidebarMenuItem key={note.path}>
                  <SidebarMenuButton
                    isActive={selectedPath === note.path}
                    onClick={() => onSelectFile(note.path, 'file')}
                  >
                    <FileText className="size-4 shrink-0" />
                    <span className="truncate">{displayNoteName(note)}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => actions.openKnowledgeView()}>
                  <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">View all</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={() => actions.createNote()}>
          <FilePlus className="mr-2 size-4" />
          New Note
        </ContextMenuItem>
        <ContextMenuItem onClick={() => void actions.createFolder()}>
          <FolderPlus className="mr-2 size-4" />
          New Folder
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function WorkspaceSection({
  tree,
  actions,
}: {
  tree: TreeNode[]
  actions: KnowledgeActions
}) {
  const recentWorkspaces = React.useMemo<TreeNode[]>(() => {
    const root = tree.find((item) => item.path === 'knowledge/Workspace')
    const children = root?.children ?? []
    return [...children]
      .filter((c) => c.kind === 'dir')
      .sort((a, b) => (b.stat?.mtimeMs ?? 0) - (a.stat?.mtimeMs ?? 0))
      .slice(0, 3)
  }, [tree])

  return (
    <SidebarGroup className="flex flex-col">
      <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
        Workspace
      </div>
      <SidebarGroupContent>
        <SidebarMenu>
          {recentWorkspaces.map((ws) => (
            <SidebarMenuItem key={ws.path}>
              <SidebarMenuButton onClick={() => actions.openWorkspaceAt(ws.path)}>
                <Folder className="size-4 shrink-0" />
                <span className="truncate">{ws.name}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => actions.openWorkspaceAt()}>
              <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">View all</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}


function TasksSidebarSection({
  tasks,
  onOpenTask,
  onOpenTasksView,
}: {
  tasks: TaskSummary[]
  onOpenTask?: (slug: string) => void
  onOpenTasksView?: () => void
}) {
  const recentTasks = React.useMemo<TaskSummary[]>(() => {
    const toTime = (s?: string | null): number => {
      if (!s) return 0
      const t = new Date(s).getTime()
      return Number.isNaN(t) ? 0 : t
    }
    const activity = (t: TaskSummary): number =>
      Math.max(toTime(t.lastRunAt), toTime(t.lastAttemptAt), toTime(t.createdAt))
    return [...tasks]
      .sort((a, b) => activity(b) - activity(a))
      .slice(0, 3)
  }, [tasks])

  return (
    <SidebarGroup className="flex flex-col">
      <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
        Tasks
      </div>
      <SidebarGroupContent>
        <SidebarMenu>
          {recentTasks.map((task) => (
            <SidebarMenuItem key={task.slug}>
              <SidebarMenuButton
                onClick={() => onOpenTask?.(task.slug)}
                className="gap-2"
              >
                <Bot className="size-4 shrink-0" />
                <span className={`truncate text-sm ${!task.active ? "text-muted-foreground" : ""}`}>
                  {task.name}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
          {onOpenTasksView && (
            <SidebarMenuItem>
              <SidebarMenuButton onClick={onOpenTasksView}>
                <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">View all</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

// Tasks Section
function TasksSection({
  runs,
  currentRunId,
  processingRunIds,
  actions,
}: {
  runs: RunListItem[]
  currentRunId?: string | null
  processingRunIds?: Set<string>
  actions?: TasksActions
}) {
  const [pendingDeleteRunId, setPendingDeleteRunId] = useState<string | null>(null)

  return (
    <SidebarGroup className="flex flex-col">
      <SidebarGroupContent>
        <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
          Chat history
        </div>
        <SidebarMenu>
          {runs.slice(0, 3).map((run) => (
            <ContextMenu key={run.id}>
              <ContextMenuTrigger asChild>
                <SidebarMenuItem className="group/chat-item">
                  <SidebarMenuButton
                    isActive={currentRunId === run.id}
                    onClick={(e) => {
                      if (e.metaKey && actions?.onOpenInNewTab) {
                        actions.onOpenInNewTab(run.id)
                      } else {
                        actions?.onSelectRun(run.id)
                      }
                    }}
                  >
                    <div className="flex w-full items-center gap-2 min-w-0">
                      <span className="min-w-0 flex-1 truncate text-sm">{run.title || '(Untitled chat)'}</span>
                      {run.createdAt ? (
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {formatRunTime(run.createdAt)}
                        </span>
                      ) : null}
                    </div>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-48">
                {actions?.onOpenInNewTab && (
                  <ContextMenuItem onClick={() => actions.onOpenInNewTab!(run.id)}>
                    <ExternalLink className="mr-2 size-4" />
                    Open in new tab
                  </ContextMenuItem>
                )}
                {!processingRunIds?.has(run.id) && (
                  <>
                    {actions?.onOpenInNewTab && <ContextMenuSeparator />}
                    <ContextMenuItem
                      variant="destructive"
                      onClick={() => setPendingDeleteRunId(run.id)}
                    >
                      <Trash2 className="mr-2 size-4" />
                      Delete
                    </ContextMenuItem>
                  </>
                )}
              </ContextMenuContent>
            </ContextMenu>
          ))}
          {actions?.onOpenChatHistoryView && (
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => actions.onOpenChatHistoryView?.()}>
                <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">View all</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroupContent>

      {/* Delete confirmation dialog */}
      <Dialog open={!!pendingDeleteRunId} onOpenChange={(open) => { if (!open) setPendingDeleteRunId(null) }}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete chat</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this chat?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPendingDeleteRunId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (pendingDeleteRunId) {
                  actions?.onDeleteRun(pendingDeleteRunId)
                }
                setPendingDeleteRunId(null)
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarGroup>
  )
}
