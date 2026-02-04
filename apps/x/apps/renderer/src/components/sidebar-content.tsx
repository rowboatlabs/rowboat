"use client"

import * as React from "react"
import { useState } from "react"
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  File,
  FilePlus,
  Folder,
  FolderPlus,
  MessageSquare,
  Mic,
  Network,
  Pencil,
  Square,
  SquarePen,
  Trash2,
} from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarRail,
} from "@/components/ui/sidebar"
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
import { useSidebarSection } from "@/contexts/sidebar-context"
import { toast } from "@/lib/toast"

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

type TasksActions = {
  onNewChat: () => void
  onSelectRun: (runId: string) => void
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
  tasksActions?: TasksActions
} & React.ComponentProps<typeof Sidebar>

const sectionTitles = {
  knowledge: "Knowledge",
  tasks: "Chats",
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
  tasksActions,
  ...props
}: SidebarContentPanelProps) {
  const { activeSection } = useSidebarSection()

  return (
    <Sidebar className="border-r-0" {...props}>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <span className="font-semibold text-lg">{sectionTitles[activeSection]}</span>
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
            actions={tasksActions}
          />
        )}
      </SidebarContent>
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
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null)
  const chunksRef = React.useRef<Blob[]>([])
  const notePathRef = React.useRef<string | null>(null)
  const timestampRef = React.useRef<string | null>(null)
  const relativePathRef = React.useRef<string | null>(null)

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
        <div className="flex items-center gap-2 px-2 py-1">
          {isDir ? <Folder className="size-4 shrink-0" /> : <File className="size-4 shrink-0" />}
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
              <File className="size-4" />
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
                <Folder className="size-4" />
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

// Tasks Section
function TasksSection({
  runs,
  currentRunId,
  actions,
}: {
  runs: RunListItem[]
  currentRunId?: string | null
  actions?: TasksActions
}) {
  return (
    <SidebarGroup className="flex-1 flex flex-col overflow-hidden">
      {/* Sticky New Chat button - matches Knowledge section height */}
      <div className="sticky top-0 z-10 bg-sidebar border-b border-sidebar-border py-0.5">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={actions?.onNewChat} className="gap-2">
              <SquarePen className="size-4 shrink-0" />
              <span className="text-sm">New chat</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </div>
      <SidebarGroupContent className="flex-1 overflow-y-auto">
        {runs.length > 0 && (
          <>
            <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
              Chat history
            </div>
            <SidebarMenu>
              {runs.map((run) => (
                <SidebarMenuItem key={run.id}>
                  <SidebarMenuButton
                    isActive={currentRunId === run.id}
                    onClick={() => actions?.onSelectRun(run.id)}
                    className="gap-2"
                  >
                    <MessageSquare className="size-4 shrink-0" />
                    <span className="truncate text-sm">{run.title || '(Untitled chat)'}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

