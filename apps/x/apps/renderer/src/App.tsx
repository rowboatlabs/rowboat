import * as React from 'react'
import { useCallback, useEffect, useState, useRef } from 'react'
import { workspace } from '@x/shared';
import { RunEvent, ListRunsResponse } from '@x/shared/src/runs.js';
import type { LanguageModelUsage, ToolUIPart } from 'ai';
import './App.css'
import z from 'zod';
import { Button } from './components/ui/button';
import { CheckIcon, LoaderIcon, ArrowUp, PanelLeftIcon, PanelRightIcon, Square, X, ChevronLeftIcon, ChevronRightIcon, SquarePen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarkdownEditor } from './components/markdown-editor';
import { ChatInputBar } from './components/chat-button';
import { ChatSidebar } from './components/chat-sidebar';
import { GraphView, type GraphEdge, type GraphNode } from '@/components/graph-view';
import { useDebounce } from './hooks/use-debounce';
import { SidebarContentPanel } from '@/components/sidebar-content';
import { SidebarSectionProvider, type ActiveSection } from '@/contexts/sidebar-context';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ScrollPositionPreserver,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  type PromptInputMessage,
  PromptInputProvider,
  PromptInputTextarea,
  usePromptInputController,
  type FileMention,
} from '@/components/ai-elements/prompt-input';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool';
import { PermissionRequest } from '@/components/ai-elements/permission-request';
import { AskHumanRequest } from '@/components/ai-elements/ask-human-request';
import { Suggestions } from '@/components/ai-elements/suggestions';
import { ToolPermissionRequestEvent, AskHumanRequestEvent } from '@x/shared/src/runs.js';
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { stripKnowledgePrefix, toKnowledgePath, wikiLabel } from '@/lib/wiki-links'
import { OnboardingModal } from '@/components/onboarding-modal'
import { BackgroundTaskDetail } from '@/components/background-task-detail'
import { FileCardProvider } from '@/contexts/file-card-context'
import { MarkdownPreOverride } from '@/components/ai-elements/markdown-code-override'
import { AgentScheduleConfig } from '@x/shared/dist/agent-schedule.js'
import { AgentScheduleState } from '@x/shared/dist/agent-schedule-state.js'

type DirEntry = z.infer<typeof workspace.DirEntry>
type RunEventType = z.infer<typeof RunEvent>
type ListRunsResponseType = z.infer<typeof ListRunsResponse>

