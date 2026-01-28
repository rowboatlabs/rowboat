import * as React from 'react'
import { useCallback, useEffect, useState, useRef } from 'react'
import { workspace } from '@x/shared';
import { RunEvent, ListRunsResponse } from '@x/shared/src/runs.js';
import type { LanguageModelUsage, ToolUIPart } from 'ai';
import './App.css'
import z from 'zod';
import { Button } from './components/ui/button';
import { CheckIcon, LoaderIcon, ArrowUp, PanelRightIcon, SquarePen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarkdownEditor } from './components/markdown-editor';
import { ChatInputBar } from './components/chat-button';
import { ChatSidebar } from './components/chat-sidebar';
import { GraphView, type GraphEdge, type GraphNode } from '@/components/graph-view';
import { useDebounce } from './hooks/use-debounce';
import { SidebarIcon } from '@/components/sidebar-icon';
import { SidebarContentPanel } from '@/components/sidebar-content';
import { SidebarSectionProvider, type ActiveSection } from '@/contexts/sidebar-context';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
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
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Separator } from "@/components/ui/separator"
import { Toaster } from "@/components/ui/sonner"
import { stripKnowledgePrefix, toKnowledgePath, wikiLabel } from '@/lib/wiki-links'
import { OnboardingModal } from '@/components/onboarding-modal'

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
  isProcessing: boolean
  presetMessage?: string
  onPresetMessageConsumed?: () => void
  runId?: string | null
}

