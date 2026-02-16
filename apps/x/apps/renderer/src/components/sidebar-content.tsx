"use client"

import * as React from "react"
import { useEffect, useRef, useState } from "react"
import {
  Bot,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  FilePlus,
  FolderPlus,
  HelpCircle,
  Mic,
  Network,
  Pencil,
  Plug,
  LoaderIcon,
  Settings,
  Square,
  Trash2,
} from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
  SidebarMenuSub,
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
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { type ActiveSection, useSidebarSection } from "@/contexts/sidebar-context"
import { ConnectorsPopover } from "@/components/connectors-popover"
import { HelpPopover } from "@/components/help-popover"
import { SettingsDialog } from "@/components/settings-dialog"
import { toast } from "@/lib/toast"
import { ServiceEvent } from "@x/shared/src/service-events.js"
import z from "zod"

interface TreeNode {
  path: string
  name: string
  kind: "file" | "dir"
  children?: TreeNode[]
  loaded?: boolean
}

type KnowledgeActions = {
  createNote: (parentPath?: string) => void
  createFolder: (parentPath?: string) => void
  openGraph: () => void
  expandAll: () => void
  collapseAll: () => void
  rename: (path: string, newName: string, isDir: boolean) => Promise<void>
  remove: (path: string) => Promise<void>
  copyPath: (path: string) => void
}

type RunListItem = {
  id: string
  title?: string
  createdAt: string
  agentId: string
}

type BackgroundTaskItem = {
  name: string
  description?: string
  schedule: {
    type: "cron" | "window" | "once"
    expression?: string
    cron?: string
    startTime?: string
    endTime?: string
    runAt?: string
  }
  enabled: boolean
  status?: "scheduled" | "running" | "finished" | "failed" | "triggered"
  nextRunAt?: string | null
  lastRunAt?: string | null
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
}

type TasksActions = {
  onNewChat: () => void
  onSelectRun: (runId: string) => void
  onDeleteRun: (runId: string) => void
  onSelectBackgroundTask?: (taskName: string) => void
}

type SidebarContentPanelProps = {
  tree: TreeNode[]
  selectedPath: string | null
  expandedPaths: Set<string>
  onSelectFile: (path: string, kind: "file" | "dir") => void
  knowledgeActions: KnowledgeActions
  onVoiceNoteCreated?: (path: string) => void
  runs?: RunListItem[]
  currentRunId?: string | null
  processingRunIds?: Set<string>
  tasksActions?: TasksActions
  backgroundTasks?: BackgroundTaskItem[]
  selectedBackgroundTask?: string | null
} & React.ComponentProps<typeof Sidebar>

const sectionTabs: { id: ActiveSection; label: string }[] = [
  { id: "tasks", label: "Chat" },
  { id: "knowledge", label: "Knowledge" },
]

function formatEventTime(ts: string): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

function formatRunTime(ts: string): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ""
  const now = Date.now()
  const diffMs = Math.max(0, now - date.getTime())
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)
  const diffWeeks = Math.floor(diffDays / 7)
  const diffMonths = Math.floor(diffDays / 30)

  if (diffMinutes < 1) return "just now"
  if (diffMinutes < 60) return `${diffMinutes} m`
  if (diffHours < 24) return `${diffHours} h`
  if (diffDays < 7) return `${diffDays} d`
  if (diffWeeks < 4) return `${diffWeeks} w`
  return `${Math.max(1, diffMonths)} m`
}