interface TreeNode extends DirEntry {
  children?: TreeNode[]
  loaded?: boolean
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface ToolCall {
  id: string;
  name: string;
  input: ToolUIPart['input'];
  result?: ToolUIPart['output'];
  status: 'pending' | 'running' | 'completed' | 'error';
  timestamp: number;
}

interface ReasoningBlock {
  id: string;
  content: string;
  timestamp: number;
}

type ConversationItem = ChatMessage | ToolCall | ReasoningBlock;

type ToolState = 'input-streaming' | 'input-available' | 'output-available' | 'output-error';

const isChatMessage = (item: ConversationItem): item is ChatMessage => 'role' in item
const isToolCall = (item: ConversationItem): item is ToolCall => 'name' in item
const isReasoningBlock = (item: ConversationItem): item is ReasoningBlock =>
  'content' in item && !('role' in item) && !('name' in item)

const toToolState = (status: ToolCall['status']): ToolState => {
  switch (status) {
    case 'pending':
      return 'input-streaming'
    case 'running':
      return 'input-available'
    case 'completed':
      return 'output-available'
    case 'error':
      return 'output-error'
    default:
      return 'input-available'
  }
}

const streamdownComponents = { pre: MarkdownPreOverride }

const DEFAULT_SIDEBAR_WIDTH = 256
const wikiLinkRegex = /\[\[([^[\]]+)\]\]/g
const graphPalette = [
  { hue: 210, sat: 72, light: 52 },
  { hue: 28, sat: 78, light: 52 },
  { hue: 120, sat: 62, light: 48 },
  { hue: 170, sat: 66, light: 46 },
  { hue: 280, sat: 70, light: 56 },
  { hue: 330, sat: 68, light: 54 },
  { hue: 55, sat: 80, light: 52 },
  { hue: 0, sat: 72, light: 52 },
]

const MACOS_TRAFFIC_LIGHTS_RESERVED_PX = 16 + 12 * 3 + 8 * 2
const TITLEBAR_BUTTON_PX = 32
const TITLEBAR_BUTTON_GAP_PX = 4
const TITLEBAR_HEADER_GAP_PX = 8
const TITLEBAR_TOGGLE_MARGIN_LEFT_PX = 12
const TITLEBAR_BUTTONS_COLLAPSED = 4
const TITLEBAR_BUTTON_GAPS_COLLAPSED = 3

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

// Parse attached files from message content and return clean message + file paths
const parseAttachedFiles = (content: string): { message: string; files: string[] } => {
  const attachedFilesRegex = /<attached-files>\s*([\s\S]*?)\s*<\/attached-files>/
  const match = content.match(attachedFilesRegex)

  if (!match) {
    return { message: content, files: [] }
  }

  // Extract file paths from the XML
  const filesXml = match[1]
  const filePathRegex = /<file path="([^"]+)">/g
  const files: string[] = []
  let fileMatch
  while ((fileMatch = filePathRegex.exec(filesXml)) !== null) {
    files.push(fileMatch[1])
  }

  // Remove the attached-files block
  let cleanMessage = content.replace(attachedFilesRegex, '').trim()

  // Also remove @mentions for the attached files (they're shown as pills)
  for (const filePath of files) {
    // Get the display name (last part of path without extension)
    const fileName = filePath.split('/').pop()?.replace(/\.md$/i, '') || ''
    if (fileName) {
      // Remove @filename pattern (with optional trailing space)
      const mentionRegex = new RegExp(`@${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'gi')
      cleanMessage = cleanMessage.replace(mentionRegex, '')
    }
  }

  return { message: cleanMessage.trim(), files }
}

const untitledBaseName = 'untitled'

const getHeadingTitle = (markdown: string) => {
  const lines = markdown.split('\n')
  for (const line of lines) {
    const match = line.match(/^#\s+(.+)$/)
    if (match) return match[1].trim()
    const trimmed = line.trim()
    if (trimmed !== '') return trimmed
  }
  return null
}

const sanitizeHeadingForFilename = (heading: string) => {
  let name = heading.trim()
  if (!name) return null
  if (name.toLowerCase().endsWith('.md')) {
    name = name.slice(0, -3)
  }
  name = name.replace(/[\\/]/g, '-').replace(/\s+/g, ' ').trim()
  return name || null
}

const getBaseName = (path: string) => {
  const file = path.split('/').pop() ?? ''
  return file.replace(/\.md$/i, '')
}

const normalizeUsage = (usage?: Partial<LanguageModelUsage> | null): LanguageModelUsage | null => {
  if (!usage) return null
  const hasNumbers = Object.values(usage).some((value) => typeof value === 'number')
  if (!hasNumbers) return null
  const inputTokens = usage.inputTokens ?? 0
  const outputTokens = usage.outputTokens ?? 0
  const reasoningTokens = usage.reasoningTokens ?? 0
  const totalTokens = usage.totalTokens ?? inputTokens + outputTokens + reasoningTokens
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens: usage.cachedInputTokens ?? 0,
    reasoningTokens,
  }
}

const normalizeToolInput = (input: ToolCall['input'] | string | undefined): ToolCall['input'] => {
  if (input === undefined || input === null) return {}
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed) return {}
    try {
      return JSON.parse(trimmed)
    } catch {
      return input
    }
  }
  return input
}

const normalizeToolOutput = (output: ToolCall['result'] | undefined, status: ToolCall['status']) => {
  if (output === undefined || output === null) {
    return status === 'completed' ? 'No output returned.' : null
  }
  if (output === '') return '(empty output)'
  if (typeof output === 'boolean' || typeof output === 'number') return String(output)
  return output
}

// Sort nodes (dirs first, then alphabetically)
function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  }).map(node => {
    if (node.children) {
      node.children = sortNodes(node.children)
    }
    return node
  })
}

// Build tree structure from flat entries
function buildTree(entries: DirEntry[]): TreeNode[] {
  const treeMap = new Map<string, TreeNode>()
  const roots: TreeNode[] = []

  // Create nodes
  entries.forEach(entry => {
    const node: TreeNode = { ...entry, children: [], loaded: false }
    treeMap.set(entry.path, node)
  })

  // Build hierarchy
  entries.forEach(entry => {
    const node = treeMap.get(entry.path)!
    const parts = entry.path.split('/')
    if (parts.length === 1) {
      roots.push(node)
    } else {
      const parentPath = parts.slice(0, -1).join('/')
      const parent = treeMap.get(parentPath)
      if (parent) {
        if (!parent.children) parent.children = []
        parent.children.push(node)
      } else {
        roots.push(node)
      }
    }
  })

  return sortNodes(roots)
}

const collectDirPaths = (nodes: TreeNode[]): string[] =>
  nodes.flatMap(n => n.kind === 'dir' ? [n.path, ...(n.children ? collectDirPaths(n.children) : [])] : [])

const collectFilePaths = (nodes: TreeNode[]): string[] =>
  nodes.flatMap(n => n.kind === 'file' ? [n.path] : (n.children ? collectFilePaths(n.children) : []))

// Inner component that uses the controller to access mentions
interface ChatInputInnerProps {
  onSubmit: (message: PromptInputMessage, mentions?: FileMention[]) => void
  onStop?: () => void
  isProcessing: boolean
  isStopping?: boolean
  presetMessage?: string
  onPresetMessageConsumed?: () => void
  runId?: string | null
}

function ChatInputInner({
  onSubmit,
  onStop,
  isProcessing,
  isStopping,
  presetMessage,
  onPresetMessageConsumed,
  runId,
}: ChatInputInnerProps) {
  const controller = usePromptInputController()
  const message = controller.textInput.value
  const canSubmit = Boolean(message.trim()) && !isProcessing

  // Handle preset message from suggestions
  useEffect(() => {
    if (presetMessage) {
      controller.textInput.setInput(presetMessage)
      onPresetMessageConsumed?.()
    }
  }, [presetMessage, controller.textInput, onPresetMessageConsumed])

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return
    onSubmit({ text: message.trim(), files: [] }, controller.mentions.mentions)
    controller.textInput.clear()
    controller.mentions.clearMentions()
  }, [canSubmit, message, onSubmit, controller])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault()
      }
    }
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault()
      }
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        const paths = Array.from(e.dataTransfer.files)
          .map((f) => window.electronUtils?.getPathForFile(f))
          .filter(Boolean)
        if (paths.length > 0) {
          const currentText = controller.textInput.value
          const pathText = paths.join(' ')
          controller.textInput.setInput(
            currentText ? `${currentText} ${pathText}` : pathText
          )
        }
      }
    }
    document.addEventListener("dragover", onDragOver)
    document.addEventListener("drop", onDrop)
    return () => {
      document.removeEventListener("dragover", onDragOver)
      document.removeEventListener("drop", onDrop)
    }
  }, [controller])

  return (
    <div className="flex items-center gap-2 bg-background border border-border rounded-lg shadow-none px-4 py-4">
      <PromptInputTextarea
        placeholder="Type your message..."
        onKeyDown={handleKeyDown}
        autoFocus
        focusTrigger={runId}
        className="min-h-6 py-0 border-0 shadow-none focus-visible:ring-0 rounded-none"
      />
      {isProcessing ? (
        <Button
          size="icon"
          onClick={onStop}
          title={isStopping ? "Click again to force stop" : "Stop generation"}
          className={cn(
            "h-7 w-7 rounded-full shrink-0 transition-all",
            isStopping
              ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
        >
          {isStopping ? (
            <LoaderIcon className="h-4 w-4 animate-spin" />
          ) : (
            <Square className="h-3 w-3 fill-current" />
          )}
        </Button>
      ) : (
        <Button
          size="icon"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={cn(
            "h-7 w-7 rounded-full shrink-0 transition-all",
            canSubmit
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-muted text-muted-foreground"
          )}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}

// Wrapper component with PromptInputProvider
interface ChatInputWithMentionsProps {
  knowledgeFiles: string[]
  recentFiles: string[]
  visibleFiles: string[]
  onSubmit: (message: PromptInputMessage, mentions?: FileMention[]) => void
  onStop?: () => void
  isProcessing: boolean
  isStopping?: boolean
  presetMessage?: string
  onPresetMessageConsumed?: () => void
  runId?: string | null
}

function ChatInputWithMentions({
  knowledgeFiles,
  recentFiles,
  visibleFiles,
  onSubmit,
  onStop,
  isProcessing,
  isStopping,
  presetMessage,
  onPresetMessageConsumed,
  runId,
}: ChatInputWithMentionsProps) {
  return (
    <PromptInputProvider knowledgeFiles={knowledgeFiles} recentFiles={recentFiles} visibleFiles={visibleFiles}>
      <ChatInputInner
        onSubmit={onSubmit}
        onStop={onStop}
        isProcessing={isProcessing}
        isStopping={isStopping}
        presetMessage={presetMessage}
        onPresetMessageConsumed={onPresetMessageConsumed}
        runId={runId}
      />
    </PromptInputProvider>
  )
}

/** A snapshot of which view the user is on */
type ViewState =
  | { type: 'chat'; runId: string | null }
  | { type: 'file'; path: string }
  | { type: 'graph' }
  | { type: 'task'; name: string }

function viewStatesEqual(a: ViewState, b: ViewState): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'chat' && b.type === 'chat') return a.runId === b.runId
  if (a.type === 'file' && b.type === 'file') return a.path === b.path
  if (a.type === 'task' && b.type === 'task') return a.name === b.name
  return true // both graph
}

/** Sidebar toggle + back/forward nav */
function FixedSidebarToggle({
  onNavigateBack,
  onNavigateForward,
  canNavigateBack,
  canNavigateForward,
  onNewChat,
  leftInsetPx,
}: {
  onNavigateBack: () => void
  onNavigateForward: () => void
  canNavigateBack: boolean
  canNavigateForward: boolean
  onNewChat: () => void
  leftInsetPx: number
}) {
  const { toggleSidebar, state } = useSidebar()
  const isCollapsed = state === "collapsed"
  return (
    <div className="fixed left-0 top-0 z-50 flex h-10 items-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <div aria-hidden="true" className="h-10 shrink-0" style={{ width: leftInsetPx }} />
      {/* Sidebar toggle */}
      <button
        type="button"
        onClick={toggleSidebar}
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        style={{ marginLeft: TITLEBAR_TOGGLE_MARGIN_LEFT_PX }}
        aria-label="Toggle Sidebar"
      >
        <PanelLeftIcon className="size-5" />
      </button>
      <button
        type="button"
        onClick={onNewChat}
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        style={{ marginLeft: TITLEBAR_BUTTON_GAP_PX }}
        aria-label="New chat"
      >
        <SquarePen className="size-5" />
      </button>
      {/* Back / Forward navigation */}
      {isCollapsed && (
        <>
          <button
            type="button"
            onClick={onNavigateBack}
            disabled={!canNavigateBack}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
            style={{ marginLeft: TITLEBAR_BUTTON_GAP_PX }}
            aria-label="Go back"
          >
            <ChevronLeftIcon className="size-5" />
          </button>
          <button
            type="button"
            onClick={onNavigateForward}
            disabled={!canNavigateForward}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
            aria-label="Go forward"
          >
            <ChevronRightIcon className="size-5" />
          </button>
        </>
      )}
    </div>
  )
}

/** Main content header that adjusts padding based on sidebar state */
function ContentHeader({
  children,
  onNavigateBack,
  onNavigateForward,
  canNavigateBack,
  canNavigateForward,
  collapsedLeftPaddingPx,
}: {
  children: React.ReactNode
  onNavigateBack?: () => void
  onNavigateForward?: () => void
  canNavigateBack?: boolean
  canNavigateForward?: boolean
  collapsedLeftPaddingPx?: number
}) {
  const { state } = useSidebar()
  const isCollapsed = state === "collapsed"
  return (
    <header
      className={cn(
        "titlebar-drag-region flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 bg-sidebar transition-[padding] duration-200 ease-linear",
        // When the sidebar is collapsed the content area shifts left, so we need enough left padding
        // to avoid overlapping the fixed traffic-lights/toggle/back/forward controls.
        isCollapsed && !collapsedLeftPaddingPx && "pl-[168px]"
      )}
      style={isCollapsed && collapsedLeftPaddingPx ? { paddingLeft: collapsedLeftPaddingPx } : undefined}
    >
      {!isCollapsed && onNavigateBack && onNavigateForward ? (
        <div className="titlebar-no-drag flex items-center gap-1">
          <button
            type="button"
            onClick={onNavigateBack}
            disabled={!canNavigateBack}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
            aria-label="Go back"
          >
            <ChevronLeftIcon className="size-5" />
          </button>
          <button
            type="button"
            onClick={onNavigateForward}
            disabled={!canNavigateForward}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
            aria-label="Go forward"
          >
            <ChevronRightIcon className="size-5" />
          </button>
        </div>
      ) : null}
      {onNavigateBack && onNavigateForward ? (
        <div className="titlebar-no-drag self-stretch w-px bg-border/70" aria-hidden="true" />
      ) : null}
      {children}
    </header>
  )
}

function App() {
  // File browser state (for Knowledge section)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [editorContent, setEditorContent] = useState<string>('')
  const editorContentRef = useRef<string>('')
  const [tree, setTree] = useState<TreeNode[]>([])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [recentWikiFiles, setRecentWikiFiles] = useState<string[]>([])
  const [isGraphOpen, setIsGraphOpen] = useState(false)
  const [expandedFrom, setExpandedFrom] = useState<{ path: string | null; graph: boolean } | null>(null)
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({
    nodes: [],
    edges: [],
  })
  const [graphStatus, setGraphStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [graphError, setGraphError] = useState<string | null>(null)
  const [isChatSidebarOpen, setIsChatSidebarOpen] = useState(true)
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
  const collapsedLeftPaddingPx =
    (isMac ? MACOS_TRAFFIC_LIGHTS_RESERVED_PX : 0) +
    TITLEBAR_TOGGLE_MARGIN_LEFT_PX +
    TITLEBAR_BUTTON_PX * TITLEBAR_BUTTONS_COLLAPSED +
    TITLEBAR_BUTTON_GAP_PX * TITLEBAR_BUTTON_GAPS_COLLAPSED +
    TITLEBAR_HEADER_GAP_PX

  // Keep the latest selected path in a ref (avoids stale async updates when switching rapidly)
  const selectedPathRef = useRef<string | null>(null)
  const editorPathRef = useRef<string | null>(null)
  const fileLoadRequestIdRef = useRef(0)
  const initialContentByPathRef = useRef<Map<string, string>>(new Map())

  // Global navigation history (back/forward) across views (chat/file/graph/task)
  const historyRef = useRef<{ back: ViewState[]; forward: ViewState[] }>({ back: [], forward: [] })
  const [viewHistory, setViewHistory] = useState(historyRef.current)

  // Auto-save state
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const debouncedContent = useDebounce(editorContent, 500)
  const initialContentRef = useRef<string>('')
  const renameInProgressRef = useRef(false)

  // Chat state
  const [message, setMessage] = useState<string>('')
  const [conversation, setConversation] = useState<ConversationItem[]>([])
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState<string>('')
  const [currentReasoning, setCurrentReasoning] = useState<string>('')
  const [, setModelUsage] = useState<LanguageModelUsage | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const runIdRef = useRef<string | null>(null)
  const loadRunRequestIdRef = useRef(0)
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingRunIds, setProcessingRunIds] = useState<Set<string>>(new Set())
  const processingRunIdsRef = useRef<Set<string>>(new Set())
  const streamingBuffersRef = useRef<Map<string, { assistant: string; reasoning: string }>>(new Map())
  const [isStopping, setIsStopping] = useState(false)
  const [stopClickedAt, setStopClickedAt] = useState<number | null>(null)
  const [agentId] = useState<string>('copilot')
  const [presetMessage, setPresetMessage] = useState<string | undefined>(undefined)

  // Runs history state
  type RunListItem = { id: string; title?: string; createdAt: string; agentId: string }
  const [runs, setRuns] = useState<RunListItem[]>([])

  // Pending requests state
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<Map<string, z.infer<typeof ToolPermissionRequestEvent>>>(new Map())
  const [pendingAskHumanRequests, setPendingAskHumanRequests] = useState<Map<string, z.infer<typeof AskHumanRequestEvent>>>(new Map())
  // Track ALL permission requests (for rendering with response status)
  const [allPermissionRequests, setAllPermissionRequests] = useState<Map<string, z.infer<typeof ToolPermissionRequestEvent>>>(new Map())
  // Track permission responses (toolCallId -> response)
  const [permissionResponses, setPermissionResponses] = useState<Map<string, 'approve' | 'deny'>>(new Map())

  // Workspace root for full paths
  const [workspaceRoot, setWorkspaceRoot] = useState<string>('')

  // Onboarding state
  const [showOnboarding, setShowOnboarding] = useState(false)

  // Background tasks state
  type BackgroundTaskItem = {
    name: string
    description?: string
    schedule: z.infer<typeof AgentScheduleConfig>["agents"][string]["schedule"]
    enabled: boolean
    startingMessage?: string
    status?: z.infer<typeof AgentScheduleState>["agents"][string]["status"]
    nextRunAt?: string | null
    lastRunAt?: string | null
    lastError?: string | null
    runCount?: number
  }
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTaskItem[]>([])
  const [selectedBackgroundTask, setSelectedBackgroundTask] = useState<string | null>(null)

  // Keep selectedPathRef in sync for async guards
  useEffect(() => {
    selectedPathRef.current = selectedPath
    if (!selectedPath) {
      editorPathRef.current = null
    }
  }, [selectedPath])

  // Keep runIdRef in sync with runId state (for use in event handlers to avoid stale closures)
  useEffect(() => {
    runIdRef.current = runId
  }, [runId])

  const handleEditorChange = useCallback((markdown: string) => {
    const nextSelectedPath = selectedPathRef.current
    // Avoid clobbering editorPath during rapid transitions (e.g. autosave rename) where refs may lag a tick.
    if (!editorPathRef.current || (nextSelectedPath && editorPathRef.current === nextSelectedPath)) {
      editorPathRef.current = nextSelectedPath
    }
    editorContentRef.current = markdown
    setEditorContent(markdown)
  }, [])
  // Keep processingRunIdsRef in sync for use in async callbacks
  useEffect(() => {
    processingRunIdsRef.current = processingRunIds
  }, [processingRunIds])

  // Sync active run streaming UI with background tracking
  useEffect(() => {
    if (!runId) {
      setIsProcessing(false)
      setCurrentAssistantMessage('')
      setCurrentReasoning('')
      return
    }
    const isRunProcessing = processingRunIdsRef.current.has(runId)
    setIsProcessing(isRunProcessing)
    if (isRunProcessing) {
      const buffer = streamingBuffersRef.current.get(runId)
      setCurrentAssistantMessage(buffer?.assistant ?? '')
      setCurrentReasoning(buffer?.reasoning ?? '')
    } else {
      setCurrentAssistantMessage('')
      setCurrentReasoning('')
      streamingBuffersRef.current.delete(runId)
    }
  }, [runId])

  // Load directory tree
  const loadDirectory = useCallback(async () => {
    try {
      const result = await window.ipc.invoke('workspace:readdir', {
        path: 'knowledge',
        opts: { recursive: true, includeHidden: false }
      })
      return buildTree(result)
    } catch (err) {
      console.error('Failed to load directory:', err)
      return []
    }
  }, [])

  // Load initial tree
  useEffect(() => {
    loadDirectory().then(setTree)
  }, [loadDirectory])

  // Listen to workspace change events
  useEffect(() => {
    const cleanup = window.ipc.on('workspace:didChange', async (event) => {
      loadDirectory().then(setTree)

      const changedPath = event.type === 'changed' ? event.path : null
      const changedPaths = (event.type === 'bulkChanged' ? event.paths : []) ?? []

      // Reload background tasks if agent-schedule.json changed
      if (changedPath === 'config/agent-schedule.json' || changedPaths.includes('config/agent-schedule.json')) {
        loadBackgroundTasks()
      }

      // Reload current file if it was changed externally
      if (!selectedPath) return
      const pathToReload = selectedPath

      const isCurrentFileChanged =
        changedPath === pathToReload || changedPaths.includes(pathToReload)

      if (isCurrentFileChanged) {
        // Only reload if no unsaved edits
        const baseline = initialContentByPathRef.current.get(pathToReload) ?? initialContentRef.current
        if (editorContent === baseline) {
          const result = await window.ipc.invoke('workspace:readFile', { path: pathToReload })
          if (selectedPathRef.current !== pathToReload) return
          setFileContent(result.data)
          setEditorContent(result.data)
          editorContentRef.current = result.data
          editorPathRef.current = pathToReload
          initialContentByPathRef.current.set(pathToReload, result.data)
          initialContentRef.current = result.data
        }
      }
    })
    return cleanup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadDirectory, selectedPath, editorContent])

  // Load file content when selected
  useEffect(() => {
    if (!selectedPath) {
      setFileContent('')
      setEditorContent('')
      editorContentRef.current = ''
      initialContentRef.current = ''
      setLastSaved(null)
      return
    }
    const requestId = (fileLoadRequestIdRef.current += 1)
    const pathToLoad = selectedPath
    let cancelled = false
    ;(async () => {
      try {
        const stat = await window.ipc.invoke('workspace:stat', { path: pathToLoad })
        if (cancelled || fileLoadRequestIdRef.current !== requestId || selectedPathRef.current !== pathToLoad) return
        if (stat.kind === 'file') {
          const result = await window.ipc.invoke('workspace:readFile', { path: pathToLoad })
          if (cancelled || fileLoadRequestIdRef.current !== requestId || selectedPathRef.current !== pathToLoad) return
          setFileContent(result.data)
          const normalizeForCompare = (s: string) => s.split('\n').map(line => line.trimEnd()).join('\n').trim()
          const isSameEditorFile = editorPathRef.current === pathToLoad
          const wouldClobberActiveEdits =
            isSameEditorFile
            && normalizeForCompare(editorContentRef.current) !== normalizeForCompare(result.data)
          if (!wouldClobberActiveEdits) {
            setEditorContent(result.data)
            editorContentRef.current = result.data
            editorPathRef.current = pathToLoad
            initialContentByPathRef.current.set(pathToLoad, result.data)
            initialContentRef.current = result.data
            setLastSaved(null)
          } else {
            // Still update the editor's path so subsequent autosaves write to the correct file.
            editorPathRef.current = pathToLoad
          }
        } else {
          setFileContent('')
          setEditorContent('')
          editorContentRef.current = ''
          initialContentRef.current = ''
        }
      } catch (err) {
        console.error('Failed to load file:', err)
        if (!cancelled && fileLoadRequestIdRef.current === requestId && selectedPathRef.current === pathToLoad) {
          setFileContent('')
          setEditorContent('')
          editorContentRef.current = ''
          initialContentRef.current = ''
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedPath])

  // Track recently opened markdown files for wiki links
  useEffect(() => {
    if (!selectedPath || !selectedPath.endsWith('.md')) return
    const wikiPath = stripKnowledgePrefix(selectedPath)
    setRecentWikiFiles((prev) => {
      const next = [wikiPath, ...prev.filter((path) => path !== wikiPath)]
      return next.slice(0, 50)
    })
  }, [selectedPath])

  // Auto-save when content changes
  useEffect(() => {
    const pathAtStart = editorPathRef.current
    if (!pathAtStart || !pathAtStart.endsWith('.md')) return

    const baseline = initialContentByPathRef.current.get(pathAtStart) ?? initialContentRef.current
    if (debouncedContent === baseline) return
    if (!debouncedContent) return

	    const saveFile = async () => {
	      const wasActiveAtStart = selectedPathRef.current === pathAtStart
	      if (wasActiveAtStart) setIsSaving(true)
	      let pathToSave = pathAtStart
	      let renamedFrom: string | null = null
	      let renamedTo: string | null = null
	      try {
	        // Only rename the currently active file (avoids renaming/jumping while user switches rapidly)
	        if (
	          wasActiveAtStart &&
	          selectedPathRef.current === pathAtStart &&
          !renameInProgressRef.current &&
          pathAtStart.startsWith('knowledge/')
        ) {
          const headingTitle = getHeadingTitle(debouncedContent)
          const desiredName = headingTitle ? sanitizeHeadingForFilename(headingTitle) : null
          const currentBase = getBaseName(pathAtStart)
          if (desiredName && desiredName !== currentBase) {
            const parentDir = pathAtStart.split('/').slice(0, -1).join('/')
            const targetPath = `${parentDir}/${desiredName}.md`
            if (targetPath !== pathAtStart) {
              const exists = await window.ipc.invoke('workspace:exists', { path: targetPath })
	              if (!exists.exists) {
	                renameInProgressRef.current = true
	                await window.ipc.invoke('workspace:rename', { from: pathAtStart, to: targetPath })
	                pathToSave = targetPath
	                renamedFrom = pathAtStart
	                renamedTo = targetPath
	                editorPathRef.current = targetPath
	                initialContentByPathRef.current.delete(pathAtStart)
	              }
	            }
	          }
	        }
	        await window.ipc.invoke('workspace:writeFile', {
	          path: pathToSave,
	          data: debouncedContent,
	          opts: { encoding: 'utf8' }
	        })
	        initialContentByPathRef.current.set(pathToSave, debouncedContent)

	        // If we renamed the active file, update state/history AFTER the write completes so the editor
	        // doesn't reload stale on-disk content mid-typing (which can drop the latest character).
	        if (renamedFrom && renamedTo) {
	          const fromPath = renamedFrom
	          const toPath = renamedTo
	          const replaceRenamedPath = (stack: ViewState[]) =>
	            stack.map((v) => (v.type === 'file' && v.path === fromPath ? ({ type: 'file', path: toPath } satisfies ViewState) : v))
	          setHistory({
	            back: replaceRenamedPath(historyRef.current.back),
	            forward: replaceRenamedPath(historyRef.current.forward),
	          })

	          if (selectedPathRef.current === fromPath) {
	            setSelectedPath(toPath)
	          }
	        }

	        // Only update "current file" UI state if we're still on this file
	        if (selectedPathRef.current === pathAtStart || selectedPathRef.current === pathToSave) {
	          initialContentRef.current = debouncedContent
          setLastSaved(new Date())
        }
      } catch (err) {
        console.error('Failed to save file:', err)
      } finally {
        renameInProgressRef.current = false
        if (wasActiveAtStart && (selectedPathRef.current === pathAtStart || selectedPathRef.current === pathToSave)) {
          setIsSaving(false)
        }
      }
    }
    saveFile()
  }, [debouncedContent])

  // Load runs list (all pages)
  const loadRuns = useCallback(async () => {
    try {
      const allRuns: RunListItem[] = []
      let cursor: string | undefined = undefined

      // Fetch all pages
      do {
        const result: ListRunsResponseType = await window.ipc.invoke('runs:list', { cursor })
        allRuns.push(...result.runs)
        cursor = result.nextCursor
      } while (cursor)

      // Filter for copilot runs only
      const copilotRuns = allRuns.filter((run: RunListItem) => run.agentId === 'copilot')
      setRuns(copilotRuns)
    } catch (err) {
      console.error('Failed to load runs:', err)
    }
  }, [])

  // Load runs on mount
  useEffect(() => {
    loadRuns()
  }, [loadRuns])

  // Load background tasks
  const loadBackgroundTasks = useCallback(async () => {
    try {
      const [configResult, stateResult] = await Promise.all([
        window.ipc.invoke('agent-schedule:getConfig', null),
        window.ipc.invoke('agent-schedule:getState', null),
      ])

      const tasks: BackgroundTaskItem[] = Object.entries(configResult.agents).map(([name, entry]) => {
        const state = stateResult.agents[name]
        return {
          name,
          description: entry.description,
          schedule: entry.schedule,
          enabled: entry.enabled ?? true,
          startingMessage: entry.startingMessage,
          status: state?.status,
          nextRunAt: state?.nextRunAt,
          lastRunAt: state?.lastRunAt,
          lastError: state?.lastError,
          runCount: state?.runCount ?? 0,
        }
      })

      setBackgroundTasks(tasks)
    } catch (err) {
      console.error('Failed to load background tasks:', err)
    }
  }, [])

  // Load background tasks on mount
  useEffect(() => {
    loadBackgroundTasks()
  }, [loadBackgroundTasks])

  // Handle toggling background task enabled state
  const handleToggleBackgroundTask = useCallback(async (taskName: string, enabled: boolean) => {
    const task = backgroundTasks.find(t => t.name === taskName)
    if (!task) return

    try {
      await window.ipc.invoke('agent-schedule:updateAgent', {
        agentName: taskName,
        entry: {
          schedule: task.schedule,
          enabled,
          startingMessage: task.startingMessage,
          description: task.description,
        },
      })
      // Reload to get updated state
      await loadBackgroundTasks()
    } catch (err) {
      console.error('Failed to update background task:', err)
    }
  }, [backgroundTasks, loadBackgroundTasks])

  // Load a specific run and populate conversation
  const loadRun = useCallback(async (id: string) => {
    const requestId = (loadRunRequestIdRef.current += 1)
    try {
      const run = await window.ipc.invoke('runs:fetch', { runId: id })
      if (loadRunRequestIdRef.current !== requestId) return

      // Parse the log events into conversation items
      const items: ConversationItem[] = []
      const toolCallMap = new Map<string, ToolCall>()

      for (const event of run.log) {
        switch (event.type) {
          case 'message': {
            const msg = event.message
            if (msg.role === 'user' || msg.role === 'assistant') {
              // Extract text content from message
              let textContent = ''
              if (typeof msg.content === 'string') {
                textContent = msg.content
              } else if (Array.isArray(msg.content)) {
                // Extract text parts
                textContent = msg.content
                  .filter((part: { type: string }) => part.type === 'text')
                  .map((part: { type: string; text?: string }) => part.text || '')
                  .join('')
                
                // Also extract tool-call parts from assistant messages
                if (msg.role === 'assistant') {
                  for (const part of msg.content) {
                    if (part.type === 'tool-call') {
                      const toolCall: ToolCall = {
                        id: part.toolCallId,
                        name: part.toolName,
                        input: normalizeToolInput(part.arguments),
                        status: 'pending',
                        timestamp: event.ts ? new Date(event.ts).getTime() : Date.now(),
                      }
                      toolCallMap.set(toolCall.id, toolCall)
                      items.push(toolCall)
                    }
                  }
                }
              }
              if (textContent) {
                items.push({
                  id: event.messageId,
                  role: msg.role,
                  content: textContent,
                  timestamp: event.ts ? new Date(event.ts).getTime() : Date.now(),
                })
              }
            }
            break
          }
          case 'tool-invocation': {
            // Update existing tool call status or create new one
            const existingTool = event.toolCallId ? toolCallMap.get(event.toolCallId) : null
            if (existingTool) {
              existingTool.input = normalizeToolInput(event.input)
              existingTool.status = 'running'
            } else {
              const toolCall: ToolCall = {
                id: event.toolCallId || `tool-${Date.now()}-${Math.random()}`,
                name: event.toolName,
                input: normalizeToolInput(event.input),
                status: 'running',
                timestamp: event.ts ? new Date(event.ts).getTime() : Date.now(),
              }
              toolCallMap.set(toolCall.id, toolCall)
              items.push(toolCall)
            }
            break
          }
          case 'tool-result': {
            const existingTool = event.toolCallId ? toolCallMap.get(event.toolCallId) : null
            if (existingTool) {
              existingTool.result = event.result
              existingTool.status = 'completed'
            }
            break
          }
          case 'llm-stream-event': {
            // We don't need to reconstruct streaming events for history
            // Reasoning is captured in the final message
            break
          }
        }
      }
      if (loadRunRequestIdRef.current !== requestId) return

      // Track permission requests and responses from history
      const allPermissionRequests = new Map<string, z.infer<typeof ToolPermissionRequestEvent>>()
      const permResponseMap = new Map<string, 'approve' | 'deny'>()
      const askHumanRequests = new Map<string, z.infer<typeof AskHumanRequestEvent>>()
      const respondedAskHumanIds = new Set<string>()

      for (const event of run.log) {
        if (event.type === 'tool-permission-request') {
          allPermissionRequests.set(event.toolCall.toolCallId, event)
        } else if (event.type === 'tool-permission-response') {
          permResponseMap.set(event.toolCallId, event.response)
        } else if (event.type === 'ask-human-request') {
          askHumanRequests.set(event.toolCallId, event)
        } else if (event.type === 'ask-human-response') {
          respondedAskHumanIds.add(event.toolCallId)
        }
      }
      if (loadRunRequestIdRef.current !== requestId) return

      // Separate pending vs responded permission requests
      const pendingPerms = new Map<string, z.infer<typeof ToolPermissionRequestEvent>>()
      for (const [id, req] of allPermissionRequests.entries()) {
        if (!permResponseMap.has(id)) {
          pendingPerms.set(id, req)
        }
      }

      const pendingAsks = new Map<string, z.infer<typeof AskHumanRequestEvent>>()
      for (const [id, req] of askHumanRequests.entries()) {
        if (!respondedAskHumanIds.has(id)) {
          pendingAsks.set(id, req)
        }
      }
      if (loadRunRequestIdRef.current !== requestId) return

      // Set the conversation and runId
      setConversation(items)
      setRunId(id)
      setMessage('')
      setPendingPermissionRequests(pendingPerms)
      setPendingAskHumanRequests(pendingAsks)
      setAllPermissionRequests(allPermissionRequests)
      setPermissionResponses(permResponseMap)
    } catch (err) {
      console.error('Failed to load run:', err)
    }
  }, [])

  // Listen to run events
  // Listen to run events - use ref to avoid stale closure issues
  useEffect(() => {
    const cleanup = window.ipc.on('runs:events', ((event: unknown) => {
      handleRunEvent(event as RunEventType)
    }) as (event: null) => void)
    return cleanup
  }, [])

  const getStreamingBuffer = (id: string) => {
    const existing = streamingBuffersRef.current.get(id)
    if (existing) return existing
    const next = { assistant: '', reasoning: '' }
    streamingBuffersRef.current.set(id, next)
    return next
  }

  const appendStreamingBuffer = (id: string, field: 'assistant' | 'reasoning', delta: string) => {
    if (!delta) return
    const buffer = getStreamingBuffer(id)
    buffer[field] += delta
  }

  const clearStreamingBuffer = (id: string) => {
    streamingBuffersRef.current.delete(id)
  }

  const handleRunEvent = (event: RunEventType) => {
    const activeRunId = runIdRef.current
    const isActiveRun = event.runId === activeRunId

    console.log('Run event:', event.type, event)

    switch (event.type) {
      case 'run-processing-start':
        setProcessingRunIds(prev => {
          const next = new Set(prev)
          next.add(event.runId)
          return next
        })
        if (!isActiveRun) return
        setIsProcessing(true)
        setModelUsage(null)
        break

      case 'run-processing-end':
        setProcessingRunIds(prev => {
          const next = new Set(prev)
          next.delete(event.runId)
          return next
        })
        clearStreamingBuffer(event.runId)
        if (!isActiveRun) return
        setIsProcessing(false)
        setIsStopping(false)
        setStopClickedAt(null)
        break

      case 'start':
        if (!isActiveRun) return
        setCurrentAssistantMessage('')
        setCurrentReasoning('')
        setModelUsage(null)
        break

      case 'llm-stream-event':
        {
          const llmEvent = event.event
          if (!isActiveRun) {
            if (llmEvent.type === 'reasoning-delta' && llmEvent.delta) {
              appendStreamingBuffer(event.runId, 'reasoning', llmEvent.delta)
            } else if (llmEvent.type === 'text-delta' && llmEvent.delta) {
              appendStreamingBuffer(event.runId, 'assistant', llmEvent.delta)
            }
            return
          }
          if (llmEvent.type === 'reasoning-delta' && llmEvent.delta) {
            appendStreamingBuffer(event.runId, 'reasoning', llmEvent.delta)
            setCurrentReasoning(prev => prev + llmEvent.delta)
          } else if (llmEvent.type === 'reasoning-end') {
            setCurrentReasoning(reasoning => {
              if (reasoning) {
                setConversation(prev => [...prev, {
                  id: `reasoning-${Date.now()}`,
                  content: reasoning,
                  timestamp: Date.now(),
                }])
              }
              return ''
            })
          } else if (llmEvent.type === 'text-delta' && llmEvent.delta) {
            appendStreamingBuffer(event.runId, 'assistant', llmEvent.delta)
            setCurrentAssistantMessage(prev => prev + llmEvent.delta)
          } else if (llmEvent.type === 'tool-call') {
            setConversation(prev => [...prev, {
              id: llmEvent.toolCallId || `tool-${Date.now()}`,
              name: llmEvent.toolName || 'tool',
              input: normalizeToolInput(llmEvent.input as ToolUIPart['input']),
              status: 'running',
              timestamp: Date.now(),
            }])
          } else if (llmEvent.type === 'finish-step') {
            const nextUsage = normalizeUsage(llmEvent.usage)
            if (nextUsage) {
              setModelUsage(nextUsage)
            }
          }
        }
        break

      case 'message':
        {
          const msg = event.message
          if (!isActiveRun) {
            if (msg.role === 'assistant') {
              clearStreamingBuffer(event.runId)
            }
            return
          }
          if (msg.role === 'assistant') {
            setCurrentAssistantMessage(currentMsg => {
              if (currentMsg) {
                setConversation(prev => {
                  const exists = prev.some(m =>
                    m.id === event.messageId && 'role' in m && m.role === 'assistant'
                  )
                  if (exists) return prev
                  return [...prev, {
                    id: event.messageId,
                    role: 'assistant',
                    content: currentMsg,
                    timestamp: Date.now(),
                  }]
                })
              }
              return ''
            })
            clearStreamingBuffer(event.runId)
          }
        }
        break

      case 'tool-invocation':
        {
          if (!isActiveRun) return
          const parsedInput = normalizeToolInput(event.input)
          setConversation(prev => {
            let matched = false
            const next = prev.map(item => {
              if (
                isToolCall(item)
                && (event.toolCallId ? item.id === event.toolCallId : item.name === event.toolName)
              ) {
                matched = true
                return { ...item, input: parsedInput, status: 'running' as const }
              }
              return item
            })
            if (!matched) {
              next.push({
                id: event.toolCallId ?? `tool-${Date.now()}`,
                name: event.toolName,
                input: parsedInput,
                status: 'running',
                timestamp: Date.now(),
              })
            }
            return next
          })
          break
        }

      case 'tool-result':
        {
          if (!isActiveRun) return
          setConversation(prev => {
            let matched = false
            const next = prev.map(item => {
              if (
                isToolCall(item)
                && (event.toolCallId ? item.id === event.toolCallId : item.name === event.toolName)
              ) {
                matched = true
                return {
                  ...item,
                  result: event.result as ToolUIPart['output'],
                  status: 'completed' as const,
                }
              }
              return item
            })
            if (!matched) {
              next.push({
                id: event.toolCallId ?? `tool-${Date.now()}`,
                name: event.toolName,
                input: {},
                result: event.result as ToolUIPart['output'],
                status: 'completed',
                timestamp: Date.now(),
              })
            }
            return next
          })
          break
        }

      case 'tool-permission-request': {
        if (!isActiveRun) return
        const key = event.toolCall.toolCallId
        setPendingPermissionRequests(prev => {
          const next = new Map(prev)
          next.set(key, event)
          return next
        })
        setAllPermissionRequests(prev => {
          const next = new Map(prev)
          next.set(key, event)
          return next
        })
        break
      }

      case 'tool-permission-response': {
        if (!isActiveRun) return
        setPendingPermissionRequests(prev => {
          const next = new Map(prev)
          next.delete(event.toolCallId)
          return next
        })
        setPermissionResponses(prev => {
          const next = new Map(prev)
          next.set(event.toolCallId, event.response)
          return next
        })
        break
      }

      case 'ask-human-request': {
        if (!isActiveRun) return
        const key = event.toolCallId
        setPendingAskHumanRequests(prev => {
          const next = new Map(prev)
          next.set(key, event)
          return next
        })
        break
      }

      case 'ask-human-response': {
        if (!isActiveRun) return
        setPendingAskHumanRequests(prev => {
          const next = new Map(prev)
          next.delete(event.toolCallId)
          return next
        })
        break
      }

      case 'run-stopped':
        setProcessingRunIds(prev => {
          const next = new Set(prev)
          next.delete(event.runId)
          return next
        })
        clearStreamingBuffer(event.runId)
        if (!isActiveRun) return
        setIsProcessing(false)
        setIsStopping(false)
        setStopClickedAt(null)
        // Clear pending requests since they've been aborted
        setPendingPermissionRequests(new Map())
        setPendingAskHumanRequests(new Map())
        // Flush any streaming content as a message
        setCurrentAssistantMessage(currentMsg => {
          if (currentMsg) {
            setConversation(prev => [...prev, {
              id: `assistant-stopped-${Date.now()}`,
              role: 'assistant',
              content: currentMsg,
              timestamp: Date.now(),
            }])
          }
          return ''
        })
        setCurrentReasoning('')
        break

      case 'error':
        setProcessingRunIds(prev => {
          const next = new Set(prev)
          next.delete(event.runId)
          return next
        })
        clearStreamingBuffer(event.runId)
        if (!isActiveRun) return
        setIsProcessing(false)
        setIsStopping(false)
        setStopClickedAt(null)
        console.error('Run error:', event.error)
        break
    }
  }

  const handlePromptSubmit = async (message: PromptInputMessage, mentions?: FileMention[]) => {
    if (isProcessing) return

    const { text } = message;
    const userMessage = text.trim()
    if (!userMessage) return

    setMessage('')

    const userMessageId = `user-${Date.now()}`
    setConversation(prev => [...prev, {
      id: userMessageId,
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    }])

    try {
      let currentRunId = runId
      let isNewRun = false
      if (!currentRunId) {
        const run = await window.ipc.invoke('runs:create', {
          agentId,
        })
        currentRunId = run.id
        setRunId(currentRunId)
        isNewRun = true
      }

      // Read mentioned file contents and format message with XML context
      let formattedMessage = userMessage
      if (mentions && mentions.length > 0) {
        const attachedFiles = await Promise.all(
          mentions.map(async (m) => {
            try {
              const result = await window.ipc.invoke('workspace:readFile', { path: m.path })
              return { path: m.path, content: result.data as string }
            } catch (err) {
              console.error('Failed to read mentioned file:', m.path, err)
              return { path: m.path, content: `[Error reading file: ${m.path}]` }
            }
          })
        )

        if (attachedFiles.length > 0) {
          const filesXml = attachedFiles
            .map(f => `<file path="${f.path}">\n${f.content}\n</file>`)
            .join('\n')
          formattedMessage = `<attached-files>\n${filesXml}\n</attached-files>\n\n${userMessage}`
        }
      }

      await window.ipc.invoke('runs:createMessage', {
        runId: currentRunId,
        message: formattedMessage,
      })

      // Refresh runs list after message is sent (so title is available)
      if (isNewRun) {
        loadRuns()
      }
    } catch (error) {
      console.error('Failed to send message:', error)
    }
  }

  const handleStop = useCallback(async () => {
    if (!runId) return
    const now = Date.now()
    const isForce = isStopping && stopClickedAt !== null && (now - stopClickedAt) < 2000

    setStopClickedAt(now)
    setIsStopping(true)

    try {
      await window.ipc.invoke('runs:stop', { runId, force: isForce })
    } catch (error) {
      console.error('Failed to stop run:', error)
    }
  }, [runId, isStopping, stopClickedAt])

  const handlePermissionResponse = useCallback(async (toolCallId: string, subflow: string[], response: 'approve' | 'deny') => {
    if (!runId) return
    
    // Optimistically update the UI immediately
    setPermissionResponses(prev => {
      const next = new Map(prev)
      next.set(toolCallId, response)
      return next
    })
    setPendingPermissionRequests(prev => {
      const next = new Map(prev)
      next.delete(toolCallId)
      return next
    })
    
    try {
      await window.ipc.invoke('runs:authorizePermission', {
        runId,
        authorization: { subflow, toolCallId, response }
      })
    } catch (error) {
      console.error('Failed to authorize permission:', error)
      // Revert the optimistic update on error
      setPermissionResponses(prev => {
        const next = new Map(prev)
        next.delete(toolCallId)
        return next
      })
    }
  }, [runId])

  const handleAskHumanResponse = useCallback(async (toolCallId: string, subflow: string[], response: string) => {
    if (!runId) return
    try {
      await window.ipc.invoke('runs:provideHumanInput', {
        runId,
        reply: { subflow, toolCallId, response }
      })
    } catch (error) {
      console.error('Failed to provide human input:', error)
    }
  }, [runId])

  const handleNewChat = useCallback(() => {
    // Invalidate any in-flight run loads (rapid switching can otherwise "pop" old conversations back in)
    loadRunRequestIdRef.current += 1
    setConversation([])
    setCurrentAssistantMessage('')
    setCurrentReasoning('')
    setRunId(null)
    setMessage('')
    setModelUsage(null)
    setIsProcessing(false)
    setPendingPermissionRequests(new Map())
    setPendingAskHumanRequests(new Map())
    setAllPermissionRequests(new Map())
    setPermissionResponses(new Map())
    setSelectedBackgroundTask(null)
  }, [])

  const handleChatInputSubmit = (text: string) => {
    setIsChatSidebarOpen(true)
    // Submit immediately - the sidebar will open and show the message
    handlePromptSubmit({ text, files: [] })
  }

  const handleOpenFullScreenChat = useCallback(() => {
    // Remember where we came from so the close button can return
    if (selectedPath || isGraphOpen) {
      setExpandedFrom({ path: selectedPath, graph: isGraphOpen })
    }
    // Copy sidebar input text to full-screen input (keep sidebar message intact for return)
    if (message.trim()) {
      setPresetMessage(message)
    }
    setSelectedPath(null)
    setIsGraphOpen(false)
  }, [selectedPath, isGraphOpen, message])

  const handleCloseFullScreenChat = useCallback(() => {
    if (expandedFrom) {
      if (expandedFrom.graph) {
        setIsGraphOpen(true)
      } else if (expandedFrom.path) {
        setSelectedPath(expandedFrom.path)
      }
      setExpandedFrom(null)
    }
  }, [expandedFrom])

  const setHistory = useCallback((next: { back: ViewState[]; forward: ViewState[] }) => {
    historyRef.current = next
    setViewHistory(next)
  }, [])

  const currentViewState = React.useMemo<ViewState>(() => {
    if (selectedBackgroundTask) return { type: 'task', name: selectedBackgroundTask }
    if (selectedPath) return { type: 'file', path: selectedPath }
    if (isGraphOpen) return { type: 'graph' }
    return { type: 'chat', runId }
  }, [selectedBackgroundTask, selectedPath, isGraphOpen, runId])

  const appendUnique = useCallback((stack: ViewState[], entry: ViewState) => {
    const last = stack[stack.length - 1]
    if (last && viewStatesEqual(last, entry)) return stack
    return [...stack, entry]
  }, [])

  const applyViewState = useCallback(async (view: ViewState) => {
    switch (view.type) {
      case 'file':
        setSelectedBackgroundTask(null)
        setIsGraphOpen(false)
        setExpandedFrom(null)
        setSelectedPath(view.path)
        return
      case 'graph':
        setSelectedBackgroundTask(null)
        setSelectedPath(null)
        setExpandedFrom(null)
        setIsGraphOpen(true)
        return
      case 'task':
        setSelectedPath(null)
        setIsGraphOpen(false)
        setExpandedFrom(null)
        setSelectedBackgroundTask(view.name)
        return
      case 'chat':
        setSelectedPath(null)
        setIsGraphOpen(false)
        setExpandedFrom(null)
        setSelectedBackgroundTask(null)
        if (view.runId) {
          await loadRun(view.runId)
        } else {
          handleNewChat()
        }
        return
    }
  }, [handleNewChat, loadRun])

  const navigateToView = useCallback(async (nextView: ViewState) => {
    const current = currentViewState
    if (viewStatesEqual(current, nextView)) return

    const nextHistory = {
      back: appendUnique(historyRef.current.back, current),
      forward: [] as ViewState[],
    }
    setHistory(nextHistory)
    await applyViewState(nextView)
  }, [appendUnique, applyViewState, currentViewState, setHistory])

  const navigateBack = useCallback(async () => {
    const { back, forward } = historyRef.current
    if (back.length === 0) return

    let i = back.length - 1
    while (i >= 0 && viewStatesEqual(back[i], currentViewState)) i -= 1
    if (i < 0) {
      setHistory({ back: [], forward })
      return
    }

    const target = back[i]
    const nextHistory = {
      back: back.slice(0, i),
      forward: appendUnique(forward, currentViewState),
    }
    setHistory(nextHistory)
    await applyViewState(target)
  }, [appendUnique, applyViewState, currentViewState, setHistory])

  const navigateForward = useCallback(async () => {
    const { back, forward } = historyRef.current
    if (forward.length === 0) return

    let i = forward.length - 1
    while (i >= 0 && viewStatesEqual(forward[i], currentViewState)) i -= 1
    if (i < 0) {
      setHistory({ back, forward: [] })
      return
    }

    const target = forward[i]
    const nextHistory = {
      back: appendUnique(back, currentViewState),
      forward: forward.slice(0, i),
    }
    setHistory(nextHistory)
    await applyViewState(target)
  }, [appendUnique, applyViewState, currentViewState, setHistory])

  const canNavigateBack = React.useMemo(() => {
    for (let i = viewHistory.back.length - 1; i >= 0; i--) {
      if (!viewStatesEqual(viewHistory.back[i], currentViewState)) return true
    }
    return false
  }, [viewHistory.back, currentViewState])

  const canNavigateForward = React.useMemo(() => {
    for (let i = viewHistory.forward.length - 1; i >= 0; i--) {
      if (!viewStatesEqual(viewHistory.forward[i], currentViewState)) return true
    }
    return false
  }, [viewHistory.forward, currentViewState])

  const navigateToFile = useCallback((path: string) => {
    void navigateToView({ type: 'file', path })
  }, [navigateToView])

  const navigateToFullScreenChat = useCallback(() => {
    // Only treat this as navigation when coming from another view
    if (currentViewState.type !== 'chat') {
      const nextHistory = {
        back: appendUnique(historyRef.current.back, currentViewState),
        forward: [] as ViewState[],
      }
      setHistory(nextHistory)
    }
    handleOpenFullScreenChat()
  }, [appendUnique, currentViewState, handleOpenFullScreenChat, setHistory])

  // Handle image upload for the markdown editor
  const handleImageUpload = useCallback(async (file: File): Promise<string | null> => {
    try {
      // Read file as data URL (includes mime type)
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      // Also save to .assets folder for persistence
      const timestamp = Date.now()
      const extension = file.name.split('.').pop() || 'png'
      const filename = `image-${timestamp}.${extension}`
      const assetsPath = 'knowledge/.assets'
      const imagePath = `${assetsPath}/${filename}`

      try {
        // Extract base64 data (remove data URL prefix)
        const base64Data = dataUrl.split(',')[1]
        await window.ipc.invoke('workspace:writeFile', {
          path: imagePath,
          data: base64Data,
          opts: { encoding: 'base64', mkdirp: true }
        })
      } catch (err) {
        console.error('Failed to save image to disk:', err)
        // Continue anyway - image will still display via data URL
      }

      // Return data URL for immediate display in editor
      return dataUrl
    } catch (error) {
      console.error('Failed to upload image:', error)
      return null
    }
  }, [])

  // Keyboard shortcut: Ctrl+L to toggle main chat view
  const isFullScreenChat = !selectedPath && !isGraphOpen && !selectedBackgroundTask
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault()
        if (isFullScreenChat && expandedFrom) {
          handleCloseFullScreenChat()
        } else {
          navigateToFullScreenChat()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleCloseFullScreenChat, isFullScreenChat, expandedFrom, navigateToFullScreenChat])

  const toggleExpand = (path: string, kind: 'file' | 'dir') => {
    if (kind === 'file') {
      navigateToFile(path)
      return
    }

    const newExpanded = new Set(expandedPaths)
    if (newExpanded.has(path)) {
      newExpanded.delete(path)
    } else {
      newExpanded.add(path)
    }
    setExpandedPaths(newExpanded)
  }

  // Handle sidebar section changes - switch to chat view for tasks
  const handleSectionChange = useCallback((section: ActiveSection) => {
    if (section === 'tasks') {
      if (selectedBackgroundTask) return
      if (selectedPath || isGraphOpen) {
        void navigateToView({ type: 'chat', runId })
      }
    }
  }, [isGraphOpen, navigateToView, runId, selectedBackgroundTask, selectedPath])

  // Knowledge quick actions
  const knowledgeFiles = React.useMemo(() => {
    const files = collectFilePaths(tree).filter((path) => path.endsWith('.md'))
    return Array.from(new Set(files.map(stripKnowledgePrefix)))
  }, [tree])
  const knowledgeFilePaths = React.useMemo(() => (
    knowledgeFiles.reduce<string[]>((acc, filePath) => {
      const resolved = toKnowledgePath(filePath)
      if (resolved) acc.push(resolved)
      return acc
    }, [])
  ), [knowledgeFiles])

  // Compute visible files (files whose parent directories are expanded)
  const visibleKnowledgeFiles = React.useMemo(() => {
    const visible: string[] = []
    const isPathVisible = (path: string) => {
      const parts = path.split('/')
      // Root level files in knowledge are always visible
      if (parts.length <= 2) return true
      // Check if all parent directories are expanded
      for (let i = 1; i < parts.length - 1; i++) {
        const parentPath = parts.slice(0, i + 1).join('/')
        if (!expandedPaths.has(parentPath)) return false
      }
      return true
    }

    for (const file of knowledgeFiles) {
      const fullPath = toKnowledgePath(file)
      if (fullPath && isPathVisible(fullPath)) {
        visible.push(file)
      }
    }
    return visible
  }, [knowledgeFiles, expandedPaths])

  // Load workspace root on mount
  useEffect(() => {
    window.ipc.invoke('workspace:getRoot', null).then(result => {
      setWorkspaceRoot(result.root)
    })
  }, [])

  // Check onboarding status on mount
  useEffect(() => {
    async function checkOnboarding() {
      try {
        const result = await window.ipc.invoke('onboarding:getStatus', null)
        setShowOnboarding(result.showOnboarding)
      } catch (err) {
        console.error('Failed to check onboarding status:', err)
      }
    }
    checkOnboarding()
  }, [])

  // Handler for onboarding completion
  const handleOnboardingComplete = useCallback(async () => {
    try {
      await window.ipc.invoke('onboarding:markComplete', null)
      setShowOnboarding(false)
    } catch (err) {
      console.error('Failed to mark onboarding complete:', err)
      setShowOnboarding(false)
    }
  }, [])

  const knowledgeActions = React.useMemo(() => ({
    createNote: async (parentPath: string = 'knowledge') => {
      try {
        let index = 0
        let name = untitledBaseName
        let fullPath = `${parentPath}/${name}.md`
        while (index < 1000) {
          const exists = await window.ipc.invoke('workspace:exists', { path: fullPath })
          if (!exists.exists) break
          index += 1
          name = `${untitledBaseName}-${index}`
          fullPath = `${parentPath}/${name}.md`
        }
        await window.ipc.invoke('workspace:writeFile', {
          path: fullPath,
          data: `# ${name}\n\n`,
          opts: { encoding: 'utf8' }
        })
        navigateToFile(fullPath)
      } catch (err) {
        console.error('Failed to create note:', err)
        throw err
      }
    },
    createFolder: async (parentPath: string = 'knowledge') => {
      try {
        await window.ipc.invoke('workspace:mkdir', {
          path: `${parentPath}/new-folder-${Date.now()}`,
          recursive: true
        })
      } catch (err) {
        console.error('Failed to create folder:', err)
        throw err
      }
    },
    openGraph: () => {
      void navigateToView({ type: 'graph' })
    },
    expandAll: () => setExpandedPaths(new Set(collectDirPaths(tree))),
    collapseAll: () => setExpandedPaths(new Set()),
    rename: async (oldPath: string, newName: string, isDir: boolean) => {
      try {
        const parts = oldPath.split('/')
        // For files, ensure .md extension
        const finalName = isDir ? newName : (newName.endsWith('.md') ? newName : `${newName}.md`)
        parts[parts.length - 1] = finalName
        const newPath = parts.join('/')
        await window.ipc.invoke('workspace:rename', { from: oldPath, to: newPath })
        if (selectedPath === oldPath) setSelectedPath(newPath)
      } catch (err) {
        console.error('Failed to rename:', err)
        throw err
      }
    },
    remove: async (path: string) => {
      try {
        await window.ipc.invoke('workspace:remove', { path, opts: { trash: true } })
        if (selectedPath === path) setSelectedPath(null)
      } catch (err) {
        console.error('Failed to remove:', err)
        throw err
      }
    },
    copyPath: (path: string) => {
      const fullPath = workspaceRoot ? `${workspaceRoot}/${path}` : path
      navigator.clipboard.writeText(fullPath)
    },
  }), [tree, selectedPath, workspaceRoot, collectDirPaths, navigateToFile, navigateToView])

  // Handler for when a voice note is created/updated
  const handleVoiceNoteCreated = useCallback(async (notePath: string) => {
    // Refresh the tree to show the new file/folder
    const newTree = await loadDirectory()
    setTree(newTree)

    // Expand parent directories to show the file
    const parts = notePath.split('/')
    const parentPaths: string[] = []
    for (let i = 1; i < parts.length; i++) {
      parentPaths.push(parts.slice(0, i).join('/'))
    }
    setExpandedPaths(prev => {
      const newSet = new Set(prev)
      parentPaths.forEach(p => newSet.add(p))
      return newSet
    })

    // Select the file to show it in the editor
    navigateToFile(notePath)
  }, [loadDirectory, navigateToFile])

  const ensureWikiFile = useCallback(async (wikiPath: string) => {
    const resolvedPath = toKnowledgePath(wikiPath)
    if (!resolvedPath) return null
    try {
      const exists = await window.ipc.invoke('workspace:exists', { path: resolvedPath })
      if (!exists.exists) {
        const title = wikiLabel(wikiPath) || 'New Note'
        await window.ipc.invoke('workspace:writeFile', {
          path: resolvedPath,
          data: `# ${title}\n\n`,
          opts: { encoding: 'utf8', mkdirp: true },
        })
      }
      return resolvedPath
    } catch (err) {
      console.error('Failed to ensure wiki link target:', err)
      return null
    }
  }, [])

  const openWikiLink = useCallback(async (wikiPath: string) => {
    const resolvedPath = await ensureWikiFile(wikiPath)
    if (resolvedPath) {
      navigateToFile(resolvedPath)
    }
  }, [ensureWikiFile, navigateToFile])

  const wikiLinkConfig = React.useMemo(() => ({
    files: knowledgeFiles,
    recent: recentWikiFiles,
    onOpen: (path: string) => {
      void openWikiLink(path)
    },
    onCreate: (path: string) => {
      void ensureWikiFile(path)
    },
  }), [knowledgeFiles, recentWikiFiles, openWikiLink, ensureWikiFile])

  useEffect(() => {
    if (!isGraphOpen) return
    let cancelled = false

    const buildGraph = async () => {
      setGraphStatus('loading')
      setGraphError(null)

      if (knowledgeFilePaths.length === 0) {
        setGraphData({ nodes: [], edges: [] })
        setGraphStatus('ready')
        return
      }

      const nodeSet = new Set(knowledgeFilePaths)
      const edges: GraphEdge[] = []
      const edgeKeys = new Set<string>()

      const contents = await Promise.all(
        knowledgeFilePaths.map(async (path) => {
          try {
            const result = await window.ipc.invoke('workspace:readFile', { path })
            return { path, data: result.data as string }
          } catch (err) {
            console.error('Failed to read file for graph:', path, err)
            return { path, data: '' }
          }
        })
      )

      for (const { path, data } of contents) {
        for (const match of data.matchAll(wikiLinkRegex)) {
          const rawTarget = match[1]?.trim() ?? ''
          const targetPath = toKnowledgePath(rawTarget)
          if (!targetPath || targetPath === path) continue
          if (!nodeSet.has(targetPath)) continue
          const edgeKey = path < targetPath ? `${path}|${targetPath}` : `${targetPath}|${path}`
          if (edgeKeys.has(edgeKey)) continue
          edgeKeys.add(edgeKey)
          edges.push({ source: path, target: targetPath })
        }
      }

      const degreeMap = new Map<string, number>()
      edges.forEach((edge) => {
        degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1)
        degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1)
      })

      const groupIndexMap = new Map<string, number>()
      const getGroupIndex = (group: string) => {
        const existing = groupIndexMap.get(group)
        if (existing !== undefined) return existing
        const nextIndex = groupIndexMap.size
        groupIndexMap.set(group, nextIndex)
        return nextIndex
      }
      const getNodeGroup = (path: string) => {
        const normalized = stripKnowledgePrefix(path)
        const parts = normalized.split('/').filter(Boolean)
        if (parts.length <= 1) {
          return { group: 'root', depth: 0 }
        }
        return {
          group: parts[0],
          depth: Math.max(0, parts.length - 2),
        }
      }
      const getNodeColors = (groupIndex: number, depth: number) => {
        const base = graphPalette[groupIndex % graphPalette.length]
        const light = clampNumber(base.light + depth * 6, 36, 72)
        const strokeLight = clampNumber(light - 12, 28, 60)
        return {
          fill: `hsl(${base.hue} ${base.sat}% ${light}%)`,
          stroke: `hsl(${base.hue} ${Math.min(80, base.sat + 8)}% ${strokeLight}%)`,
        }
      }

      const nodes = knowledgeFilePaths.map((path) => {
        const degree = degreeMap.get(path) ?? 0
        const radius = 6 + Math.min(18, degree * 2)
        const { group, depth } = getNodeGroup(path)
        const groupIndex = getGroupIndex(group)
        const colors = getNodeColors(groupIndex, depth)
        return {
          id: path,
          label: wikiLabel(path) || path,
          degree,
          radius,
          group,
          color: colors.fill,
          stroke: colors.stroke,
        }
      })

      if (!cancelled) {
        setGraphData({ nodes, edges })
        setGraphStatus('ready')
      }
    }

    buildGraph().catch((err) => {
      if (cancelled) return
      console.error('Failed to build graph:', err)
      setGraphStatus('error')
      setGraphError(err instanceof Error ? err.message : 'Failed to build graph')
    })

    return () => {
      cancelled = true
    }
  }, [isGraphOpen, knowledgeFilePaths])

  const renderConversationItem = (item: ConversationItem) => {
    if (isChatMessage(item)) {
      if (item.role === 'user') {
        const { message, files } = parseAttachedFiles(item.content)
        return (
          <Message key={item.id} from={item.role}>
            <MessageContent>
              {files.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {files.map((filePath, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full"
                    >
                      @{wikiLabel(filePath)}
                    </span>
                  ))}
                </div>
              )}
              {message}
            </MessageContent>
          </Message>
        )
      }
      return (
        <Message key={item.id} from={item.role}>
          <MessageContent>
            <MessageResponse components={streamdownComponents}>{item.content}</MessageResponse>
          </MessageContent>
        </Message>
      )
    }

    if (isToolCall(item)) {
      const errorText = item.status === 'error' ? 'Tool error' : ''
      const output = normalizeToolOutput(item.result, item.status)
      const input = normalizeToolInput(item.input)
      return (
        <Tool key={item.id}>
          <ToolHeader
            title={item.name}
            type={`tool-${item.name}`}
            state={toToolState(item.status)}
          />
          <ToolContent>
            <ToolInput input={input} />
            {output !== null ? (
              <ToolOutput output={output} errorText={errorText} />
            ) : null}
          </ToolContent>
        </Tool>
      )
    }

    if (isReasoningBlock(item)) {
      return (
        <Reasoning key={item.id}>
          <ReasoningTrigger />
          <ReasoningContent>{item.content}</ReasoningContent>
        </Reasoning>
      )
    }

    return null
  }

  const hasConversation = conversation.length > 0 || currentAssistantMessage || currentReasoning
  const conversationContentClassName = hasConversation
    ? "mx-auto w-full max-w-4xl pb-28"
    : "mx-auto w-full max-w-4xl min-h-full items-center justify-center pb-0"
  const headerTitle = selectedPath
    ? selectedPath
    : isGraphOpen
      ? 'Graph View'
      : selectedBackgroundTask
        ? `Background Task: ${selectedBackgroundTask}`
        : 'Chat'
  const selectedTask = selectedBackgroundTask
    ? backgroundTasks.find(t => t.name === selectedBackgroundTask)
    : null

  return (
    <TooltipProvider delayDuration={0}>
      <SidebarSectionProvider defaultSection="tasks" onSectionChange={handleSectionChange}>
        <div className="flex h-svh w-full">
          {/* Content sidebar with SidebarProvider for collapse functionality */}
          <SidebarProvider
            style={{
              "--sidebar-width": `${DEFAULT_SIDEBAR_WIDTH}px`,
            } as React.CSSProperties}
          >
            <SidebarContentPanel
              tree={tree}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onSelectFile={toggleExpand}
              knowledgeActions={knowledgeActions}
              onVoiceNoteCreated={handleVoiceNoteCreated}
              runs={runs}
              currentRunId={runId}
              processingRunIds={processingRunIds}
              tasksActions={{
                onNewChat: () => {
                  void navigateToView({ type: 'chat', runId: null })
                },
                onSelectRun: (runIdToLoad) => {
                  void navigateToView({ type: 'chat', runId: runIdToLoad })
                },
                onSelectBackgroundTask: (taskName) => {
                  void navigateToView({ type: 'task', name: taskName })
                },
              }}
              backgroundTasks={backgroundTasks}
              selectedBackgroundTask={selectedBackgroundTask}
            />
            <SidebarInset className="overflow-hidden! min-h-0">
              {/* Header - also serves as titlebar drag region, adjusts padding when sidebar collapsed */}
              <ContentHeader
                onNavigateBack={() => { void navigateBack() }}
                onNavigateForward={() => { void navigateForward() }}
                canNavigateBack={canNavigateBack}
                canNavigateForward={canNavigateForward}
                collapsedLeftPaddingPx={collapsedLeftPaddingPx}
              >
                <span className="text-sm font-medium text-muted-foreground flex-1 min-w-0 truncate">
                  {headerTitle}
                </span>
                {selectedPath && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    {isSaving ? (
                      <>
                        <LoaderIcon className="h-3 w-3 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : lastSaved ? (
                      <>
                        <CheckIcon className="h-3 w-3 text-green-500" />
                        <span>Saved</span>
                      </>
                    ) : null}
                  </div>
                )}
                {!selectedPath && isGraphOpen && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { void navigateToView({ type: 'chat', runId }) }}
                    className="titlebar-no-drag text-foreground"
                  >
                    Close Graph
                  </Button>
                )}
                {!selectedPath && !isGraphOpen && expandedFrom && (
                  <button
                    type="button"
                    onClick={handleCloseFullScreenChat}
                    className="titlebar-no-drag flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    aria-label="Return to file"
                  >
                    <X className="size-5" />
                  </button>
                )}
                {(selectedPath || isGraphOpen) && (
                  <button
                    type="button"
                    onClick={() => setIsChatSidebarOpen(!isChatSidebarOpen)}
                    className="titlebar-no-drag flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors -mr-1"
                    aria-label="Toggle Chat Sidebar"
                  >
                    <PanelRightIcon className="size-5" />
                  </button>
                )}
              </ContentHeader>

              {isGraphOpen ? (
                <div className="flex-1 min-h-0">
                  <GraphView
                    nodes={graphData.nodes}
                    edges={graphData.edges}
                    isLoading={graphStatus === 'loading'}
                    error={graphStatus === 'error' ? (graphError ?? 'Failed to build graph') : null}
                    onSelectNode={(path) => {
                      navigateToFile(path)
                    }}
                  />
                </div>
              ) : selectedPath ? (
                selectedPath.endsWith('.md') ? (
                  <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    <MarkdownEditor
                      content={editorContent}
                      onChange={handleEditorChange}
                      placeholder="Start writing..."
                      wikiLinks={wikiLinkConfig}
                      onImageUpload={handleImageUpload}
                    />
                  </div>
                ) : (
                  <div className="flex-1 overflow-auto p-4">
                    <pre className="text-sm font-mono text-foreground whitespace-pre-wrap">
                      {fileContent || 'Loading...'}
                    </pre>
                  </div>
                )
              ) : selectedTask ? (
                <div className="flex-1 min-h-0 overflow-hidden">
                  <BackgroundTaskDetail
                    name={selectedTask.name}
                    description={selectedTask.description}
                    schedule={selectedTask.schedule}
                    enabled={selectedTask.enabled}
                    status={selectedTask.status}
                    nextRunAt={selectedTask.nextRunAt}
                    lastRunAt={selectedTask.lastRunAt}
                    lastError={selectedTask.lastError}
                    runCount={selectedTask.runCount}
                    onToggleEnabled={(enabled) => handleToggleBackgroundTask(selectedTask.name, enabled)}
                  />
                </div>
              ) : (
              <FileCardProvider onOpenKnowledgeFile={(path) => { navigateToFile(path) }}>
              <div className="flex min-h-0 flex-1 flex-col">
                <Conversation className="relative flex-1 overflow-y-auto [scrollbar-gutter:stable]">
                  <ScrollPositionPreserver />
                  <ConversationContent className={conversationContentClassName}>
                    {!hasConversation ? (
                      <ConversationEmptyState className="h-auto">
                        <div className="text-2xl font-semibold tracking-tight text-foreground/80 sm:text-3xl md:text-4xl">
                          What are we working on?
                        </div>
                      </ConversationEmptyState>
                    ) : (
                      <>
                        {conversation.map(item => {
                          const rendered = renderConversationItem(item)
                          // If this is a tool call, check for permission request (pending or responded)
                          if (isToolCall(item)) {
                            const permRequest = allPermissionRequests.get(item.id)
                            if (permRequest) {
                              const response = permissionResponses.get(item.id) || null
                              return (
                                <React.Fragment key={item.id}>
                                  {rendered}
                                  <PermissionRequest
                                    toolCall={permRequest.toolCall}
                                    onApprove={() => handlePermissionResponse(permRequest.toolCall.toolCallId, permRequest.subflow, 'approve')}
                                    onDeny={() => handlePermissionResponse(permRequest.toolCall.toolCallId, permRequest.subflow, 'deny')}
                                    isProcessing={isProcessing}
                                    response={response}
                                  />
                                </React.Fragment>
                              )
                            }
                          }
                          return rendered
                        })}

                        {/* Render pending ask-human requests */}
                        {Array.from(pendingAskHumanRequests.values()).map((request) => (
                          <AskHumanRequest
                            key={request.toolCallId}
                            query={request.query}
                            onResponse={(response) => handleAskHumanResponse(request.toolCallId, request.subflow, response)}
                            isProcessing={isProcessing}
                          />
                        ))}

                        {currentReasoning && (
                          <Reasoning isStreaming>
                            <ReasoningTrigger />
                            <ReasoningContent>{currentReasoning}</ReasoningContent>
                          </Reasoning>
                        )}

                        {currentAssistantMessage && (
                          <Message from="assistant">
                            <MessageContent>
                              <MessageResponse components={streamdownComponents}>{currentAssistantMessage}</MessageResponse>
                            </MessageContent>
                          </Message>
                        )}

                        {isProcessing && !currentAssistantMessage && !currentReasoning && (
                          <Message from="assistant">
                            <MessageContent>
                              <Shimmer duration={1}>Thinking...</Shimmer>
                            </MessageContent>
                          </Message>
                        )}
                      </>
                    )}
                  </ConversationContent>
                </Conversation>

                <div className="sticky bottom-0 z-10 bg-background pb-12 pt-0 shadow-lg">
                  <div className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-linear-to-t from-background to-transparent" />
                  <div className="mx-auto w-full max-w-4xl px-4">
                    {!hasConversation && (
                      <Suggestions onSelect={setPresetMessage} className="mb-3 justify-center" />
                    )}
                    <ChatInputWithMentions
                      knowledgeFiles={knowledgeFiles}
                      recentFiles={recentWikiFiles}
                      visibleFiles={visibleKnowledgeFiles}
                      onSubmit={handlePromptSubmit}
                      onStop={handleStop}
                      isProcessing={isProcessing}
                      isStopping={isStopping}
                      presetMessage={presetMessage}
                      onPresetMessageConsumed={() => setPresetMessage(undefined)}
                      runId={runId}
                    />
                  </div>
                </div>
              </div>
              </FileCardProvider>
              )}
            </SidebarInset>

            {/* Chat sidebar - shown when viewing files/graph */}
            {(selectedPath || isGraphOpen) && (
              <ChatSidebar
                defaultWidth={400}
                isOpen={isChatSidebarOpen}
                onNewChat={handleNewChat}
                onOpenFullScreen={navigateToFullScreenChat}
                conversation={conversation}
                currentAssistantMessage={currentAssistantMessage}
                currentReasoning={currentReasoning}
                isProcessing={isProcessing}
                isStopping={isStopping}
                onStop={handleStop}
                message={message}
                onMessageChange={setMessage}
                onSubmit={handlePromptSubmit}
                knowledgeFiles={knowledgeFiles}
                recentFiles={recentWikiFiles}
                visibleFiles={visibleKnowledgeFiles}
                selectedPath={selectedPath}
                pendingPermissionRequests={pendingPermissionRequests}
                pendingAskHumanRequests={pendingAskHumanRequests}
                allPermissionRequests={allPermissionRequests}
                permissionResponses={permissionResponses}
                onPermissionResponse={handlePermissionResponse}
                onAskHumanResponse={handleAskHumanResponse}
                onOpenKnowledgeFile={(path) => { navigateToFile(path) }}
              />
            )}
            {/* Rendered last so its no-drag region paints over the sidebar drag region */}
            <FixedSidebarToggle
              onNavigateBack={() => { void navigateBack() }}
              onNavigateForward={() => { void navigateForward() }}
              canNavigateBack={canNavigateBack}
              canNavigateForward={canNavigateForward}
              onNewChat={handleNewChat}
              leftInsetPx={isMac ? MACOS_TRAFFIC_LIGHTS_RESERVED_PX : 0}
            />
          </SidebarProvider>

          {/* Floating chat input - shown when viewing files/graph and chat sidebar is closed */}
          {(selectedPath || isGraphOpen) && !isChatSidebarOpen && (
            <ChatInputBar
              onSubmit={handleChatInputSubmit}
              onOpen={() => setIsChatSidebarOpen(true)}
            />
          )}
        </div>
      </SidebarSectionProvider>
      <Toaster />
      <OnboardingModal
        open={showOnboarding}
        onComplete={handleOnboardingComplete}
      />
    </TooltipProvider>
  )
}

export default App