function ChatInputInner({
  onSubmit,
  isProcessing,
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

  return (
    <div className="flex items-center gap-2 bg-background border border-border rounded-3xl shadow-xl px-4 py-2.5">
      <PromptInputTextarea
        placeholder="Type your message..."
        onKeyDown={handleKeyDown}
        autoFocus
        focusTrigger={runId}
        className="min-h-6 py-0 border-0 shadow-none focus-visible:ring-0 rounded-none"
      />
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
    </div>
  )
}

// Wrapper component with PromptInputProvider
interface ChatInputWithMentionsProps {
  knowledgeFiles: string[]
  recentFiles: string[]
  visibleFiles: string[]
  onSubmit: (message: PromptInputMessage, mentions?: FileMention[]) => void
  isProcessing: boolean
  presetMessage?: string
  onPresetMessageConsumed?: () => void
  runId?: string | null
}

function ChatInputWithMentions({
  knowledgeFiles,
  recentFiles,
  visibleFiles,
  onSubmit,
  isProcessing,
  presetMessage,
  onPresetMessageConsumed,
  runId,
}: ChatInputWithMentionsProps) {
  return (
    <PromptInputProvider knowledgeFiles={knowledgeFiles} recentFiles={recentFiles} visibleFiles={visibleFiles}>
      <ChatInputInner
        onSubmit={onSubmit}
        isProcessing={isProcessing}
        presetMessage={presetMessage}
        onPresetMessageConsumed={onPresetMessageConsumed}
        runId={runId}
      />
    </PromptInputProvider>
  )
}

function App() {
  // File browser state (for Knowledge section)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [fileHistoryBack, setFileHistoryBack] = useState<string[]>([])
  const [fileHistoryForward, setFileHistoryForward] = useState<string[]>([])
  const [fileContent, setFileContent] = useState<string>('')
  const [editorContent, setEditorContent] = useState<string>('')
  const [tree, setTree] = useState<TreeNode[]>([])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [recentWikiFiles, setRecentWikiFiles] = useState<string[]>([])
  const [isGraphOpen, setIsGraphOpen] = useState(false)
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({
    nodes: [],
    edges: [],
  })
  const [graphStatus, setGraphStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [graphError, setGraphError] = useState<string | null>(null)
  const [isChatSidebarOpen, setIsChatSidebarOpen] = useState(true)

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
  const [isProcessing, setIsProcessing] = useState(false)
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

  // Keep runIdRef in sync with runId state (for use in event handlers to avoid stale closures)
  useEffect(() => {
    runIdRef.current = runId
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

      // Reload current file if it was changed externally
      if (!selectedPath) return

      const changedPath = event.type === 'changed' ? event.path : null
      const changedPaths = (event.type === 'bulkChanged' ? event.paths : []) ?? []

      const isCurrentFileChanged =
        changedPath === selectedPath || changedPaths.includes(selectedPath)

      if (isCurrentFileChanged) {
        // Only reload if no unsaved edits
        if (editorContent === initialContentRef.current) {
          const result = await window.ipc.invoke('workspace:readFile', { path: selectedPath })
          setFileContent(result.data)
          setEditorContent(result.data)
          initialContentRef.current = result.data
        }
      }
    })
    return cleanup
  }, [loadDirectory, selectedPath, editorContent])

  // Load file content when selected
  useEffect(() => {
    if (!selectedPath) {
      setFileContent('')
      setEditorContent('')
      initialContentRef.current = ''
      setLastSaved(null)
      return
    }
    (async () => {
      try {
        const stat = await window.ipc.invoke('workspace:stat', { path: selectedPath })
        if (stat.kind === 'file') {
          const result = await window.ipc.invoke('workspace:readFile', { path: selectedPath })
          setFileContent(result.data)
          setEditorContent(result.data)
          initialContentRef.current = result.data
          setLastSaved(null)
        } else {
          setFileContent('')
          setEditorContent('')
          initialContentRef.current = ''
        }
      } catch (err) {
        console.error('Failed to load file:', err)
        setFileContent('')
        setEditorContent('')
        initialContentRef.current = ''
      }
    })()
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
    if (!selectedPath || !selectedPath.endsWith('.md')) return
    if (debouncedContent === initialContentRef.current) return
    if (!debouncedContent) return

    const saveFile = async () => {
      setIsSaving(true)
      let pathToSave = selectedPath
      try {
        if (!renameInProgressRef.current && selectedPath.startsWith('knowledge/')) {
          const headingTitle = getHeadingTitle(debouncedContent)
          const desiredName = headingTitle ? sanitizeHeadingForFilename(headingTitle) : null
          const currentBase = getBaseName(selectedPath)
          if (desiredName && desiredName !== currentBase) {
            const parentDir = selectedPath.split('/').slice(0, -1).join('/')
            const targetPath = `${parentDir}/${desiredName}.md`
            if (targetPath !== selectedPath) {
              const exists = await window.ipc.invoke('workspace:exists', { path: targetPath })
              if (!exists.exists) {
                renameInProgressRef.current = true
                await window.ipc.invoke('workspace:rename', { from: selectedPath, to: targetPath })
                pathToSave = targetPath
                setSelectedPath(targetPath)
              }
            }
          }
        }
        await window.ipc.invoke('workspace:writeFile', {
          path: pathToSave,
          data: debouncedContent,
          opts: { encoding: 'utf8' }
        })
        initialContentRef.current = debouncedContent
        setLastSaved(new Date())
      } catch (err) {
        console.error('Failed to save file:', err)
      } finally {
        renameInProgressRef.current = false
        setIsSaving(false)
      }
    }
    saveFile()
  }, [debouncedContent, selectedPath])

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

  // Load a specific run and populate conversation
  const loadRun = useCallback(async (id: string) => {
    try {
      const run = await window.ipc.invoke('runs:fetch', { runId: id })

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

      // Set the conversation and runId
      setConversation(items)
      setRunId(id)
      setCurrentAssistantMessage('')
      setCurrentReasoning('')
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

  const handleRunEvent = (event: RunEventType) => {
    // Use ref to get current runId to avoid stale closure issues
    if (event.runId !== runIdRef.current) return

    console.log('Run event:', event.type, event)

    switch (event.type) {
      case 'run-processing-start':
        setIsProcessing(true)
        setModelUsage(null)
        break

      case 'run-processing-end':
        setIsProcessing(false)
        break

      case 'start':
        setCurrentAssistantMessage('')
        setCurrentReasoning('')
        setModelUsage(null)
        break

      case 'llm-stream-event':
        {
          const llmEvent = event.event
          if (llmEvent.type === 'reasoning-delta' && llmEvent.delta) {
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
          }
        }
        break

      case 'tool-invocation':
        {
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
        const key = event.toolCallId
        setPendingAskHumanRequests(prev => {
          const next = new Map(prev)
          next.set(key, event)
          return next
        })
        break
      }

      case 'ask-human-response': {
        setPendingAskHumanRequests(prev => {
          const next = new Map(prev)
          next.delete(event.toolCallId)
          return next
        })
        break
      }

      case 'error':
        setIsProcessing(false)
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
  }, [])

  const handleChatInputSubmit = (text: string) => {
    setIsChatSidebarOpen(true)
    // Submit immediately - the sidebar will open and show the message
    handlePromptSubmit({ text, files: [] })
  }

  const handleOpenFullScreenChat = useCallback(() => {
    setSelectedPath(null)
    setIsGraphOpen(false)
  }, [])

  // File navigation with history tracking
  const navigateToFile = useCallback((path: string | null) => {
    if (path === selectedPath) return

    // Push current path to back history (if we have one)
    if (selectedPath) {
      setFileHistoryBack(prev => [...prev, selectedPath])
    }
    // Clear forward history when navigating to a new file
    setFileHistoryForward([])
    setSelectedPath(path)
  }, [selectedPath])

  const navigateBack = useCallback(() => {
    if (fileHistoryBack.length === 0) return

    const newBack = [...fileHistoryBack]
    const previousPath = newBack.pop()!

    // Push current path to forward history
    if (selectedPath) {
      setFileHistoryForward(prev => [...prev, selectedPath])
    }

    setFileHistoryBack(newBack)
    setSelectedPath(previousPath)
  }, [fileHistoryBack, selectedPath])

  const navigateForward = useCallback(() => {
    if (fileHistoryForward.length === 0) return

    const newForward = [...fileHistoryForward]
    const nextPath = newForward.pop()!

    // Push current path to back history
    if (selectedPath) {
      setFileHistoryBack(prev => [...prev, selectedPath])
    }

    setFileHistoryForward(newForward)
    setSelectedPath(nextPath)
  }, [fileHistoryForward, selectedPath])

  const canNavigateBack = fileHistoryBack.length > 0
  const canNavigateForward = fileHistoryForward.length > 0

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

  // Keyboard shortcut: Ctrl+L to open main chat view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault()
        handleOpenFullScreenChat()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleOpenFullScreenChat])

  const toggleExpand = (path: string, kind: 'file' | 'dir') => {
    if (kind === 'file') {
      navigateToFile(path)
      setIsGraphOpen(false)
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
      setSelectedPath(null)
      setIsGraphOpen(false)
    }
  }, [])

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
        setIsGraphOpen(false)
        setSelectedPath(fullPath)
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
      setSelectedPath(null)
      setIsGraphOpen(true)
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
  }), [tree, selectedPath, workspaceRoot, collectDirPaths])

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
            <MessageResponse>{item.content}</MessageResponse>
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
  const headerTitle = selectedPath ? selectedPath : (isGraphOpen ? 'Graph View' : 'Chat')

  return (
    <TooltipProvider delayDuration={0}>
      <SidebarSectionProvider defaultSection="knowledge" onSectionChange={handleSectionChange}>
        <div className="flex h-svh w-full">
          {/* Icon sidebar - always visible, fixed position */}
          <SidebarIcon />

          {/* Spacer for the fixed icon sidebar */}
          <div className="w-14 shrink-0" />

          {/* Content sidebar with SidebarProvider for collapse functionality */}
          <SidebarProvider
            style={{
              "--sidebar-offset": "3.5rem",
              "--sidebar-width": `${DEFAULT_SIDEBAR_WIDTH}px`,
            } as React.CSSProperties}
          >
            <SidebarContentPanel
              tree={tree}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onSelectFile={toggleExpand}
              knowledgeActions={knowledgeActions}
              runs={runs}
              currentRunId={runId}
              tasksActions={{
                onNewChat: handleNewChat,
                onSelectRun: loadRun,
              }}
            />
            <SidebarInset className="overflow-hidden! min-h-0">
              {/* Header with sidebar triggers */}
              <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 bg-background">
                <SidebarTrigger className="-ml-1" />
                <Separator orientation="vertical" className="h-4" />
                <span className="text-sm font-medium text-muted-foreground flex-1">
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
                {!isGraphOpen && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      handleNewChat()
                      if (selectedPath) {
                        setIsChatSidebarOpen(true)
                      }
                    }}
                    className="text-foreground gap-1.5"
                  >
                    <SquarePen className="size-4" />
                    New Chat
                  </Button>
                )}
                {!selectedPath && isGraphOpen && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsGraphOpen(false)}
                    className="text-foreground"
                  >
                    Close Graph
                  </Button>
                )}
                {(selectedPath || isGraphOpen) && (
                  <>
                    <Separator orientation="vertical" className="h-4" />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setIsChatSidebarOpen(!isChatSidebarOpen)}
                      className="size-7 -mr-1"
                    >
                      <PanelRightIcon />
                      <span className="sr-only">Toggle Chat Sidebar</span>
                    </Button>
                  </>
                )}
              </header>

              {isGraphOpen ? (
                <div className="flex-1 min-h-0">
                  <GraphView
                    nodes={graphData.nodes}
                    edges={graphData.edges}
                    isLoading={graphStatus === 'loading'}
                    error={graphStatus === 'error' ? (graphError ?? 'Failed to build graph') : null}
                    onSelectNode={(path) => {
                      setIsGraphOpen(false)
                      navigateToFile(path)
                    }}
                  />
                </div>
              ) : selectedPath ? (
                selectedPath.endsWith('.md') ? (
                  <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    <MarkdownEditor
                      content={editorContent}
                      onChange={setEditorContent}
                      placeholder="Start writing..."
                      wikiLinks={wikiLinkConfig}
                      onImageUpload={handleImageUpload}
                      onNavigateBack={navigateBack}
                      onNavigateForward={navigateForward}
                      canNavigateBack={canNavigateBack}
                      canNavigateForward={canNavigateForward}
                    />
                  </div>
                ) : (
                  <div className="flex-1 overflow-auto p-4">
                    <pre className="text-sm font-mono text-foreground whitespace-pre-wrap">
                      {fileContent || 'Loading...'}
                    </pre>
                  </div>
                )
              ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <Conversation className="relative flex-1 overflow-y-auto">
                  <ConversationContent className={conversationContentClassName}>
                    {!hasConversation ? (
                      <ConversationEmptyState className="h-auto">
                        <div className="text-4xl font-semibold tracking-tight text-foreground/80 sm:text-5xl md:text-6xl">
                          Rowboat
                        </div>
                        <div className="mt-3 text-sm text-muted-foreground flex items-center gap-1">
                          <kbd className="px-1.5 py-0.5 text-xs font-medium bg-muted rounded border border-border">⌘</kbd>
                          <kbd className="px-1.5 py-0.5 text-xs font-medium bg-muted rounded border border-border">L</kbd>
                          <span className="ml-1">to open chat from anywhere</span>
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
                              <MessageResponse>{currentAssistantMessage}</MessageResponse>
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
                      isProcessing={isProcessing}
                      presetMessage={presetMessage}
                      onPresetMessageConsumed={() => setPresetMessage(undefined)}
                      runId={runId}
                    />
                  </div>
                </div>
              </div>
              )}
            </SidebarInset>

            {/* Chat sidebar - shown when viewing files/graph */}
            {(selectedPath || isGraphOpen) && (
              <ChatSidebar
                defaultWidth={400}
                isOpen={isChatSidebarOpen}
                onNewChat={handleNewChat}
                onOpenFullScreen={handleOpenFullScreenChat}
                conversation={conversation}
                currentAssistantMessage={currentAssistantMessage}
                currentReasoning={currentReasoning}
                isProcessing={isProcessing}
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
              />
            )}
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