function SyncStatusBar() {
  const { state, isMobile } = useSidebar()
  const [activeServices, setActiveServices] = useState<Map<string, string>>(new Map())
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
        const existingTimeout = runTimeoutsRef.current.get(nextEvent.runId)
        if (existingTimeout) {
          clearTimeout(existingTimeout)
          runTimeoutsRef.current.delete(nextEvent.runId)
        }
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
        // Newest first, limit to 1000
        setLogEvents(parsed.reverse().slice(0, MAX_SYNC_EVENTS))
      } catch {
        if (!cancelled) setLogEvents([])
      } finally {
        if (!cancelled) setLogLoading(false)
      }
    }
    loadLogs()
    return () => { cancelled = true }
  }, [popoverOpen])

  const isSyncing = activeServices.size > 0
  const isCollapsed = state === "collapsed"

  // Build status label from active services
  const activeServiceNames = [...new Set(activeServices.values())]
  const statusLabel = isSyncing
    ? activeServiceNames.map((s) => SERVICE_LABELS[s] || s).join(", ")
    : "All caught up"

  return (
    <>
      {!isMobile && isCollapsed && isSyncing && (
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
              className="flex w-full items-center justify-between rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-sidebar-accent"
            >
              <span className="flex items-center gap-2 min-w-0">
                {isSyncing ? (
                  <LoaderIcon className="h-3 w-3 shrink-0 animate-spin" />
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
                {isSyncing ? statusLabel : "All services up to date"}
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
                      <span className="leading-4 text-foreground/80">{event.message}</span>
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
  expandedPaths,
  onSelectFile,
  knowledgeActions,
  onVoiceNoteCreated,
  runs = [],
  currentRunId,
  processingRunIds,
  tasksActions,
  backgroundTasks = [],
  selectedBackgroundTask,
  ...props
}: SidebarContentPanelProps) {
  const { activeSection, setActiveSection } = useSidebarSection()

  return (
    <Sidebar className="border-r-0" {...props}>
      <SidebarHeader className="titlebar-drag-region">
        {/* Top spacer to clear the traffic lights + fixed toggle row */}
        <div className="h-8" />
        {/* Tab switcher - centered below the traffic lights row */}
        <div className="flex items-center px-2 py-1.5">
          <div className="titlebar-no-drag flex w-full rounded-lg bg-sidebar-accent/50 p-0.5">
            {sectionTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveSection(tab.id)}
                className={cn(
                  "flex-1 rounded-md px-3 py-1 text-sm font-medium transition-colors",
                  activeSection === tab.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                    : "text-sidebar-foreground/70 hover:text-sidebar-foreground"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {activeSection === "knowledge" && (
          <KnowledgeSection
            tree={tree}
            selectedPath={selectedPath}
            expandedPaths={expandedPaths}
            onSelectFile={onSelectFile}
            actions={knowledgeActions}
            onVoiceNoteCreated={onVoiceNoteCreated}
          />
        )}
        {activeSection === "tasks" && (
          <TasksSection
            runs={runs}
            currentRunId={currentRunId}
            processingRunIds={processingRunIds}
            actions={tasksActions}
            backgroundTasks={backgroundTasks}
            selectedBackgroundTask={selectedBackgroundTask}
          />
        )}
      </SidebarContent>
      {/* Bottom actions */}
      <div className="border-t border-sidebar-border px-2 py-2">
        <div className="flex flex-col gap-1">
          <ConnectorsPopover>
            <button className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors">
              <Plug className="size-4" />
              <span>Connectors</span>
            </button>
          </ConnectorsPopover>
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
function VoiceNoteButton({ onNoteCreated }: { onNoteCreated?: (path: string) => void }) {
  const [isRecording, setIsRecording] = React.useState(false)
  const [hasDeepgramKey, setHasDeepgramKey] = React.useState(false)
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null)
  const chunksRef = React.useRef<Blob[]>([])
  const notePathRef = React.useRef<string | null>(null)
  const timestampRef = React.useRef<string | null>(null)
  const relativePathRef = React.useRef<string | null>(null)

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

      const initialContent = `# Voice Memo

**Type:** voice memo
**Recorded:** ${now.toLocaleString()}
**Path:** ${relativePath}

## Transcript

*Recording in progress...*
`
      await window.ipc.invoke('workspace:writeFile', {
        path: notePath,
        data: initialContent,
        opts: { encoding: 'utf8' },
      })

      // Select the note so the user can see it
      onNoteCreated?.(notePath)

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
          const transcribingContent = `# Voice Memo

**Type:** voice memo
**Recorded:** ${new Date().toLocaleString()}
**Path:** ${currentRelativePath}

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
            ? `# Voice Memo

**Type:** voice memo
**Recorded:** ${new Date().toLocaleString()}
**Path:** ${currentRelativePath}

## Transcript

${transcript}
`
            : `# Voice Memo

**Type:** voice memo
**Recorded:** ${new Date().toLocaleString()}
**Path:** ${currentRelativePath}

## Transcript

*Transcription failed. Please try again.*
`
          await window.ipc.invoke('workspace:writeFile', {
            path: currentNotePath,
            data: finalContent,
            opts: { encoding: 'utf8' },
          })

          // Re-select to trigger refresh
          onNoteCreated?.(currentNotePath)

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
  expandedPaths,
  onSelectFile,
  actions,
  onVoiceNoteCreated,
}: {
  tree: TreeNode[]
  selectedPath: string | null
  expandedPaths: Set<string>
  onSelectFile: (path: string, kind: "file" | "dir") => void
  actions: KnowledgeActions
  onVoiceNoteCreated?: (path: string) => void
}) {
  const isExpanded = expandedPaths.size > 0

  const quickActions = [
    { icon: FilePlus, label: "New Note", action: () => actions.createNote() },
    { icon: FolderPlus, label: "New Folder", action: () => actions.createFolder() },
    { icon: Network, label: "Graph View", action: () => actions.openGraph() },
  ]

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <SidebarGroup className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-center gap-1 py-1 sticky top-0 z-10 bg-sidebar border-b border-sidebar-border">
            {quickActions.map((action) => (
              <Tooltip key={action.label}>
                <TooltipTrigger asChild>
                  <button
                    onClick={action.action}
                    className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded p-1.5 transition-colors"
                  >
                    <action.icon className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{action.label}</TooltipContent>
              </Tooltip>
            ))}
            <VoiceNoteButton onNoteCreated={onVoiceNoteCreated} />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={isExpanded ? actions.collapseAll : actions.expandAll}
                  className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded p-1.5 transition-colors"
                >
                  {isExpanded ? (
                    <ChevronsDownUp className="size-4" />
                  ) : (
                    <ChevronsUpDown className="size-4" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {isExpanded ? "Collapse All" : "Expand All"}
              </TooltipContent>
            </Tooltip>
          </div>
          <SidebarGroupContent className="flex-1 overflow-y-auto">
            <SidebarMenu>
              {tree.map((item, index) => (
                <Tree
                  key={index}
                  item={item}
                  selectedPath={selectedPath}
                  expandedPaths={expandedPaths}
                  onSelect={onSelectFile}
                  actions={actions}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={() => actions.createNote()}>
          <FilePlus className="mr-2 size-4" />
          New Note
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions.createFolder()}>
          <FolderPlus className="mr-2 size-4" />
          New Folder
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// Tree component for file browser
function Tree({
  item,
  selectedPath,
  expandedPaths,
  onSelect,
  actions,
}: {
  item: TreeNode
  selectedPath: string | null
  expandedPaths: Set<string>
  onSelect: (path: string, kind: "file" | "dir") => void
  actions: KnowledgeActions
}) {
  const isDir = item.kind === 'dir'
  const isExpanded = expandedPaths.has(item.path)
  const isSelected = selectedPath === item.path
  const [isRenaming, setIsRenaming] = useState(false)
  const isSubmittingRef = React.useRef(false)

  // For files, strip .md extension for editing
  const baseName = !isDir && item.name.endsWith('.md')
    ? item.name.slice(0, -3)
    : item.name
  const [newName, setNewName] = useState(baseName)

  // Sync newName when baseName changes (e.g., after external rename)
  React.useEffect(() => {
    setNewName(baseName)
  }, [baseName])

  const handleRename = async () => {
    // Prevent double submission
    if (isSubmittingRef.current) return
    isSubmittingRef.current = true

    const trimmedName = newName.trim()
    if (trimmedName && trimmedName !== baseName) {
      try {
        await actions.rename(item.path, trimmedName, isDir)
        toast('Renamed successfully', 'success')
      } catch (err) {
        toast('Failed to rename', 'error')
      }
    }
    setIsRenaming(false)
    // Reset after a small delay to prevent blur from re-triggering
    setTimeout(() => {
      isSubmittingRef.current = false
    }, 100)
  }

  const handleDelete = async () => {
    try {
      await actions.remove(item.path)
      toast('Moved to trash', 'success')
    } catch (err) {
      toast('Failed to delete', 'error')
    }
  }

  const handleCopyPath = () => {
    actions.copyPath(item.path)
    toast('Path copied', 'success')
  }

  const cancelRename = () => {
    isSubmittingRef.current = true // Prevent blur from triggering rename
    setIsRenaming(false)
    setNewName(baseName) // Reset to original name
    setTimeout(() => {
      isSubmittingRef.current = false
    }, 100)
  }

  const contextMenuContent = (
    <ContextMenuContent className="w-48">
      {isDir && (
        <>
          <ContextMenuItem onClick={() => actions.createNote(item.path)}>
            <FilePlus className="mr-2 size-4" />
            New Note
          </ContextMenuItem>
          <ContextMenuItem onClick={() => actions.createFolder(item.path)}>
            <FolderPlus className="mr-2 size-4" />
            New Folder
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem onClick={handleCopyPath}>
        <Copy className="mr-2 size-4" />
        Copy Path
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => { setNewName(baseName); isSubmittingRef.current = false; setIsRenaming(true) }}>
        <Pencil className="mr-2 size-4" />
        Rename
      </ContextMenuItem>
      <ContextMenuItem variant="destructive" onClick={handleDelete}>
        <Trash2 className="mr-2 size-4" />
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  )

  // Inline rename input
  if (isRenaming) {
    return (
      <SidebarMenuItem>
        <div className="flex items-center px-2 py-1">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={async (e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                await handleRename()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancelRename()
              }
            }}
            onBlur={() => {
              // Only trigger rename if not already submitting
              if (!isSubmittingRef.current) {
                handleRename()
              }
            }}
            className="h-6 text-sm flex-1"
            autoFocus
          />
        </div>
      </SidebarMenuItem>
    )
  }

  if (!isDir) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={isSelected}
              onClick={() => onSelect(item.path, item.kind)}
            >
              <span>{item.name}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </ContextMenuTrigger>
        {contextMenuContent}
      </ContextMenu>
    )
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <SidebarMenuItem>
          <Collapsible
            open={isExpanded}
            onOpenChange={() => onSelect(item.path, item.kind)}
            className="group/collapsible [&[data-state=open]>button>svg:first-child]:rotate-90"
          >
            <CollapsibleTrigger asChild>
              <SidebarMenuButton>
                <ChevronRight className="transition-transform size-4" />
                <span>{item.name}</span>
              </SidebarMenuButton>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarMenuSub>
                {(item.children ?? []).map((subItem, index) => (
                  <Tree
                    key={index}
                    item={subItem}
                    selectedPath={selectedPath}
                    expandedPaths={expandedPaths}
                    onSelect={onSelect}
                    actions={actions}
                  />
                ))}
              </SidebarMenuSub>
            </CollapsibleContent>
          </Collapsible>
        </SidebarMenuItem>
      </ContextMenuTrigger>
      {contextMenuContent}
    </ContextMenu>
  )
}

// Get status indicator color
function getStatusColor(status?: string, enabled?: boolean): string {
  // Disabled agents always show gray
  if (enabled === false) {
    return "bg-gray-400"
  }
  switch (status) {
    case "running":
      return "bg-blue-500"
    case "finished":
      return "bg-green-500"
    case "failed":
      return "bg-red-500"
    case "triggered":
      return "bg-gray-400"
    case "scheduled":
    default:
      return "bg-yellow-500"
  }
}

// Tasks Section
function TasksSection({
  runs,
  currentRunId,
  processingRunIds,
  actions,
  backgroundTasks = [],
  selectedBackgroundTask,
}: {
  runs: RunListItem[]
  currentRunId?: string | null
  processingRunIds?: Set<string>
  actions?: TasksActions
  backgroundTasks?: BackgroundTaskItem[]
  selectedBackgroundTask?: string | null
}) {
  const [pendingDeleteRunId, setPendingDeleteRunId] = useState<string | null>(null)

  return (
    <SidebarGroup className="flex-1 flex flex-col overflow-hidden">
      <SidebarGroupContent className="flex-1 overflow-y-auto">
        {/* Background Tasks Section */}
        {backgroundTasks.length > 0 && (
          <>
            <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
              Background Tasks
            </div>
            <SidebarMenu>
              {backgroundTasks.map((task) => (
                <SidebarMenuItem key={task.name}>
                  <SidebarMenuButton
                    isActive={selectedBackgroundTask === task.name}
                    onClick={() => actions?.onSelectBackgroundTask?.(task.name)}
                    className="gap-2"
                  >
                    <div className="relative">
                      <Bot className="size-4 shrink-0" />
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 size-2 rounded-full ${getStatusColor(task.status, task.enabled)} ${task.status === "running" && task.enabled ? "animate-pulse" : ""}`}
                      />
                    </div>
                    <span className={`truncate text-sm ${!task.enabled ? "text-muted-foreground" : ""}`}>
                      {task.name}
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </>
        )}
        {runs.length > 0 && (
          <>
            <div className="px-3 py-1.5 mt-4 text-xs font-medium text-muted-foreground">
              Chat history
            </div>
            <SidebarMenu>
              {runs.map((run) => (
                <SidebarMenuItem key={run.id} className="group/chat-item">
                  <SidebarMenuButton
                    isActive={currentRunId === run.id}
                    onClick={() => actions?.onSelectRun(run.id)}
                  >
                    <div className="flex w-full items-center gap-2 min-w-0">
                      {processingRunIds?.has(run.id) ? (
                        <span className="size-2 shrink-0 rounded-full bg-emerald-500 animate-pulse" />
                      ) : null}
                      <span className="min-w-0 flex-1 truncate text-sm">{run.title || '(Untitled chat)'}</span>
                      {run.createdAt ? (
                        <span className={`shrink-0 text-[10px] text-muted-foreground${processingRunIds?.has(run.id) ? '' : ' group-hover/chat-item:hidden'}`}>
                          {formatRunTime(run.createdAt)}
                        </span>
                      ) : null}
                      {!processingRunIds?.has(run.id) && (
                        <button
                          type="button"
                          className="shrink-0 hidden group-hover/chat-item:flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                          onClick={(e) => {
                            e.stopPropagation()
                            setPendingDeleteRunId(run.id)
                          }}
                          aria-label="Delete chat"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </>
        )}
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
