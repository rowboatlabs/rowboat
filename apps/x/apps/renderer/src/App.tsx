import * as React from 'react'
import { useCallback, useEffect, useState, useRef } from 'react'
import { workspace } from '@x/shared';
import { RunEvent, ListRunsResponse } from '@x/shared/src/runs.js';
import type { LanguageModelUsage, ToolUIPart } from 'ai';
import './App.css'
import z from 'zod';
import { CheckIcon, LoaderIcon, PanelLeftIcon, Maximize2, Minimize2, ChevronLeftIcon, ChevronRightIcon, SquarePen, SearchIcon, HistoryIcon, RadioIcon, SquareIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarkdownEditor, type MarkdownEditorHandle } from './components/markdown-editor';
import { ChatSidebar } from './components/chat-sidebar';
import { ChatInputWithMentions, type StagedAttachment } from './components/chat-input-with-mentions';
import { ChatMessageAttachments } from '@/components/chat-message-attachments'
import { GraphView, type GraphEdge, type GraphNode } from '@/components/graph-view';
import { BasesView, type BaseConfig, DEFAULT_BASE_CONFIG } from '@/components/bases-view';
import { useDebounce } from './hooks/use-debounce';
import { SidebarContentPanel } from '@/components/sidebar-content';
import { SidebarSectionProvider } from '@/contexts/sidebar-context';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  type PromptInputMessage,
  type FileMention,
} from '@/components/ai-elements/prompt-input';

import { Shimmer } from '@/components/ai-elements/shimmer';
import { useSmoothedText } from './hooks/useSmoothedText';
import { Tool, ToolContent, ToolHeader, ToolTabbedContent } from '@/components/ai-elements/tool';
import { WebSearchResult } from '@/components/ai-elements/web-search-result';
import { AppActionCard } from '@/components/ai-elements/app-action-card';
import { ComposioConnectCard } from '@/components/ai-elements/composio-connect-card';
import { PermissionRequest } from '@/components/ai-elements/permission-request';
import { AskHumanRequest } from '@/components/ai-elements/ask-human-request';
import { Suggestions } from '@/components/ai-elements/suggestions';
import { ToolPermissionRequestEvent, AskHumanRequestEvent } from '@x/shared/src/runs.js';
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/sonner"
import { stripKnowledgePrefix, toKnowledgePath, wikiLabel } from '@/lib/wiki-links'
import { splitFrontmatter, joinFrontmatter } from '@/lib/frontmatter'
import { OnboardingModal } from '@/components/onboarding'
import { CommandPalette, type CommandPaletteContext, type CommandPaletteMention } from '@/components/search-dialog'
import { BackgroundTaskDetail } from '@/components/background-task-detail'
import { VersionHistoryPanel } from '@/components/version-history-panel'
import { FileCardProvider } from '@/contexts/file-card-context'
import { MarkdownPreOverride } from '@/components/ai-elements/markdown-code-override'
import { TabBar, type ChatTab, type FileTab } from '@/components/tab-bar'
import {
  type ChatMessage,
  type ChatViewportAnchorState,
  type ChatTabViewState,
  type ConversationItem,
  type ToolCall,
  createEmptyChatTabViewState,
  getWebSearchCardData,
  getAppActionCardData,
  getComposioConnectCardData,
  getToolDisplayName,
  inferRunTitleFromMessage,
  isChatMessage,
  isErrorMessage,
  isToolCall,
  normalizeToolInput,
  normalizeToolOutput,
  parseAttachedFiles,
  toToolState,
} from '@/lib/chat-conversation'
import { COMPOSIO_DISPLAY_NAMES as composioDisplayNames } from '@x/shared/src/composio.js'
import { AgentScheduleConfig } from '@x/shared/dist/agent-schedule.js'
import { AgentScheduleState } from '@x/shared/dist/agent-schedule-state.js'
import { toast } from "sonner"
import { useVoiceMode } from '@/hooks/useVoiceMode'
import { useVoiceTTS } from '@/hooks/useVoiceTTS'
import { useMeetingTranscription, type MeetingTranscriptionState, type CalendarEventMeta } from '@/hooks/useMeetingTranscription'
import { useAnalyticsIdentity } from '@/hooks/useAnalyticsIdentity'
import * as analytics from '@/lib/analytics'

type DirEntry = z.infer<typeof workspace.DirEntry>
type RunEventType = z.infer<typeof RunEvent>
type ListRunsResponseType = z.infer<typeof ListRunsResponse>

interface TreeNode extends DirEntry {
  children?: TreeNode[]
  loaded?: boolean
}

const streamdownComponents = { pre: MarkdownPreOverride }

function SmoothStreamingMessage({ text, components }: { text: string; components: typeof streamdownComponents }) {
  const smoothText = useSmoothedText(text)
  return <MessageResponse components={components}>{smoothText}</MessageResponse>
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

const MACOS_TRAFFIC_LIGHTS_RESERVED_PX = 16 + 12 * 3 + 8 * 2
const TITLEBAR_BUTTON_PX = 32
const TITLEBAR_BUTTON_GAP_PX = 4
const TITLEBAR_HEADER_GAP_PX = 8
const TITLEBAR_TOGGLE_MARGIN_LEFT_PX = 12
const TITLEBAR_BUTTONS_COLLAPSED = 4
const TITLEBAR_BUTTON_GAPS_COLLAPSED = 3
const GRAPH_TAB_PATH = '__rowboat_graph_view__'
const BASES_DEFAULT_TAB_PATH = '__rowboat_bases_default__'

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const untitledBaseName = 'untitled'
const untitledIndexedNamePattern = /^untitled-\d+$/

const isUntitledPlaceholderName = (name: string) =>
  name === untitledBaseName || untitledIndexedNamePattern.test(name)

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

const WIKI_LINK_TOKEN_REGEX = /\[\[([^[\]]+)\]\]/g
const KNOWLEDGE_PREFIX = 'knowledge/'

const normalizeRelPathForWiki = (relPath: string) =>
  relPath.replace(/\\/g, '/').replace(/^\/+/, '')

const stripKnowledgePrefixForWiki = (relPath: string) => {
  const normalized = normalizeRelPathForWiki(relPath)
  return normalized.toLowerCase().startsWith(KNOWLEDGE_PREFIX)
    ? normalized.slice(KNOWLEDGE_PREFIX.length)
    : normalized
}

const stripMarkdownExtensionForWiki = (wikiPath: string) =>
  wikiPath.toLowerCase().endsWith('.md') ? wikiPath.slice(0, -3) : wikiPath

const wikiPathCompareKey = (wikiPath: string) =>
  stripMarkdownExtensionForWiki(wikiPath).toLowerCase()

const splitWikiPathPrefix = (rawPath: string) => {
  let normalized = rawPath.trim().replace(/^\/+/, '').replace(/^\.\//, '')
  const hadKnowledgePrefix = /^knowledge\//i.test(normalized)
  if (hadKnowledgePrefix) {
    normalized = normalized.slice(KNOWLEDGE_PREFIX.length)
  }
  return { pathWithoutPrefix: normalized, hadKnowledgePrefix }
}

const rewriteWikiLinksForRenamedFileInMarkdown = (
  markdown: string,
  fromRelPath: string,
  toRelPath: string
) => {
  const normalizedFrom = normalizeRelPathForWiki(fromRelPath)
  const normalizedTo = normalizeRelPathForWiki(toRelPath)
  const lowerFrom = normalizedFrom.toLowerCase()
  const lowerTo = normalizedTo.toLowerCase()
  if (!lowerFrom.startsWith(KNOWLEDGE_PREFIX) || !lowerFrom.endsWith('.md')) return markdown
  if (!lowerTo.startsWith(KNOWLEDGE_PREFIX) || !lowerTo.endsWith('.md')) return markdown

  const fromWikiPath = stripKnowledgePrefixForWiki(normalizedFrom)
  const toWikiPath = stripKnowledgePrefixForWiki(normalizedTo)
  const fromCompareKey = wikiPathCompareKey(fromWikiPath)
  const fromBaseName = stripMarkdownExtensionForWiki(fromWikiPath).split('/').pop()?.toLowerCase() ?? null
  const toWikiPathWithoutExtension = stripMarkdownExtensionForWiki(toWikiPath)
  const toBaseName = toWikiPathWithoutExtension.split('/').pop() ?? toWikiPathWithoutExtension

  return markdown.replace(WIKI_LINK_TOKEN_REGEX, (fullMatch, innerRaw: string) => {
    const pipeIndex = innerRaw.indexOf('|')
    const pathAndAnchor = pipeIndex >= 0 ? innerRaw.slice(0, pipeIndex) : innerRaw
    const aliasSuffix = pipeIndex >= 0 ? innerRaw.slice(pipeIndex) : ''

    const hashIndex = pathAndAnchor.indexOf('#')
    const pathPart = hashIndex >= 0 ? pathAndAnchor.slice(0, hashIndex) : pathAndAnchor
    const anchorSuffix = hashIndex >= 0 ? pathAndAnchor.slice(hashIndex) : ''

    const leadingWhitespace = pathPart.match(/^\s*/)?.[0] ?? ''
    const trailingWhitespace = pathPart.match(/\s*$/)?.[0] ?? ''
    const rawPath = pathPart.trim()
    if (!rawPath) return fullMatch

    const { pathWithoutPrefix, hadKnowledgePrefix } = splitWikiPathPrefix(rawPath)
    if (!pathWithoutPrefix) return fullMatch

    const matchesFullPath = wikiPathCompareKey(pathWithoutPrefix) === fromCompareKey
    const isBareTarget = !pathWithoutPrefix.includes('/')
    const targetBaseName = stripMarkdownExtensionForWiki(pathWithoutPrefix).toLowerCase()
    const matchesBareSelfName = Boolean(fromBaseName && isBareTarget && targetBaseName === fromBaseName)
    if (!matchesFullPath && !matchesBareSelfName) return fullMatch

    const preserveMarkdownExtension = rawPath.toLowerCase().endsWith('.md')
    const rewrittenTarget = matchesBareSelfName
      ? (preserveMarkdownExtension ? `${toBaseName}.md` : toBaseName)
      : (preserveMarkdownExtension ? toWikiPath : toWikiPathWithoutExtension)
    const finalPath = hadKnowledgePrefix ? `${KNOWLEDGE_PREFIX}${rewrittenTarget}` : rewrittenTarget

    return `[[${leadingWhitespace}${finalPath}${trailingWhitespace}${anchorSuffix}${aliasSuffix}]]`
  })
}

const getAncestorDirectoryPaths = (path: string): string[] => {
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 2) return []
  const ancestors: string[] = []
  for (let i = 1; i < parts.length - 1; i++) {
    ancestors.push(parts.slice(0, i + 1).join('/'))
  }
  return ancestors
}

const isGraphTabPath = (path: string) => path === GRAPH_TAB_PATH
const isBaseFilePath = (path: string) => path.endsWith('.base') || path === BASES_DEFAULT_TAB_PATH

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

// Sidebar folder ordering — listed folders appear in this order, unlisted ones follow alphabetically
const FOLDER_ORDER = ['People', 'Organizations', 'Projects', 'Topics', 'Meetings', 'Agent Notes', 'Notes']

/**
 * Per-folder base view config: which columns to show and default sort.
 * Folders not listed here fall back to DEFAULT_BASE_CONFIG.
 */
const FOLDER_BASE_CONFIGS: Record<string, { visibleColumns: string[]; sort: { field: string; dir: 'asc' | 'desc' } }> = {
  'Agent Notes': {
    visibleColumns: ['name', 'folder', 'mtimeMs'],
    sort: { field: 'mtimeMs', dir: 'desc' },
  },
  People: {
    visibleColumns: ['name', 'relationship', 'organization', 'mtimeMs'],
    sort: { field: 'name', dir: 'asc' },
  },
  Organizations: {
    visibleColumns: ['name', 'relationship', 'mtimeMs'],
    sort: { field: 'name', dir: 'asc' },
  },
  Projects: {
    visibleColumns: ['name', 'status', 'topic', 'mtimeMs'],
    sort: { field: 'name', dir: 'asc' },
  },
  Topics: {
    visibleColumns: ['name', 'mtimeMs'],
    sort: { field: 'name', dir: 'asc' },
  },
  Meetings: {
    visibleColumns: ['name', 'topic', 'mtimeMs'],
    sort: { field: 'mtimeMs', dir: 'desc' },
  },
}

// Sort nodes (dirs first, ordered folders by FOLDER_ORDER, then alphabetically)
function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    const aOrder = FOLDER_ORDER.indexOf(a.name)
    const bOrder = FOLDER_ORDER.indexOf(b.name)
    if (aOrder !== -1 && bOrder !== -1) return aOrder - bOrder
    if (aOrder !== -1) return -1
    if (bOrder !== -1) return 1
    return a.name.localeCompare(b.name)
  }).map(node => {
    if (node.children) {
      node.children = sortNodes(node.children)
    }
    return node
  })
}

/**
 * Organize Meetings/ source folders into date-grouped subfolders.
 *
 * - rowboat:  rowboat/2026-03-20/meeting-xxx.md  → keeps date folders as-is
 * - granola:  granola/2026/03/18/Title.md         → collapses into "2026-03-18" folders
 * - Files directly under a source folder (no date subfolder) are grouped
 *   by the date prefix in their filename (e.g. meeting-2026-03-17T...).
 */
function flattenMeetingsTree(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap(node => {
    if (node.kind !== 'dir' || node.name !== 'Meetings') return [node]

    const flattenedSourceChildren = (node.children ?? []).flatMap(sourceNode => {
      if (sourceNode.kind !== 'dir') return [sourceNode]

      // Collect all files with their date group label
      const dateGroups = new Map<string, TreeNode[]>()

      function collectFiles(n: TreeNode, dateParts: string[]) {
        for (const child of n.children ?? []) {
          if (child.kind === 'file') {
            const dateStr = dateParts.join('-')
            // If file is at root of source folder, try to extract date from filename
            const groupKey = dateStr || extractDateFromFilename(child.name) || 'other'
            const group = dateGroups.get(groupKey) ?? []
            group.push(child)
            dateGroups.set(groupKey, group)
          } else if (child.kind === 'dir') {
            collectFiles(child, [...dateParts, child.name])
          }
        }
      }
      collectFiles(sourceNode, [])

      if (dateGroups.size === 0) return []

      // Build date folder nodes, sorted reverse chronologically
      const dateFolderNodes: TreeNode[] = [...dateGroups.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([dateKey, files]) => {
          // Sort files within each date group reverse chronologically
          files.sort((a, b) => b.name.localeCompare(a.name))
          return {
            name: dateKey,
            path: `${sourceNode.path}/${dateKey}`,
            kind: 'dir' as const,
            children: files,
            loaded: true,
          }
        })

      return [{ ...sourceNode, children: dateFolderNodes }]
    })

    // Hide Meetings folder entirely if no source folders have files
    if (flattenedSourceChildren.length === 0) return []

    return [{ ...node, children: flattenedSourceChildren }]
  })
}

/** Extract YYYY-MM-DD from filenames like "meeting-2026-03-17T05-01-47.md" */
function extractDateFromFilename(name: string): string | null {
  const match = name.match(/(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : null
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

/** Sidebar toggle + utility buttons (fixed position, top-left) */
function FixedSidebarToggle({
  onNewChat,
  onOpenSearch,
  meetingState,
  meetingSummarizing,
  meetingAvailable,
  onToggleMeeting,
  leftInsetPx,
}: {
  onNewChat: () => void
  onOpenSearch: () => void
  meetingState: MeetingTranscriptionState
  meetingSummarizing: boolean
  meetingAvailable: boolean
  onToggleMeeting: () => void
  leftInsetPx: number
}) {
  const { toggleSidebar } = useSidebar()
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
      <button
        type="button"
        onClick={onOpenSearch}
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        style={{ marginLeft: TITLEBAR_BUTTON_GAP_PX }}
        aria-label="Search"
      >
        <SearchIcon className="size-5" />
      </button>
      {meetingAvailable && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggleMeeting}
              disabled={meetingState === 'connecting' || meetingState === 'stopping' || meetingSummarizing}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:pointer-events-none",
                meetingSummarizing
                  ? "text-muted-foreground"
                  : meetingState === 'recording'
                    ? "text-red-500 hover:bg-accent"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
              style={{ marginLeft: TITLEBAR_BUTTON_GAP_PX }}
            >
              {meetingSummarizing || meetingState === 'connecting' ? (
                <LoaderIcon className="size-4 animate-spin" />
              ) : meetingState === 'recording' ? (
                <SquareIcon className="size-4 animate-pulse" />
              ) : (
                <RadioIcon className="size-5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {meetingSummarizing ? 'Generating meeting notes...' : meetingState === 'connecting' ? 'Starting transcription...' : meetingState === 'recording' ? 'Stop meeting notes' : 'Take new meeting notes'}
          </TooltipContent>
        </Tooltip>
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
      className="titlebar-drag-region flex h-10 shrink-0 items-stretch border-b border-border bg-sidebar overflow-hidden"
      style={{
        paddingLeft: isCollapsed ? (collapsedLeftPaddingPx ?? 196) : 12,
        paddingRight: 12,
        transition: 'padding-left 200ms linear',
      }}
    >
      {onNavigateBack && onNavigateForward ? (
        <div className="titlebar-no-drag flex items-center gap-1 pr-2 shrink-0">
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
  type ShortcutPane = 'left' | 'right'
  type MarkdownHistoryHandlers = { undo: () => boolean; redo: () => boolean }

  useAnalyticsIdentity()

  // File browser state (for Knowledge section)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [editorContent, setEditorContent] = useState<string>('')
  const editorContentRef = useRef<string>('')
  const [editorContentByPath, setEditorContentByPath] = useState<Record<string, string>>({})
  const editorContentByPathRef = useRef<Map<string, string>>(new Map())
  const [tree, setTree] = useState<TreeNode[]>([])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [recentWikiFiles, setRecentWikiFiles] = useState<string[]>([])
  const [isGraphOpen, setIsGraphOpen] = useState(false)
  const [expandedFrom, setExpandedFrom] = useState<{ path: string | null; graph: boolean } | null>(null)
  const [baseConfigByPath, setBaseConfigByPath] = useState<Record<string, BaseConfig>>({})
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({
    nodes: [],
    edges: [],
  })
  const [graphStatus, setGraphStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [graphError, setGraphError] = useState<string | null>(null)
  const [isChatSidebarOpen, setIsChatSidebarOpen] = useState(true)
  const [isRightPaneMaximized, setIsRightPaneMaximized] = useState(false)
  const [activeShortcutPane, setActiveShortcutPane] = useState<ShortcutPane>('left')
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
  const recentLocalMarkdownWritesRef = useRef<Map<string, number>>(new Map())
  const untitledRenameReadyPathsRef = useRef<Set<string>>(new Set())

  // Pending app-navigation result to process once navigation functions are ready
  const pendingAppNavRef = useRef<Record<string, unknown> | null>(null)

  // Global navigation history (back/forward) across views (chat/file/graph/task)
  const historyRef = useRef<{ back: ViewState[]; forward: ViewState[] }>({ back: [], forward: [] })
  const [viewHistory, setViewHistory] = useState(historyRef.current)
  const setHistory = useCallback((next: { back: ViewState[]; forward: ViewState[] }) => {
    historyRef.current = next
    setViewHistory(next)
  }, [])

  // Auto-save state
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const debouncedContent = useDebounce(editorContent, 500)
  const initialContentRef = useRef<string>('')
  const renameInProgressRef = useRef(false)

  // Frontmatter state: store raw frontmatter per file path
  const frontmatterByPathRef = useRef<Map<string, string | null>>(new Map())

  // Version history state
  const [versionHistoryPath, setVersionHistoryPath] = useState<string | null>(null)
  const [viewingHistoricalVersion, setViewingHistoricalVersion] = useState<{
    oid: string
    content: string
  } | null>(null)

  // Chat state
  const [, setMessage] = useState<string>('')
  const [conversation, setConversation] = useState<ConversationItem[]>([])
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState<string>('')
  const [, setModelUsage] = useState<LanguageModelUsage | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const runIdRef = useRef<string | null>(null)
  const loadRunRequestIdRef = useRef(0)
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingRunIds, setProcessingRunIds] = useState<Set<string>>(new Set())
  const processingRunIdsRef = useRef<Set<string>>(new Set())
  const streamingBuffersRef = useRef<Map<string, { assistant: string }>>(new Map())
  const [isStopping, setIsStopping] = useState(false)
  const [stopClickedAt, setStopClickedAt] = useState<number | null>(null)
  const [agentId] = useState<string>('copilot')
  const [presetMessage, setPresetMessage] = useState<string | undefined>(undefined)

  // Voice mode state
  const [voiceAvailable, setVoiceAvailable] = useState(false)
  const [ttsAvailable, setTtsAvailable] = useState(false)
  const [ttsEnabled, setTtsEnabled] = useState(false)
  const ttsEnabledRef = useRef(false)
  const [ttsMode, setTtsMode] = useState<'summary' | 'full'>('summary')
  const ttsModeRef = useRef<'summary' | 'full'>('summary')
  const [isRecording, setIsRecording] = useState(false)
  const voiceTextBufferRef = useRef('')
  const spokenIndexRef = useRef(0)
  const isRecordingRef = useRef(false)

  const tts = useVoiceTTS()
  const ttsRef = useRef(tts)
  ttsRef.current = tts

  const voice = useVoiceMode()
  const voiceRef = useRef(voice)
  voiceRef.current = voice

  const handleToggleMeetingRef = useRef<(() => void) | undefined>(undefined)
  const meetingTranscription = useMeetingTranscription(() => {
    handleToggleMeetingRef.current?.()
  })

  // Check if voice is available on mount and when OAuth state changes
  const refreshVoiceAvailability = useCallback(() => {
    Promise.all([
      window.ipc.invoke('voice:getConfig', null),
      window.ipc.invoke('oauth:getState', null),
    ]).then(([config, oauthState]) => {
      const rowboatConnected = oauthState.config?.rowboat?.connected ?? false
      const hasVoice = !!config.deepgram || rowboatConnected
      setVoiceAvailable(hasVoice)
      setTtsAvailable(!!config.elevenlabs || rowboatConnected)
      // Pre-cache auth details so mic click skips IPC round-trips
      if (hasVoice) {
        voice.warmup()
      }
    }).catch(() => {
      setVoiceAvailable(false)
      setTtsAvailable(false)
    })
  }, [voice.warmup])

  useEffect(() => {
    refreshVoiceAvailability()
    const cleanup = window.ipc.on('oauth:didConnect', () => {
      refreshVoiceAvailability()
    })
    return cleanup
  }, [refreshVoiceAvailability])

  const handleStartRecording = useCallback(() => {
    setIsRecording(true)
    isRecordingRef.current = true
    voice.start()
  }, [voice])

  const handlePromptSubmitRef = useRef<((message: PromptInputMessage, mentions?: FileMention[], stagedAttachments?: StagedAttachment[], searchEnabled?: boolean) => Promise<void>) | null>(null)
  const pendingVoiceInputRef = useRef(false)

  // Palette: per-tab editor handles for capturing cursor context on Cmd+K, and pending payload
  // queued across the new-chat-tab state flush before submit fires.
  const editorRefsByTabId = useRef<Map<string, MarkdownEditorHandle>>(new Map())
  const [paletteContext, setPaletteContext] = useState<CommandPaletteContext | null>(null)
  const [pendingPaletteSubmit, setPendingPaletteSubmit] = useState<{ text: string; mention: CommandPaletteMention | null } | null>(null)

  const handleSubmitRecording = useCallback(() => {
    const text = voice.submit()
    setIsRecording(false)
    isRecordingRef.current = false
    if (text) {
      pendingVoiceInputRef.current = true
      handlePromptSubmitRef.current?.({ text, files: [] })
    }
  }, [voice])

  const handleToggleTts = useCallback(() => {
    setTtsEnabled(prev => {
      const next = !prev
      ttsEnabledRef.current = next
      if (!next) {
        ttsRef.current.cancel()
      }
      return next
    })
  }, [])

  const handleTtsModeChange = useCallback((mode: 'summary' | 'full') => {
    setTtsMode(mode)
    ttsModeRef.current = mode
  }, [])

  const handleCancelRecording = useCallback(() => {
    voice.cancel()
    setIsRecording(false)
    isRecordingRef.current = false
  }, [voice])

  // Enter to submit voice input, Escape to cancel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isRecordingRef.current) return
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSubmitRecording()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleCancelRecording()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleSubmitRecording, handleCancelRecording])

  // Helper to cancel recording from any navigation handler
  const cancelRecordingIfActive = useCallback(() => {
    if (isRecordingRef.current) {
      voiceRef.current.cancel()
      setIsRecording(false)
      isRecordingRef.current = false
    }
  }, [])

  // Runs history state
  type RunListItem = { id: string; title?: string; createdAt: string; agentId: string }
  const [runs, setRuns] = useState<RunListItem[]>([])

  // Chat tab state
  const [chatTabs, setChatTabs] = useState<ChatTab[]>([{ id: 'default-chat-tab', runId: null }])
  const [activeChatTabId, setActiveChatTabId] = useState('default-chat-tab')
  const [chatViewStateByTab, setChatViewStateByTab] = useState<Record<string, ChatTabViewState>>({
    'default-chat-tab': createEmptyChatTabViewState(),
  })
  const chatViewStateByTabRef = useRef(chatViewStateByTab)
  const chatTabIdCounterRef = useRef(0)
  const newChatTabId = () => `chat-tab-${++chatTabIdCounterRef.current}`
  const chatDraftsRef = useRef(new Map<string, string>())
  const chatScrollTopByTabRef = useRef(new Map<string, number>())
  const [toolOpenByTab, setToolOpenByTab] = useState<Record<string, Record<string, boolean>>>({})
  const [chatViewportAnchorByTab, setChatViewportAnchorByTab] = useState<Record<string, ChatViewportAnchorState>>({})
  const activeChatTabIdRef = useRef(activeChatTabId)
  activeChatTabIdRef.current = activeChatTabId
  const setChatDraftForTab = useCallback((tabId: string, text: string) => {
    if (text) {
      chatDraftsRef.current.set(tabId, text)
    } else {
      chatDraftsRef.current.delete(tabId)
    }
  }, [])
  const isToolOpenForTab = useCallback((tabId: string, toolId: string): boolean => {
    return toolOpenByTab[tabId]?.[toolId] ?? false
  }, [toolOpenByTab])
  const setToolOpenForTab = useCallback((tabId: string, toolId: string, open: boolean) => {
    setToolOpenByTab((prev) => {
      const prevForTab = prev[tabId] ?? {}
      if (prevForTab[toolId] === open) return prev
      return {
        ...prev,
        [tabId]: {
          ...prevForTab,
          [toolId]: open,
        },
      }
    })
  }, [])
  const setChatViewportAnchor = useCallback((tabId: string, messageId: string | null) => {
    setChatViewportAnchorByTab((prev) => {
      const prevForTab = prev[tabId]
      return {
        ...prev,
        [tabId]: {
          messageId,
          requestKey: (prevForTab?.requestKey ?? 0) + 1,
        },
      }
    })
  }, [])
  const getChatScrollContainer = useCallback((tabId: string): HTMLElement | null => {
    if (typeof document === 'undefined') return null
    const panel = document.querySelector<HTMLElement>(
      `[data-chat-tab-panel="${tabId}"][aria-hidden="false"]`
    )
    if (!panel) return null
    const logRoot = panel.querySelector<HTMLElement>('[role="log"]')
    if (!logRoot) return null
    const children = Array.from(logRoot.children) as HTMLElement[]
    for (const child of children) {
      const style = window.getComputedStyle(child)
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        return child
      }
    }
    return null
  }, [])
  const saveChatScrollForTab = useCallback((tabId: string) => {
    const container = getChatScrollContainer(tabId)
    if (!container) return
    chatScrollTopByTabRef.current.set(tabId, container.scrollTop)
  }, [getChatScrollContainer])

  const getChatTabTitle = useCallback((tab: ChatTab) => {
    if (!tab.runId) return 'New chat'
    return runs.find(r => r.id === tab.runId)?.title || '(Untitled chat)'
  }, [runs])

  const isChatTabProcessing = useCallback((tab: ChatTab) => {
    return tab.runId ? processingRunIds.has(tab.runId) : false
  }, [processingRunIds])

  // File tab state
  const [fileTabs, setFileTabs] = useState<FileTab[]>([])
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null)
  const activeFileTabIdRef = useRef(activeFileTabId)
  activeFileTabIdRef.current = activeFileTabId
  const [editorSessionByTabId, setEditorSessionByTabId] = useState<Record<string, number>>({})
  const fileHistoryHandlersRef = useRef<Map<string, MarkdownHistoryHandlers>>(new Map())
  const fileTabIdCounterRef = useRef(0)
  const newFileTabId = () => `file-tab-${++fileTabIdCounterRef.current}`

  const getFileTabTitle = useCallback((tab: FileTab) => {
    if (isGraphTabPath(tab.path)) return 'Graph View'
    if (tab.path === BASES_DEFAULT_TAB_PATH) return 'Bases'
    if (tab.path.endsWith('.base')) return tab.path.split('/').pop()?.replace(/\.base$/i, '') || 'Base'
    return tab.path.split('/').pop()?.replace(/\.md$/i, '') || tab.path
  }, [])

  // Pending requests state
  const [, setPendingPermissionRequests] = useState<Map<string, z.infer<typeof ToolPermissionRequestEvent>>>(new Map())
  const [pendingAskHumanRequests, setPendingAskHumanRequests] = useState<Map<string, z.infer<typeof AskHumanRequestEvent>>>(new Map())
  // Track ALL permission requests (for rendering with response status)
  const [allPermissionRequests, setAllPermissionRequests] = useState<Map<string, z.infer<typeof ToolPermissionRequestEvent>>>(new Map())
  // Track permission responses (toolCallId -> response)
  const [permissionResponses, setPermissionResponses] = useState<Map<string, 'approve' | 'deny'>>(new Map())

  useEffect(() => {
    chatViewStateByTabRef.current = chatViewStateByTab
  }, [chatViewStateByTab])

  useEffect(() => {
    const snapshot: ChatTabViewState = {
      runId,
      conversation,
      currentAssistantMessage,
      pendingAskHumanRequests: new Map(pendingAskHumanRequests),
      allPermissionRequests: new Map(allPermissionRequests),
      permissionResponses: new Map(permissionResponses),
    }
    setChatViewStateByTab((prev) => ({ ...prev, [activeChatTabId]: snapshot }))
  }, [
    activeChatTabId,
    runId,
    conversation,
    currentAssistantMessage,
    pendingAskHumanRequests,
    allPermissionRequests,
    permissionResponses,
  ])

  useEffect(() => {
    const tabIds = new Set(chatTabs.map((tab) => tab.id))
    setChatViewStateByTab((prev) => {
      let changed = false
      const next: Record<string, ChatTabViewState> = {}
      for (const [tabId, state] of Object.entries(prev)) {
        if (tabIds.has(tabId)) {
          next[tabId] = state
        } else {
          changed = true
        }
      }
      for (const tabId of tabIds) {
        if (!next[tabId]) {
          next[tabId] = createEmptyChatTabViewState()
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [chatTabs])

  useEffect(() => {
    const tabIds = new Set(chatTabs.map((tab) => tab.id))
    setChatViewportAnchorByTab((prev) => {
      let changed = false
      const next: Record<string, ChatViewportAnchorState> = {}
      for (const [tabId, state] of Object.entries(prev)) {
        if (tabIds.has(tabId)) {
          next[tabId] = state
        } else {
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [chatTabs])

  // Workspace root for full paths
  const [workspaceRoot, setWorkspaceRoot] = useState<string>('')

  // Onboarding state
  const [showOnboarding, setShowOnboarding] = useState(false)

  // Search state
  const [isSearchOpen, setIsSearchOpen] = useState(false)

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

  // Keep active file visible in the Knowledge tree by auto-expanding its ancestor folders.
  useEffect(() => {
    if (!selectedPath) return
    const ancestorDirs = getAncestorDirectoryPaths(selectedPath)
    if (ancestorDirs.length === 0) return

    setExpandedPaths((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const dirPath of ancestorDirs) {
        if (!next.has(dirPath)) {
          next.add(dirPath)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [selectedPath])

  // Keep runIdRef in sync with runId state (for use in event handlers to avoid stale closures)
  useEffect(() => {
    runIdRef.current = runId
  }, [runId])

  const setEditorCacheForPath = useCallback((path: string, content: string) => {
    editorContentByPathRef.current.set(path, content)
    setEditorContentByPath((prev) => {
      if (prev[path] === content) return prev
      return { ...prev, [path]: content }
    })
  }, [])

  const removeEditorCacheForPath = useCallback((path: string) => {
    editorContentByPathRef.current.delete(path)
    untitledRenameReadyPathsRef.current.delete(path)
    setEditorContentByPath((prev) => {
      if (!(path in prev)) return prev
      const next = { ...prev }
      delete next[path]
      return next
    })
  }, [])

  const markRecentLocalMarkdownWrite = useCallback((path: string) => {
    if (!path.endsWith('.md')) return
    const now = Date.now()
    recentLocalMarkdownWritesRef.current.set(path, now)
    if (recentLocalMarkdownWritesRef.current.size > 200) {
      for (const [knownPath, timestamp] of recentLocalMarkdownWritesRef.current.entries()) {
        if (now - timestamp > 10_000) {
          recentLocalMarkdownWritesRef.current.delete(knownPath)
        }
      }
    }
  }, [])

  const consumeRecentLocalMarkdownWrite = useCallback((path: string, windowMs: number = 2_500) => {
    const timestamp = recentLocalMarkdownWritesRef.current.get(path)
    if (timestamp === undefined) return false
    const isRecent = Date.now() - timestamp <= windowMs
    if (!isRecent) {
      recentLocalMarkdownWritesRef.current.delete(path)
    }
    return isRecent
  }, [])

  const handleEditorChange = useCallback((path: string, markdown: string) => {
    setEditorCacheForPath(path, markdown)
    const nextSelectedPath = selectedPathRef.current
    if (nextSelectedPath !== path) {
      return
    }
    // Avoid clobbering editorPath during rapid transitions (e.g. autosave rename) where refs may lag a tick.
    if (!editorPathRef.current || (nextSelectedPath && editorPathRef.current === nextSelectedPath)) {
      editorPathRef.current = nextSelectedPath
    }
    editorContentRef.current = markdown
    setEditorContent(markdown)
  }, [setEditorCacheForPath])
  // Keep processingRunIdsRef in sync for use in async callbacks
  useEffect(() => {
    processingRunIdsRef.current = processingRunIds
  }, [processingRunIds])

  // Sync active run streaming UI with background processing tracking.
  // Depend on both runId and processingRunIds so we don't miss late/early event ordering.
  useEffect(() => {
    if (!runId) {
      setIsProcessing(false)
      setIsStopping(false)
      setStopClickedAt(null)
      setCurrentAssistantMessage('')
      return
    }
    const isRunProcessing = processingRunIds.has(runId)
    setIsProcessing(isRunProcessing)
    if (isRunProcessing) {
      const buffer = streamingBuffersRef.current.get(runId)
      setCurrentAssistantMessage(buffer?.assistant ?? '')
    } else {
      setIsStopping(false)
      setStopClickedAt(null)
      setCurrentAssistantMessage('')
      streamingBuffersRef.current.delete(runId)
    }
  }, [runId, processingRunIds])

  // Load directory tree (knowledge + bases)
  const loadDirectory = useCallback(async () => {
    try {
      const [knowledgeResult, basesResult] = await Promise.all([
        window.ipc.invoke('workspace:readdir', {
          path: 'knowledge',
          opts: { recursive: true, includeHidden: false, includeStats: true }
        }),
        window.ipc.invoke('workspace:readdir', {
          path: 'bases',
          opts: { recursive: false, includeHidden: false, includeStats: true }
        }).catch(() => [] as DirEntry[]),
      ])
      const knowledgeTree = flattenMeetingsTree(buildTree(knowledgeResult))
      const basesChildren: TreeNode[] = (basesResult as DirEntry[])
        .filter((e) => e.name.endsWith('.base'))
        .map((e) => ({ ...e, kind: 'file' as const }))
      if (basesChildren.length > 0) {
        const basesFolder: TreeNode = {
          name: 'Bases',
          path: 'bases',
          kind: 'dir',
          children: basesChildren,
        }
        return [...knowledgeTree, basesFolder]
      }
      return knowledgeTree
    } catch (err) {
      console.error('Failed to load directory:', err)
      return []
    }
  }, [])

  // Ensure bases/ and knowledge/Notes/ directories exist on startup
  useEffect(() => {
    window.ipc.invoke('workspace:mkdir', { path: 'bases', recursive: true })
      .catch((err: unknown) => console.error('Failed to ensure bases directory:', err))
    window.ipc.invoke('workspace:mkdir', { path: 'knowledge/Notes', recursive: true })
      .catch((err: unknown) => console.error('Failed to ensure Notes directory:', err))
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
      const eventPaths = (() => {
        if (event.type === 'changed') return [event.path]
        if (event.type === 'bulkChanged') return event.paths ?? []
        if (event.type === 'moved') return [event.from, event.to]
        if (event.type === 'created' || event.type === 'deleted') return [event.path]
        return []
      })()
      const selectedPathAtEvent = selectedPathRef.current

      // Reload background tasks if agent-schedule.json changed
      if (
        changedPath === 'config/agent-schedule.json'
        || changedPaths.includes('config/agent-schedule.json')
      ) {
        loadBackgroundTasks()
      }

      // Invalidate cached content for files changed outside the active editor.
      // This prevents stale backlinks after rename-rewrite passes touch many files.
      for (const path of eventPaths) {
        if (!path.endsWith('.md')) continue
        if (selectedPathAtEvent && path === selectedPathAtEvent) continue
        removeEditorCacheForPath(path)
        initialContentByPathRef.current.delete(path)
      }

      // Keep selection stable if a file is moved externally.
      if (
        event.type === 'moved'
        && selectedPathAtEvent
        && event.from === selectedPathAtEvent
      ) {
        setSelectedPath(event.to)
      }

      // Reload current file if it was changed externally
      if (!selectedPathAtEvent) return
      const pathToReload = selectedPathAtEvent

      const isCurrentFileChanged =
        changedPath === pathToReload || changedPaths.includes(pathToReload)

      if (isCurrentFileChanged) {
        // Ignore immediate watcher echoes of our own autosaves to preserve undo history.
        if (consumeRecentLocalMarkdownWrite(pathToReload)) {
          return
        }
        // Only reload if no unsaved edits
        const baseline = initialContentByPathRef.current.get(pathToReload) ?? initialContentRef.current
        if (editorContentRef.current === baseline) {
          const result = await window.ipc.invoke('workspace:readFile', { path: pathToReload })
          if (selectedPathRef.current !== pathToReload) return
          setFileContent(result.data)
          const { raw: fm, body } = splitFrontmatter(result.data)
          frontmatterByPathRef.current.set(pathToReload, fm)
          setEditorContent(body)
          setEditorCacheForPath(pathToReload, body)
          editorContentRef.current = body
          editorPathRef.current = pathToReload
          initialContentByPathRef.current.set(pathToReload, body)
          initialContentRef.current = body
        }
      }
    })
    return cleanup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadDirectory, removeEditorCacheForPath, setEditorCacheForPath])

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
    if (selectedPath === BASES_DEFAULT_TAB_PATH) {
      // Virtual default base — no file to load, use DEFAULT_BASE_CONFIG
      if (!baseConfigByPath[selectedPath]) {
        setBaseConfigByPath((prev) => ({ ...prev, [selectedPath]: { ...DEFAULT_BASE_CONFIG } }))
      }
      return
    }
    if (selectedPath.endsWith('.base')) {
      // Load base config from file only if not already cached
      if (!baseConfigByPath[selectedPath]) {
        window.ipc.invoke('workspace:readFile', { path: selectedPath, encoding: 'utf8' })
          .then((result: { data: string }) => {
            try {
              const parsed = JSON.parse(result.data) as BaseConfig
              setBaseConfigByPath((prev) => ({ ...prev, [selectedPath]: parsed }))
            } catch {
              setBaseConfigByPath((prev) => ({ ...prev, [selectedPath]: { ...DEFAULT_BASE_CONFIG } }))
            }
          })
          .catch(() => {
            setBaseConfigByPath((prev) => ({ ...prev, [selectedPath]: { ...DEFAULT_BASE_CONFIG } }))
          })
      }
      return
    }
    if (selectedPath.endsWith('.md')) {
      const cachedContent = editorContentByPathRef.current.get(selectedPath)
      const hasBaseline = initialContentByPathRef.current.has(selectedPath)
      // Only trust cache after we've loaded/saved this file at least once.
      // This avoids a first-open race where an early empty editor update can poison the cache.
      if (cachedContent !== undefined && hasBaseline) {
        setFileContent(cachedContent)
        setEditorContent(cachedContent)
        editorContentRef.current = cachedContent
        editorPathRef.current = selectedPath
        initialContentRef.current = initialContentByPathRef.current.get(selectedPath) ?? cachedContent
        return
      }
    }
    const requestId = (fileLoadRequestIdRef.current += 1)
    const pathToLoad = selectedPath
    let cancelled = false
    ;(async () => {
      try {
        // For .md files (from the knowledge tree), skip stat and read directly.
        // For other file types, stat first to check if it's a file vs directory.
        const isKnownFile = pathToLoad.endsWith('.md')
        if (!isKnownFile) {
          const stat = await window.ipc.invoke('workspace:stat', { path: pathToLoad })
          if (cancelled || fileLoadRequestIdRef.current !== requestId || selectedPathRef.current !== pathToLoad) return
          if (stat.kind !== 'file') {
            setFileContent('')
            setEditorContent('')
            editorContentRef.current = ''
            initialContentRef.current = ''
            return
          }
        }
        const result = await window.ipc.invoke('workspace:readFile', { path: pathToLoad })
        if (cancelled || fileLoadRequestIdRef.current !== requestId || selectedPathRef.current !== pathToLoad) return
        setFileContent(result.data)
        const { raw: fm, body } = splitFrontmatter(result.data)
        frontmatterByPathRef.current.set(pathToLoad, fm)
        const normalizeForCompare = (s: string) => s.split('\n').map(line => line.trimEnd()).join('\n').trim()
        const isSameEditorFile = editorPathRef.current === pathToLoad
        const knownBaseline = initialContentByPathRef.current.get(pathToLoad)
        const hasKnownBaseline = knownBaseline !== undefined
        const hasUnsavedEdits =
          hasKnownBaseline
          && normalizeForCompare(editorContentRef.current) !== normalizeForCompare(knownBaseline)
        const shouldPreserveActiveDraft = isSameEditorFile && hasUnsavedEdits
        if (!shouldPreserveActiveDraft) {
          setEditorContent(body)
          if (pathToLoad.endsWith('.md')) {
            setEditorCacheForPath(pathToLoad, body)
          }
          editorContentRef.current = body
          editorPathRef.current = pathToLoad
          initialContentByPathRef.current.set(pathToLoad, body)
          initialContentRef.current = body
          setLastSaved(null)
        } else {
          // Still update the editor's path so subsequent autosaves write to the correct file.
          editorPathRef.current = pathToLoad
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
  }, [selectedPath, setEditorCacheForPath])

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
      let contentToSave = joinFrontmatter(frontmatterByPathRef.current.get(pathAtStart) ?? null, debouncedContent)
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
          const currentBase = getBaseName(pathAtStart)
          if (isUntitledPlaceholderName(currentBase)) {
            const headingTitle = getHeadingTitle(debouncedContent)
            const desiredName = headingTitle ? sanitizeHeadingForFilename(headingTitle) : null
            const shouldAutoRename = untitledRenameReadyPathsRef.current.has(pathAtStart)
            if (shouldAutoRename && desiredName && desiredName !== currentBase) {
              const parentDir = pathAtStart.split('/').slice(0, -1).join('/')
              let targetPath = `${parentDir}/${desiredName}.md`
              if (targetPath !== pathAtStart) {
                let suffix = 1
                while (true) {
                  const exists = await window.ipc.invoke('workspace:exists', { path: targetPath })
                  if (!exists.exists) break
                  targetPath = `${parentDir}/${desiredName}-${suffix}.md`
                  suffix += 1
                }
                renameInProgressRef.current = true
                await window.ipc.invoke('workspace:rename', { from: pathAtStart, to: targetPath })
                pathToSave = targetPath
                const rewrittenBody = rewriteWikiLinksForRenamedFileInMarkdown(
                  debouncedContent,
                  pathAtStart,
                  targetPath
                )
                contentToSave = joinFrontmatter(frontmatterByPathRef.current.get(pathAtStart) ?? null, rewrittenBody)
                renamedFrom = pathAtStart
                renamedTo = targetPath
                editorPathRef.current = targetPath
                untitledRenameReadyPathsRef.current.delete(pathAtStart)
                setFileTabs(prev => prev.map(tab => (tab.path === pathAtStart ? { ...tab, path: targetPath } : tab)))
                // Migrate frontmatter entry
                const fmEntry = frontmatterByPathRef.current.get(pathAtStart)
                frontmatterByPathRef.current.delete(pathAtStart)
                frontmatterByPathRef.current.set(targetPath, fmEntry ?? null)
                initialContentByPathRef.current.delete(pathAtStart)
                const cachedContent = editorContentByPathRef.current.get(pathAtStart)
                if (cachedContent !== undefined) {
                  const rewrittenCachedContent = rewriteWikiLinksForRenamedFileInMarkdown(
                    cachedContent,
                    pathAtStart,
                    targetPath
                  )
                  editorContentByPathRef.current.delete(pathAtStart)
                  editorContentByPathRef.current.set(targetPath, rewrittenCachedContent)
                  setEditorContentByPath((prev) => {
                    const oldContent = prev[pathAtStart]
                    if (oldContent === undefined) return prev
                    const next = { ...prev }
                    delete next[pathAtStart]
                    next[targetPath] = rewriteWikiLinksForRenamedFileInMarkdown(
                      oldContent,
                      pathAtStart,
                      targetPath
                    )
                    return next
                  })
                }
                if (selectedPathRef.current === pathAtStart) {
                  const bodyForEditor = splitFrontmatter(contentToSave).body
                  editorContentRef.current = bodyForEditor
                  setEditorContent(bodyForEditor)
                }
              }
            }
          }
        }
        await window.ipc.invoke('workspace:writeFile', {
          path: pathToSave,
          data: contentToSave,
          opts: { encoding: 'utf8' }
        })
        markRecentLocalMarkdownWrite(pathToSave)
        // Store body-only baseline (matches what debouncedContent compares against)
        initialContentByPathRef.current.set(pathToSave, splitFrontmatter(contentToSave).body)

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
          initialContentRef.current = splitFrontmatter(contentToSave).body
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
  }, [debouncedContent, markRecentLocalMarkdownWrite, setHistory])

  // Close version history panel when switching files
  useEffect(() => {
    if (versionHistoryPath && selectedPath !== versionHistoryPath) {
      setVersionHistoryPath(null)
      setViewingHistoricalVersion(null)
    }
  }, [selectedPath, versionHistoryPath])

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
              let msgAttachments: ChatMessage['attachments'] = undefined
              if (typeof msg.content === 'string') {
                textContent = msg.content
              } else if (Array.isArray(msg.content)) {
                const contentParts = msg.content as Array<{
                  type: string
                  text?: string
                  path?: string
                  filename?: string
                  mimeType?: string
                  size?: number
                  toolCallId?: string
                  toolName?: string
                  arguments?: ToolUIPart['input']
                }>

                textContent = contentParts
                  .filter((part) => part.type === 'text')
                  .map((part) => part.text || '')
                  .join('')

                const attachmentParts = contentParts.filter((part) => part.type === 'attachment' && part.path)
                if (attachmentParts.length > 0) {
                  msgAttachments = attachmentParts.map((part) => ({
                    path: part.path!,
                    filename: part.filename || part.path!.split('/').pop() || part.path!,
                    mimeType: part.mimeType || 'application/octet-stream',
                    size: part.size,
                  }))
                }

                // Also extract tool-call parts from assistant messages
                if (msg.role === 'assistant') {
                  for (const part of contentParts) {
                    if (part.type === 'tool-call' && part.toolCallId && part.toolName) {
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
              if (textContent || msgAttachments) {
                items.push({
                  id: event.messageId,
                  role: msg.role,
                  content: textContent,
                  attachments: msgAttachments,
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
          case 'error': {
            items.push({
              id: `error-${Date.now()}-${Math.random()}`,
              kind: 'error',
              message: event.error,
              timestamp: event.ts ? new Date(event.ts).getTime() : Date.now(),
            })
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

  const getStreamingBuffer = useCallback((id: string) => {
    const existing = streamingBuffersRef.current.get(id)
    if (existing) return existing
    const next = { assistant: '' }
    streamingBuffersRef.current.set(id, next)
    return next
  }, [])

  const appendStreamingBuffer = useCallback((id: string, delta: string) => {
    if (!delta) return
    const buffer = getStreamingBuffer(id)
    buffer.assistant += delta
  }, [getStreamingBuffer])

  const clearStreamingBuffer = useCallback((id: string) => {
    streamingBuffersRef.current.delete(id)
  }, [])

  const handleRunEvent = useCallback((event: RunEventType) => {
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
        // Reset voice buffer for new response
        voiceTextBufferRef.current = ''
        spokenIndexRef.current = 0
        break

      case 'run-processing-end':
        setProcessingRunIds(prev => {
          const next = new Set(prev)
          next.delete(event.runId)
          return next
        })
        void loadRuns()
        clearStreamingBuffer(event.runId)
        if (!isActiveRun) return
        setIsProcessing(false)
        setIsStopping(false)
        setStopClickedAt(null)
        break

      case 'start':
        setProcessingRunIds(prev => {
          if (prev.has(event.runId)) return prev
          const next = new Set(prev)
          next.add(event.runId)
          return next
        })
        if (!isActiveRun) return
        setIsProcessing(true)
        setCurrentAssistantMessage('')
        setModelUsage(null)
        break

      case 'llm-stream-event':
        {
          const llmEvent = event.event
          // Fallback: if processing-start is missed/out-of-order, stream activity still means run is active.
          setProcessingRunIds(prev => {
            if (prev.has(event.runId)) return prev
            const next = new Set(prev)
            next.add(event.runId)
            return next
          })
          if (!isActiveRun) {
            if (llmEvent.type === 'text-delta' && llmEvent.delta) {
              appendStreamingBuffer(event.runId, llmEvent.delta)
            }
            return
          }
          setIsProcessing(true)
          if (llmEvent.type === 'text-delta' && llmEvent.delta) {
            appendStreamingBuffer(event.runId, llmEvent.delta)
            setCurrentAssistantMessage(prev => prev + llmEvent.delta)

            // Extract <voice> tags and send to TTS when enabled
            voiceTextBufferRef.current += llmEvent.delta
            const remaining = voiceTextBufferRef.current.substring(spokenIndexRef.current)
            const voiceRegex = /<voice>([\s\S]*?)<\/voice>/g
            let voiceMatch: RegExpExecArray | null
            while ((voiceMatch = voiceRegex.exec(remaining)) !== null) {
              const voiceContent = voiceMatch[1].trim()
              console.log('[voice] extracted voice tag:', voiceContent)
              if (voiceContent && ttsEnabledRef.current) {
                ttsRef.current.speak(voiceContent)
              }
              spokenIndexRef.current += voiceMatch.index + voiceMatch[0].length
            }
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
          if (msg.role === 'user' && typeof msg.content === 'string') {
            const inferredTitle = inferRunTitleFromMessage(msg.content)
            if (inferredTitle) {
              setRuns(prev => prev.map(run => (
                run.id === event.runId && !run.title
                  ? { ...run, title: inferredTitle }
                  : run
              )))
            }
          }
          if (!isActiveRun) {
            if (msg.role === 'assistant') {
              clearStreamingBuffer(event.runId)
            }
            return
          }
          if (msg.role === 'assistant') {
            setCurrentAssistantMessage(currentMsg => {
              if (currentMsg) {
                const cleanedContent = currentMsg.replace(/<\/?voice>/g, '')
                setConversation(prev => {
                  const exists = prev.some(m =>
                    m.id === event.messageId && 'role' in m && m.role === 'assistant'
                  )
                  if (exists) return prev
                  return [...prev, {
                    id: event.messageId,
                    role: 'assistant',
                    content: cleanedContent,
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

          // Handle app-navigation tool results — trigger UI side effects
          if (event.toolName === 'app-navigation') {
            const result = event.result as { success?: boolean; action?: string; [key: string]: unknown } | undefined
            if (result?.success) {
              pendingAppNavRef.current = result
            }
          }

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
        setConversation(prev => [...prev, {
          id: `error-${Date.now()}`,
          kind: 'error',
          message: event.error,
          timestamp: Date.now(),
        }])
        toast.error(event.error.split('\n')[0] || 'Model error')
        console.error('Run error:', event.error)
        break
    }
  }, [appendStreamingBuffer, clearStreamingBuffer, loadRuns])

  // Listen to run events - use refs/callbacks to avoid stale closure issues.
  useEffect(() => {
    const cleanup = window.ipc.on('runs:events', ((event: unknown) => {
      handleRunEvent(event as RunEventType)
    }) as (event: null) => void)
    return cleanup
  }, [handleRunEvent])

  const handlePromptSubmit = async (
    message: PromptInputMessage,
    mentions?: FileMention[],
    stagedAttachments: StagedAttachment[] = [],
    searchEnabled?: boolean,
  ) => {
    if (isProcessing) return

    const submitTabId = activeChatTabIdRef.current
    const { text } = message
    const userMessage = text.trim()
    const hasAttachments = stagedAttachments.length > 0
    if (!userMessage && !hasAttachments) return

    setMessage('')

    const userMessageId = `user-${Date.now()}`
    const displayAttachments: ChatMessage['attachments'] = hasAttachments
      ? stagedAttachments.map((attachment) => ({
          path: attachment.path,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
          thumbnailUrl: attachment.thumbnailUrl,
        }))
      : undefined
    setConversation((prev) => [...prev, {
      id: userMessageId,
      role: 'user',
      content: userMessage,
      attachments: displayAttachments,
      timestamp: Date.now(),
    }])
    setChatViewportAnchor(submitTabId, userMessageId)

    try {
      let currentRunId = runId
      let isNewRun = false
      let newRunCreatedAt: string | null = null
      if (!currentRunId) {
        const run = await window.ipc.invoke('runs:create', {
          agentId,
        })
        currentRunId = run.id
        newRunCreatedAt = run.createdAt
        setRunId(currentRunId)
        analytics.chatSessionCreated(currentRunId)
        // Update active chat tab's runId to the new run
        setChatTabs((prev) => prev.map((tab) => (
          tab.id === submitTabId
            ? { ...tab, runId: currentRunId }
            : tab
        )))
        isNewRun = true
      }

      let titleSource = userMessage
      const hasMentions = (mentions?.length ?? 0) > 0

      if (hasAttachments || hasMentions) {
        type ContentPart =
          | { type: 'text'; text: string }
          | {
              type: 'attachment'
              path: string
              filename: string
              mimeType: string
              size?: number
              lineNumber?: number
            }

        const contentParts: ContentPart[] = []

        if (mentions && mentions.length > 0) {
          for (const mention of mentions) {
            contentParts.push({
              type: 'attachment',
              path: mention.path,
              filename: mention.displayName || mention.path.split('/').pop() || mention.path,
              mimeType: 'text/markdown',
              ...(mention.lineNumber !== undefined ? { lineNumber: mention.lineNumber } : {}),
            })
          }
        }

        for (const attachment of stagedAttachments) {
          contentParts.push({
            type: 'attachment',
            path: attachment.path,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            size: attachment.size,
          })
        }

        if (userMessage) {
          contentParts.push({ type: 'text', text: userMessage })
        } else {
          titleSource = stagedAttachments[0]?.filename ?? mentions?.[0]?.displayName ?? mentions?.[0]?.path ?? ''
        }

        // Shared IPC payload types can lag until package rebuilds; runtime validation still enforces schema.
        const attachmentPayload = contentParts as unknown as string
        await window.ipc.invoke('runs:createMessage', {
          runId: currentRunId,
          message: attachmentPayload,
          voiceInput: pendingVoiceInputRef.current || undefined,
          voiceOutput: ttsEnabledRef.current ? ttsModeRef.current : undefined,
          searchEnabled: searchEnabled || undefined,
        })
        analytics.chatMessageSent({
          voiceInput: pendingVoiceInputRef.current || undefined,
          voiceOutput: ttsEnabledRef.current ? ttsModeRef.current : undefined,
          searchEnabled: searchEnabled || undefined,
        })
      } else {
        await window.ipc.invoke('runs:createMessage', {
          runId: currentRunId,
          message: userMessage,
          voiceInput: pendingVoiceInputRef.current || undefined,
          voiceOutput: ttsEnabledRef.current ? ttsModeRef.current : undefined,
          searchEnabled: searchEnabled || undefined,
        })
        analytics.chatMessageSent({
          voiceInput: pendingVoiceInputRef.current || undefined,
          voiceOutput: ttsEnabledRef.current ? ttsModeRef.current : undefined,
          searchEnabled: searchEnabled || undefined,
        })
      }

      pendingVoiceInputRef.current = false

      if (isNewRun) {
        const inferredTitle = inferRunTitleFromMessage(titleSource)
        setRuns((prev) => {
          const withoutCurrent = prev.filter((run) => run.id !== currentRunId)
          return [{
            id: currentRunId!,
            title: inferredTitle,
            createdAt: newRunCreatedAt ?? new Date().toISOString(),
            agentId,
          }, ...withoutCurrent]
        })
      }
    } catch (error) {
      console.error('Failed to send message:', error)
    }
  }
  handlePromptSubmitRef.current = handlePromptSubmit

  const handleComposioConnected = useCallback((toolkitSlug: string) => {
    // Auto-send a continuation message when a Composio toolkit connects
    const name = composioDisplayNames[toolkitSlug] || toolkitSlug
    handlePromptSubmitRef.current?.({ text: `${name} connected successfully.`, files: [] })
  }, [])

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

  const handlePermissionResponse = useCallback(async (
    toolCallId: string,
    subflow: string[],
    response: 'approve' | 'deny',
    scope?: 'once' | 'session' | 'always',
  ) => {
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
        authorization: { subflow, toolCallId, response, scope }
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
    setRunId(null)
    setMessage('')
    setModelUsage(null)
    setIsProcessing(false)
    setPendingPermissionRequests(new Map())
    setPendingAskHumanRequests(new Map())
    setAllPermissionRequests(new Map())
    setPermissionResponses(new Map())
    setSelectedBackgroundTask(null)
    setChatViewportAnchor(activeChatTabIdRef.current, null)
    setChatViewStateByTab(prev => ({
      ...prev,
      [activeChatTabIdRef.current]: createEmptyChatTabViewState(),
    }))
  }, [setChatViewportAnchor])

  // Chat tab operations
  const applyChatTab = useCallback((tab: ChatTab) => {
    if (tab.runId) {
      loadRun(tab.runId)
    } else {
      loadRunRequestIdRef.current += 1
      setConversation([])
      setCurrentAssistantMessage('')
      setRunId(null)
      setMessage('')
      setModelUsage(null)
      setIsProcessing(false)
      setPendingPermissionRequests(new Map())
      setPendingAskHumanRequests(new Map())
      setAllPermissionRequests(new Map())
      setPermissionResponses(new Map())
      setChatViewportAnchor(tab.id, null)
    }
  }, [loadRun, setChatViewportAnchor])

  const restoreChatTabState = useCallback((tabId: string, fallbackRunId: string | null): boolean => {
    const cached = chatViewStateByTabRef.current[tabId]
    if (!cached) return false
    // Ignore stale cache snapshots that don't match the tab's current run binding.
    if (cached.runId !== fallbackRunId) return false

    const resolvedRunId = fallbackRunId
    setRunId(resolvedRunId)
    setConversation(cached.conversation)
    setCurrentAssistantMessage(cached.currentAssistantMessage)

    const pendingPermissions = new Map<string, z.infer<typeof ToolPermissionRequestEvent>>()
    for (const [toolCallId, request] of cached.allPermissionRequests.entries()) {
      if (!cached.permissionResponses.has(toolCallId)) {
        pendingPermissions.set(toolCallId, request)
      }
    }
    setPendingPermissionRequests(pendingPermissions)
    setPendingAskHumanRequests(new Map(cached.pendingAskHumanRequests))
    setAllPermissionRequests(new Map(cached.allPermissionRequests))
    setPermissionResponses(new Map(cached.permissionResponses))
    setIsProcessing(Boolean(resolvedRunId && processingRunIdsRef.current.has(resolvedRunId)))
    return true
  }, [])

  const openChatInNewTab = useCallback((targetRunId: string) => {
    cancelRecordingIfActive()
    const existingTab = chatTabs.find(t => t.runId === targetRunId)
    if (existingTab) {
      // Cancel stale in-flight loads from previously focused tabs.
      loadRunRequestIdRef.current += 1
      setActiveChatTabId(existingTab.id)
      const restored = restoreChatTabState(existingTab.id, existingTab.runId)
      if (processingRunIdsRef.current.has(targetRunId) || !restored) {
        loadRun(targetRunId)
      }
      return
    }
    const id = newChatTabId()
    setChatTabs(prev => [...prev, { id, runId: targetRunId }])
    setActiveChatTabId(id)
    loadRun(targetRunId)
  }, [chatTabs, loadRun, restoreChatTabState, cancelRecordingIfActive])

  const switchChatTab = useCallback((tabId: string) => {
    const tab = chatTabs.find(t => t.id === tabId)
    if (!tab) return
    if (tabId === activeChatTabId) return
    // Cancel any active recording when switching tabs
    if (isRecordingRef.current) {
      voiceRef.current.cancel()
      setIsRecording(false)
      isRecordingRef.current = false
    }
    saveChatScrollForTab(activeChatTabId)
    // Cancel stale in-flight loads from previously focused tabs.
    loadRunRequestIdRef.current += 1
    setActiveChatTabId(tabId)
    const restored = restoreChatTabState(tabId, tab.runId)
    if (tab.runId && processingRunIdsRef.current.has(tab.runId)) {
      loadRun(tab.runId)
      return
    }
    if (!restored) {
      applyChatTab(tab)
    }
  }, [chatTabs, activeChatTabId, applyChatTab, loadRun, restoreChatTabState, saveChatScrollForTab])

  const closeChatTab = useCallback((tabId: string) => {
    if (chatTabs.length <= 1) return
    const idx = chatTabs.findIndex(t => t.id === tabId)
    if (idx === -1) return
    saveChatScrollForTab(tabId)
    const nextTabs = chatTabs.filter(t => t.id !== tabId)
    setChatTabs(nextTabs)
    setChatViewStateByTab(prev => {
      if (!(tabId in prev)) return prev
      const next = { ...prev }
      delete next[tabId]
      return next
    })
    chatDraftsRef.current.delete(tabId)
    chatScrollTopByTabRef.current.delete(tabId)
    setToolOpenByTab((prev) => {
      if (!(tabId in prev)) return prev
      const next = { ...prev }
      delete next[tabId]
      return next
    })

    if (tabId === activeChatTabId && nextTabs.length > 0) {
      const newIdx = Math.min(idx, nextTabs.length - 1)
      const newActiveTab = nextTabs[newIdx]
      // Cancel stale in-flight loads from the closing tab.
      loadRunRequestIdRef.current += 1
      setActiveChatTabId(newActiveTab.id)
      const restored = restoreChatTabState(newActiveTab.id, newActiveTab.runId)
      if (newActiveTab.runId && processingRunIdsRef.current.has(newActiveTab.runId)) {
        loadRun(newActiveTab.runId)
      } else if (!restored) {
        applyChatTab(newActiveTab)
      }
    }
  }, [chatTabs, activeChatTabId, applyChatTab, loadRun, restoreChatTabState, saveChatScrollForTab])

  useEffect(() => {
    let cleanupScrollListener: (() => void) | undefined
    let pollRaf: number | undefined
    let restoreRafA: number | undefined
    let restoreRafB: number | undefined
    let restoreTimeout: ReturnType<typeof setTimeout> | undefined
    let cancelled = false

    const restoreScrollTop = (container: HTMLElement, top: number) => {
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight)
      const clampedTop = clampNumber(top, 0, maxScroll)
      container.scrollTop = clampedTop
    }

    const attach = (): boolean => {
      if (cancelled) return true
      const container = getChatScrollContainer(activeChatTabId)
      if (!container) return false

      const savedTop = chatScrollTopByTabRef.current.get(activeChatTabId)
      if (savedTop !== undefined) {
        // Reinforce restoration across a couple frames because stick-to-bottom
        // may schedule scroll adjustments during mount/resize.
        restoreScrollTop(container, savedTop)
        restoreRafA = requestAnimationFrame(() => {
          restoreScrollTop(container, savedTop)
          restoreRafB = requestAnimationFrame(() => {
            restoreScrollTop(container, savedTop)
          })
        })
        restoreTimeout = setTimeout(() => {
          restoreScrollTop(container, savedTop)
        }, 220)
      }

      const onScroll = () => {
        chatScrollTopByTabRef.current.set(activeChatTabId, container.scrollTop)
      }
      container.addEventListener('scroll', onScroll, { passive: true })
      cleanupScrollListener = () => {
        chatScrollTopByTabRef.current.set(activeChatTabId, container.scrollTop)
        container.removeEventListener('scroll', onScroll)
      }
      return true
    }

    let attempts = 0
    const maxAttempts = 60
    const pollAttach = () => {
      if (cancelled) return
      if (attach()) return
      if (attempts >= maxAttempts) return
      attempts += 1
      pollRaf = requestAnimationFrame(pollAttach)
    }
    pollAttach()

    return () => {
      cancelled = true
      cleanupScrollListener?.()
      if (pollRaf !== undefined) cancelAnimationFrame(pollRaf)
      if (restoreRafA !== undefined) cancelAnimationFrame(restoreRafA)
      if (restoreRafB !== undefined) cancelAnimationFrame(restoreRafB)
      if (restoreTimeout !== undefined) clearTimeout(restoreTimeout)
    }
  }, [
    activeChatTabId,
    selectedPath,
    isGraphOpen,
    isChatSidebarOpen,
    isRightPaneMaximized,
    getChatScrollContainer,
  ])

  // File tab operations
  const openFileInNewTab = useCallback((path: string) => {
    const existingTab = fileTabs.find(t => t.path === path)
    if (existingTab) {
      setActiveFileTabId(existingTab.id)
      setIsGraphOpen(false)
      setSelectedPath(path)
      return
    }
    const id = newFileTabId()
    setFileTabs(prev => [...prev, { id, path }])
    setActiveFileTabId(id)
    setIsGraphOpen(false)
    setSelectedPath(path)
  }, [fileTabs])

  const switchFileTab = useCallback((tabId: string) => {
    const tab = fileTabs.find(t => t.id === tabId)
    if (!tab) return
    setActiveFileTabId(tabId)
    setSelectedBackgroundTask(null)
    setExpandedFrom(null)
    // If chat-only maximize is active, drop back to a visible knowledge layout.
    if (isRightPaneMaximized) {
      setIsRightPaneMaximized(false)
    }
    if (isGraphTabPath(tab.path)) {
      setSelectedPath(null)
      setIsGraphOpen(true)
      return
    }
    setIsGraphOpen(false)
    setSelectedPath(tab.path)
  }, [fileTabs, isRightPaneMaximized])

  const closeFileTab = useCallback((tabId: string) => {
    const closingTab = fileTabs.find(t => t.id === tabId)
    if (closingTab && !isGraphTabPath(closingTab.path) && !isBaseFilePath(closingTab.path)) {
      removeEditorCacheForPath(closingTab.path)
      initialContentByPathRef.current.delete(closingTab.path)
      untitledRenameReadyPathsRef.current.delete(closingTab.path)
      frontmatterByPathRef.current.delete(closingTab.path)
      if (editorPathRef.current === closingTab.path) {
        editorPathRef.current = null
      }
    }
    if (closingTab && isBaseFilePath(closingTab.path)) {
      setBaseConfigByPath((prev) => {
        const next = { ...prev }
        delete next[closingTab.path]
        return next
      })
    }
    setFileTabs(prev => {
      if (prev.length <= 1) {
        // Last file tab - close it and go back to chat
        setActiveFileTabId(null)
        setSelectedPath(null)
        setIsGraphOpen(false)
          return []
      }
      const idx = prev.findIndex(t => t.id === tabId)
      if (idx === -1) return prev
      const next = prev.filter(t => t.id !== tabId)
      if (tabId === activeFileTabId && next.length > 0) {
        const newIdx = Math.min(idx, next.length - 1)
        const newActiveTab = next[newIdx]
        setActiveFileTabId(newActiveTab.id)
        if (isGraphTabPath(newActiveTab.path)) {
          setSelectedPath(null)
          setIsGraphOpen(true)
        } else {
          setIsGraphOpen(false)
              setSelectedPath(newActiveTab.path)
        }
      }
      return next
    })
    setEditorSessionByTabId((prev) => {
      if (!(tabId in prev)) return prev
      const next = { ...prev }
      delete next[tabId]
      return next
    })
    fileHistoryHandlersRef.current.delete(tabId)
  }, [activeFileTabId, fileTabs, removeEditorCacheForPath])

  const handleNewChatTab = useCallback(() => {
    // If there's already an empty "New chat" tab, switch to it
    const emptyTab = chatTabs.find(t => !t.runId)
    if (emptyTab) {
      if (emptyTab.id !== activeChatTabId) {
        setActiveChatTabId(emptyTab.id)
      }
    } else {
      // Create a new tab
      const id = newChatTabId()
      setChatTabs(prev => [...prev, { id, runId: null }])
      setActiveChatTabId(id)
    }
    handleNewChat()
    // Left-pane "new chat" should always open full chat view.
    if (selectedPath || isGraphOpen) {
      setExpandedFrom({ path: selectedPath, graph: isGraphOpen })
    } else {
      setExpandedFrom(null)
    }
    setIsRightPaneMaximized(false)
    setSelectedPath(null)
    setIsGraphOpen(false)
  }, [chatTabs, activeChatTabId, handleNewChat, selectedPath, isGraphOpen])

  // Sidebar variant: create/switch chat tab without leaving file/graph context.
  const handleNewChatTabInSidebar = useCallback(() => {
    const emptyTab = chatTabs.find(t => !t.runId)
    if (emptyTab) {
      if (emptyTab.id !== activeChatTabId) {
        setActiveChatTabId(emptyTab.id)
      }
    } else {
      const id = newChatTabId()
      setChatTabs(prev => [...prev, { id, runId: null }])
      setActiveChatTabId(id)
    }
    handleNewChat()
  }, [chatTabs, activeChatTabId, handleNewChat])

  // Palette → sidebar submission. Opens the sidebar (if closed), forces a fresh chat tab,
  // queues the message; the pending-submit effect (below) flushes it once state has settled
  // so handlePromptSubmit sees the new tab's null runId.
  const submitFromPalette = useCallback((text: string, mention: CommandPaletteMention | null) => {
    if (!isChatSidebarOpen) setIsChatSidebarOpen(true)
    handleNewChatTabInSidebar()
    setPendingPaletteSubmit({ text, mention })
  }, [isChatSidebarOpen, handleNewChatTabInSidebar])

  useEffect(() => {
    if (!pendingPaletteSubmit) return
    const fileMention: FileMention | undefined = pendingPaletteSubmit.mention
      ? {
          id: `palette-${Date.now()}`,
          path: pendingPaletteSubmit.mention.path,
          displayName: pendingPaletteSubmit.mention.displayName,
          lineNumber: pendingPaletteSubmit.mention.lineNumber,
        }
      : undefined
    void handlePromptSubmitRef.current?.(
      { text: pendingPaletteSubmit.text, files: [] },
      fileMention ? [fileMention] : undefined,
    )
    setPendingPaletteSubmit(null)
  }, [pendingPaletteSubmit])

  const toggleKnowledgePane = useCallback(() => {
    setIsRightPaneMaximized(false)
    setIsChatSidebarOpen(prev => !prev)
  }, [])

  const toggleRightPaneMaximize = useCallback(() => {
    setIsChatSidebarOpen(true)
    setIsRightPaneMaximized(prev => !prev)
  }, [])

  const handleOpenFullScreenChat = useCallback(() => {
    // Remember where we came from so the close button can return
    if (selectedPath || isGraphOpen) {
      setExpandedFrom({ path: selectedPath, graph: isGraphOpen })
    }
    setIsRightPaneMaximized(false)
    setSelectedPath(null)
    setIsGraphOpen(false)
  }, [selectedPath, isGraphOpen])

  const handleCloseFullScreenChat = useCallback(() => {
    if (expandedFrom) {
      if (expandedFrom.graph) {
        setIsGraphOpen(true)
      } else if (expandedFrom.path) {
        setSelectedPath(expandedFrom.path)
      }
      setExpandedFrom(null)
      setIsRightPaneMaximized(false)
    }
  }, [expandedFrom])

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

  const ensureFileTabForPath = useCallback((path: string) => {
    const existingTab = fileTabs.find((tab) => tab.path === path)
    if (existingTab) {
      setActiveFileTabId(existingTab.id)
      return
    }

    if (activeFileTabId) {
      const activeTab = fileTabs.find((tab) => tab.id === activeFileTabId)
      if (activeTab && !isGraphTabPath(activeTab.path) && !isBaseFilePath(activeTab.path)) {
        setFileTabs((prev) => prev.map((tab) => (
          tab.id === activeFileTabId ? { ...tab, path } : tab
        )))
        // Rebinds this tab to a different note path: reset editor session to clear undo history.
        setEditorSessionByTabId((prev) => ({
          ...prev,
          [activeFileTabId]: (prev[activeFileTabId] ?? 0) + 1,
        }))
        return
      }
    }

    const id = newFileTabId()
    setFileTabs((prev) => [...prev, { id, path }])
    setActiveFileTabId(id)
  }, [fileTabs, activeFileTabId])

  const ensureGraphFileTab = useCallback(() => {
    const existingGraphTab = fileTabs.find((tab) => isGraphTabPath(tab.path))
    if (existingGraphTab) {
      setActiveFileTabId(existingGraphTab.id)
      return
    }
    const id = newFileTabId()
    setFileTabs((prev) => [...prev, { id, path: GRAPH_TAB_PATH }])
    setActiveFileTabId(id)
  }, [fileTabs])

  const applyViewState = useCallback(async (view: ViewState) => {
    switch (view.type) {
      case 'file':
        setSelectedBackgroundTask(null)
        setIsGraphOpen(false)
        setExpandedFrom(null)
        // Preserve split vs knowledge-max mode when navigating knowledge files.
        // Only exit chat-only maximize, because that would hide the selected file.
        if (isRightPaneMaximized) {
          setIsRightPaneMaximized(false)
        }
        setSelectedPath(view.path)
        ensureFileTabForPath(view.path)
        return
      case 'graph':
        setSelectedBackgroundTask(null)
        setSelectedPath(null)
        setExpandedFrom(null)
        setIsGraphOpen(true)
        ensureGraphFileTab()
        if (isRightPaneMaximized) {
          setIsRightPaneMaximized(false)
        }
        return
      case 'task':
        setSelectedPath(null)
        setIsGraphOpen(false)
        setExpandedFrom(null)
        setIsRightPaneMaximized(false)
        setSelectedBackgroundTask(view.name)
        return
      case 'chat':
        setSelectedPath(null)
        setIsGraphOpen(false)
        setExpandedFrom(null)
        setIsRightPaneMaximized(false)
        setSelectedBackgroundTask(null)
        if (view.runId) {
          await loadRun(view.runId)
        } else {
          handleNewChat()
        }
        return
    }
  }, [ensureFileTabForPath, ensureGraphFileTab, handleNewChat, isRightPaneMaximized, loadRun])

  const navigateToView = useCallback(async (nextView: ViewState) => {
    const current = currentViewState
    if (viewStatesEqual(current, nextView)) return

    cancelRecordingIfActive()
    const nextHistory = {
      back: appendUnique(historyRef.current.back, current),
      forward: [] as ViewState[],
    }
    setHistory(nextHistory)
    await applyViewState(nextView)
  }, [appendUnique, applyViewState, cancelRecordingIfActive, currentViewState, setHistory])

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

  const handleBaseConfigChange = useCallback((path: string, config: BaseConfig) => {
    setBaseConfigByPath((prev) => ({ ...prev, [path]: config }))
  }, [])

  const handleBaseSave = useCallback(async (name: string | null) => {
    if (!selectedPath) return
    const isDefault = selectedPath === BASES_DEFAULT_TAB_PATH
    const config = baseConfigByPath[selectedPath] ?? DEFAULT_BASE_CONFIG

    if (isDefault && name) {
      // Save as new base file
      const safeName = name.replace(/[\\/]/g, '-').trim()
      const newPath = `bases/${safeName}.base`
      const fileConfig = { ...config, name: safeName }
      try {
        await window.ipc.invoke('workspace:writeFile', {
          path: newPath,
          data: JSON.stringify(fileConfig, null, 2),
        })
        setBaseConfigByPath((prev) => ({ ...prev, [newPath]: fileConfig }))
        // Refresh tree then navigate to the new file
        const newTree = await loadDirectory()
        setTree(newTree)
        void navigateToView({ type: 'file', path: newPath })
      } catch (err) {
        console.error('Failed to save base:', err)
      }
    } else if (!isDefault) {
      // Save in place
      try {
        await window.ipc.invoke('workspace:writeFile', {
          path: selectedPath,
          data: JSON.stringify(config, null, 2),
        })
      } catch (err) {
        console.error('Failed to save base:', err)
      }
    }
  }, [selectedPath, baseConfigByPath, loadDirectory, navigateToView])

  // External search set by app-navigation tool (passed to BasesView)
  const [externalBaseSearch, setExternalBaseSearch] = useState<string | undefined>(undefined)

  // Process pending app-navigation results
  useEffect(() => {
    const result = pendingAppNavRef.current
    if (!result) return
    pendingAppNavRef.current = null

    switch (result.action) {
      case 'open-note':
        navigateToFile(result.path as string)
        break
      case 'open-view':
        if (result.view === 'graph') void navigateToView({ type: 'graph' })
        if (result.view === 'bases') {
          void navigateToView({ type: 'file', path: BASES_DEFAULT_TAB_PATH })
        }
        break
      case 'update-base-view': {
        // Navigate to bases if not already there
        const targetPath = selectedPath && isBaseFilePath(selectedPath) ? selectedPath : BASES_DEFAULT_TAB_PATH
        if (!selectedPath || !isBaseFilePath(selectedPath)) {
          void navigateToView({ type: 'file', path: BASES_DEFAULT_TAB_PATH })
        }

        // Apply updates to the base config
        const updates = result.updates as Record<string, unknown> | undefined
        if (updates) {
          setBaseConfigByPath(prev => {
            const current = prev[targetPath] ?? { ...DEFAULT_BASE_CONFIG }
            const next = { ...current }

            // Apply filter updates
            const filterUpdates = updates.filters as Record<string, unknown> | undefined
            if (filterUpdates) {
              if (filterUpdates.clear) {
                next.filters = []
              }
              if (filterUpdates.set) {
                next.filters = filterUpdates.set as Array<{ category: string; value: string }>
              }
              if (filterUpdates.add) {
                const toAdd = filterUpdates.add as Array<{ category: string; value: string }>
                const existing = next.filters
                for (const f of toAdd) {
                  if (!existing.some(e => e.category === f.category && e.value === f.value)) {
                    existing.push(f)
                  }
                }
              }
              if (filterUpdates.remove) {
                const toRemove = filterUpdates.remove as Array<{ category: string; value: string }>
                next.filters = next.filters.filter(
                  e => !toRemove.some(r => r.category === e.category && r.value === e.value)
                )
              }
            }

            // Apply column updates
            const colUpdates = updates.columns as Record<string, unknown> | undefined
            if (colUpdates) {
              if (colUpdates.set) {
                next.visibleColumns = colUpdates.set as string[]
              }
              if (colUpdates.add) {
                const toAdd = colUpdates.add as string[]
                for (const col of toAdd) {
                  if (!next.visibleColumns.includes(col)) next.visibleColumns.push(col)
                }
              }
              if (colUpdates.remove) {
                const toRemove = new Set(colUpdates.remove as string[])
                next.visibleColumns = next.visibleColumns.filter(c => !toRemove.has(c))
              }
            }

            // Apply sort
            if (updates.sort) {
              next.sort = updates.sort as { field: string; dir: 'asc' | 'desc' }
            }

            return { ...prev, [targetPath]: next }
          })

          // Apply search externally
          if (updates.search !== undefined) {
            setExternalBaseSearch(updates.search as string || undefined)
          }
        }
        break
      }
      case 'create-base':
        if (result.path) {
          navigateToFile(result.path as string)
        }
        break
    }
  })

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

  // Keyboard shortcut: Cmd+K / Ctrl+K opens the unified palette (defaults to Chat mode).
  // If an editor tab is currently active, capture cursor context so Chat mode shows the
  // note + line as a removable chip.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        const activeId = activeFileTabIdRef.current
        const handle = activeId ? editorRefsByTabId.current.get(activeId) : null
        setPaletteContext(handle?.getCursorContext() ?? null)
        setIsSearchOpen(true)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Route undo/redo to the active markdown tab only (prevents cross-tab browser undo behavior).
  useEffect(() => {
    const handleHistoryKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.altKey) return

      const key = e.key.toLowerCase()
      const wantsUndo = key === 'z' && !e.shiftKey
      const wantsRedo = (key === 'z' && e.shiftKey) || (!isMac && key === 'y')
      if (!wantsUndo && !wantsRedo) return

      if (!selectedPath || !selectedPath.endsWith('.md') || !activeFileTabId) return

      const target = e.target as EventTarget | null
      if (target instanceof HTMLElement) {
        const inTipTapEditor = Boolean(target.closest('.tiptap-editor'))
        const inOtherTextInput = (
          target instanceof HTMLInputElement
          || target instanceof HTMLTextAreaElement
          || target.isContentEditable
        ) && !inTipTapEditor
        if (inOtherTextInput) return
      }

      const handlers = fileHistoryHandlersRef.current.get(activeFileTabId)
      if (!handlers) return

      e.preventDefault()
      e.stopPropagation()
      if (wantsUndo) {
        handlers.undo()
      } else {
        handlers.redo()
      }
    }

    document.addEventListener('keydown', handleHistoryKeyDown, true)
    return () => document.removeEventListener('keydown', handleHistoryKeyDown, true)
  }, [activeFileTabId, isMac, selectedPath])

  // Keyboard shortcuts for tab management
  useEffect(() => {
    const handleTabKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const rightPaneAvailable = Boolean((selectedPath || isGraphOpen) && isChatSidebarOpen)
      const targetPane: ShortcutPane = rightPaneAvailable
        ? (isRightPaneMaximized ? 'right' : activeShortcutPane)
        : 'left'
      const inFileView = targetPane === 'left' && Boolean(selectedPath || isGraphOpen)
      const selectedKnowledgePath = isGraphOpen ? GRAPH_TAB_PATH : selectedPath
      const targetFileTabId = activeFileTabId ?? (
        selectedKnowledgePath
          ? (fileTabs.find((tab) => tab.path === selectedKnowledgePath)?.id ?? null)
          : null
      )

      // Cmd+W — close active tab
      if (e.key === 'w') {
        e.preventDefault()
        if (inFileView && targetFileTabId) {
          closeFileTab(targetFileTabId)
        } else {
          closeChatTab(activeChatTabId)
        }
        return
      }

      // Cmd+1..9 — switch to tab N (Cmd+9 always goes to last tab)
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault()
        const n = parseInt(e.key, 10)
        if (inFileView) {
          const idx = e.key === '9' ? fileTabs.length - 1 : n - 1
          const tab = fileTabs[idx]
          if (tab) switchFileTab(tab.id)
        } else {
          const idx = e.key === '9' ? chatTabs.length - 1 : n - 1
          const tab = chatTabs[idx]
          if (tab) switchChatTab(tab.id)
        }
        return
      }

      // Cmd+Shift+] — next tab, Cmd+Shift+[ — previous tab
      if (e.shiftKey && (e.key === ']' || e.key === '[')) {
        e.preventDefault()
        const direction = e.key === ']' ? 1 : -1
        if (inFileView) {
          const currentIdx = fileTabs.findIndex(t => t.id === targetFileTabId)
          if (currentIdx === -1) return
          const nextIdx = (currentIdx + direction + fileTabs.length) % fileTabs.length
          switchFileTab(fileTabs[nextIdx].id)
        } else {
          const currentIdx = chatTabs.findIndex(t => t.id === activeChatTabId)
          if (currentIdx === -1) return
          const nextIdx = (currentIdx + direction + chatTabs.length) % chatTabs.length
          switchChatTab(chatTabs[nextIdx].id)
        }
        return
      }
    }
    document.addEventListener('keydown', handleTabKeyDown)
    return () => document.removeEventListener('keydown', handleTabKeyDown)
  }, [selectedPath, isGraphOpen, isChatSidebarOpen, isRightPaneMaximized, activeShortcutPane, chatTabs, fileTabs, activeChatTabId, activeFileTabId, closeChatTab, closeFileTab, switchChatTab, switchFileTab])

  const toggleExpand = (path: string, kind: 'file' | 'dir') => {
    if (kind === 'file') {
      navigateToFile(path)
      return
    }

    // Top-level knowledge folders (except Notes) open as a bases view with folder filter
    const parts = path.split('/')
    if (parts.length === 2 && parts[0] === 'knowledge' && parts[1] !== 'Notes') {
      const folderName = parts[1]
      const folderCfg = FOLDER_BASE_CONFIGS[folderName]
      setBaseConfigByPath((prev) => ({
        ...prev,
        [BASES_DEFAULT_TAB_PATH]: {
          ...DEFAULT_BASE_CONFIG,
          name: folderName,
          filters: [{ category: 'folder', value: folderName }],
          ...(folderCfg && {
            visibleColumns: folderCfg.visibleColumns,
            sort: folderCfg.sort,
          }),
        },
      }))
      if (!selectedPath && !isGraphOpen && !selectedBackgroundTask) {
        setIsChatSidebarOpen(false)
        setIsRightPaneMaximized(false)
      }
      void navigateToView({ type: 'file', path: BASES_DEFAULT_TAB_PATH })
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
    createNote: async (parentPath: string = 'knowledge/Notes') => {
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
    createFolder: async (parentPath: string = 'knowledge/Notes') => {
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
      // From chat-only landing state, open graph directly in full knowledge view.
      if (!selectedPath && !isGraphOpen && !selectedBackgroundTask) {
        setIsChatSidebarOpen(false)
        setIsRightPaneMaximized(false)
      }
      void navigateToView({ type: 'graph' })
    },
    openBases: () => {
      if (!selectedPath && !isGraphOpen && !selectedBackgroundTask) {
        setIsChatSidebarOpen(false)
        setIsRightPaneMaximized(false)
      }
      void navigateToView({ type: 'file', path: BASES_DEFAULT_TAB_PATH })
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
        untitledRenameReadyPathsRef.current.delete(oldPath)
        const rewriteForRename = (content: string) =>
          isDir ? content : rewriteWikiLinksForRenamedFileInMarkdown(content, oldPath, newPath)
        setFileTabs(prev => prev.map(tab => (tab.path === oldPath ? { ...tab, path: newPath } : tab)))
        if (editorPathRef.current === oldPath) {
          editorPathRef.current = newPath
        }
        // Migrate frontmatter entry
        const fmEntry = frontmatterByPathRef.current.get(oldPath)
        if (fmEntry !== undefined) {
          frontmatterByPathRef.current.delete(oldPath)
          frontmatterByPathRef.current.set(newPath, fmEntry)
        }
        const baseline = initialContentByPathRef.current.get(oldPath)
        if (baseline !== undefined) {
          initialContentByPathRef.current.delete(oldPath)
          initialContentByPathRef.current.set(newPath, rewriteForRename(baseline))
        }
        const cachedContent = editorContentByPathRef.current.get(oldPath)
        if (cachedContent !== undefined) {
          const rewrittenCachedContent = rewriteForRename(cachedContent)
          editorContentByPathRef.current.delete(oldPath)
          editorContentByPathRef.current.set(newPath, rewrittenCachedContent)
          setEditorContentByPath(prev => {
            if (!(oldPath in prev)) return prev
            const next = { ...prev }
            delete next[oldPath]
            next[newPath] = rewriteForRename(cachedContent)
            return next
          })
        }
        if (selectedPath === oldPath) {
          const rewrittenEditorContent = rewriteForRename(editorContentRef.current)
          editorContentRef.current = rewrittenEditorContent
          setEditorContent(rewrittenEditorContent)
          initialContentRef.current = rewriteForRename(initialContentRef.current)
        }
        if (selectedPath === oldPath) setSelectedPath(newPath)
      } catch (err) {
        console.error('Failed to rename:', err)
        throw err
      }
    },
    remove: async (path: string) => {
      try {
        await window.ipc.invoke('workspace:remove', { path, opts: { trash: true } })
        if (path.endsWith('.md')) {
          removeEditorCacheForPath(path)
          initialContentByPathRef.current.delete(path)
          untitledRenameReadyPathsRef.current.delete(path)
          frontmatterByPathRef.current.delete(path)
        }
        // Close any file tab showing the deleted file
        const tabForFile = fileTabs.find(t => t.path === path)
        if (tabForFile) {
          closeFileTab(tabForFile.id)
        } else if (selectedPath === path) {
          setSelectedPath(null)
        }
      } catch (err) {
        console.error('Failed to remove:', err)
        throw err
      }
    },
    copyPath: (path: string) => {
      const fullPath = workspaceRoot ? `${workspaceRoot}/${path}` : path
      navigator.clipboard.writeText(fullPath).catch(() => {
        const textarea = document.createElement('textarea')
        textarea.value = fullPath
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      })
    },
    onOpenInNewTab: (path: string) => {
      openFileInNewTab(path)
    },
  }), [tree, selectedPath, isGraphOpen, selectedBackgroundTask, workspaceRoot, navigateToFile, navigateToView, openFileInNewTab, fileTabs, closeFileTab, removeEditorCacheForPath])

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

    // If tab already exists for this path (e.g. second call after transcription),
    // force a content reload instead of creating a duplicate tab.
    const existingTab = fileTabs.find(tab => tab.path === notePath)
    if (existingTab) {
      setActiveFileTabId(existingTab.id)
      // Read fresh content from disk and update the editor
      try {
        const result = await window.ipc.invoke('workspace:readFile', { path: notePath, encoding: 'utf8' })
        const { raw: fm, body } = splitFrontmatter(result.data)
        frontmatterByPathRef.current.set(notePath, fm)
        setFileContent(body)
        setEditorContent(body)
        editorContentRef.current = body
        editorPathRef.current = notePath
        initialContentRef.current = body
        initialContentByPathRef.current.set(notePath, body)
        setEditorContentByPath(prev => ({ ...prev, [notePath]: body }))
        editorContentByPathRef.current.set(notePath, body)
        // Bump editor session to force TipTap to pick up the new content
        setEditorSessionByTabId(prev => ({
          ...prev,
          [existingTab.id]: (prev[existingTab.id] ?? 0) + 1,
        }))
      } catch {
        // File read failed — ignore
      }
      return
    }

    // First call — open the file in a tab
    navigateToFile(notePath)
  }, [loadDirectory, navigateToFile, fileTabs])

  const meetingNotePathRef = useRef<string | null>(null)
  const pendingCalendarEventRef = useRef<CalendarEventMeta | undefined>(undefined)
  const [meetingSummarizing, setMeetingSummarizing] = useState(false)
  const [showMeetingPermissions, setShowMeetingPermissions] = useState(false)

  const [checkingPermission, setCheckingPermission] = useState(false)

  const startMeetingNow = useCallback(async () => {
    const calEvent = pendingCalendarEventRef.current
    pendingCalendarEventRef.current = undefined
    const notePath = await meetingTranscription.start(calEvent)
    if (notePath) {
      meetingNotePathRef.current = notePath
      await handleVoiceNoteCreated(notePath)
    }
  }, [meetingTranscription, handleVoiceNoteCreated])

  const handleCheckPermissionAndRetry = useCallback(async () => {
    setCheckingPermission(true)
    try {
      const { granted } = await window.ipc.invoke('meeting:checkScreenPermission', null)
      if (granted) {
        setShowMeetingPermissions(false)
        await startMeetingNow()
      }
    } finally {
      setCheckingPermission(false)
    }
  }, [startMeetingNow])

  const handleOpenScreenRecordingSettings = useCallback(async () => {
    await window.ipc.invoke('meeting:openScreenRecordingSettings', null)
  }, [])

  const handleToggleMeeting = useCallback(async () => {
    if (meetingTranscription.state === 'recording') {
      await meetingTranscription.stop()

      // Read the final transcript and generate meeting notes via LLM
      const notePath = meetingNotePathRef.current
      if (notePath) {
        setMeetingSummarizing(true)
        try {
          const result = await window.ipc.invoke('workspace:readFile', { path: notePath, encoding: 'utf8' })
          const fileContent = result.data
          if (fileContent && fileContent.trim()) {
            // Extract meeting start time and calendar event from frontmatter
            const dateMatch = fileContent.match(/^date:\s*"(.+)"$/m)
            const meetingStartTime = dateMatch?.[1]
            // If a calendar event was linked, pass it directly so the summarizer
            // skips scanning and uses this event for attendee/title info.
            const calEventMatch = fileContent.match(/^calendar_event:\s*'(.+)'$/m)
            const calendarEventJson = calEventMatch?.[1]?.replace(/''/g, "'")
            const { notes } = await window.ipc.invoke('meeting:summarize', { transcript: fileContent, meetingStartTime, calendarEventJson })
            if (notes) {
              // Prepend meeting notes above the existing transcript block
              const { raw: fm, body } = splitFrontmatter(fileContent)
              const fmTitleMatch = fileContent.match(/^title:\s*(.+)$/m)
              const noteTitle = fmTitleMatch?.[1]?.trim() || 'Meeting Notes'
              const cleanedNotes = notes.replace(/^#{1,2}\s+.+\n+/, '')
              // Extract the existing transcript block and preserve it as-is
              const transcriptBlockMatch = body.match(/(```transcript\n[\s\S]*?\n```)/)
              const transcriptBlock = transcriptBlockMatch?.[1] || ''
              const newBody = `# ${noteTitle}\n\n` + cleanedNotes + (transcriptBlock ? '\n\n' + transcriptBlock : '')
              const newContent = fm ? `${fm}\n${newBody}` : newBody
              await window.ipc.invoke('workspace:writeFile', {
                path: notePath,
                data: newContent,
                opts: { encoding: 'utf8' },
              })
              // Refresh the file view
              await handleVoiceNoteCreated(notePath)
            }
          }
        } catch (err) {
          console.error('[meeting] Failed to generate meeting notes:', err)
        }
        setMeetingSummarizing(false)
        meetingNotePathRef.current = null
      }
    } else if (meetingTranscription.state === 'idle') {
      // On macOS, check screen recording permission before starting
      if (isMac) {
        const result = await window.ipc.invoke('meeting:checkScreenPermission', null)
        console.log('[meeting] Permission check result:', result)
        if (!result.granted) {
          setShowMeetingPermissions(true)
          return
        }
      }
      await startMeetingNow()
    }
  }, [meetingTranscription, handleVoiceNoteCreated, startMeetingNow])
  handleToggleMeetingRef.current = handleToggleMeeting

  // Listen for calendar block "join meeting & take notes" events
  useEffect(() => {
    const handler = () => {
      // Read calendar event data set by the calendar block on window
      const pending = window.__pendingCalendarEvent
      window.__pendingCalendarEvent = undefined
      if (pending) {
        pendingCalendarEventRef.current = {
          summary: pending.summary,
          start: pending.start,
          end: pending.end,
          location: pending.location,
          htmlLink: pending.htmlLink,
          conferenceLink: pending.conferenceLink,
          source: pending.source,
        }
      }
      // Use the same toggle flow — it will pick up pendingCalendarEventRef
      handleToggleMeetingRef.current?.()
    }
    window.addEventListener('calendar-block:join-meeting', handler)
    return () => window.removeEventListener('calendar-block:join-meeting', handler)
  }, [])

  // Email block: draft with assistant
  useEffect(() => {
    const handler = () => {
      const pending = window.__pendingEmailDraft
      if (pending) {
        setPresetMessage(pending.prompt)
        setIsChatSidebarOpen(true)
        window.__pendingEmailDraft = undefined
      }
    }
    window.addEventListener('email-block:draft-with-assistant', handler)
    return () => window.removeEventListener('email-block:draft-with-assistant', handler)
  }, [])

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

      const graphFilePaths = knowledgeFilePaths.filter((p) => {
        const normalized = stripKnowledgePrefix(p)
        return !normalized.toLowerCase().startsWith('meetings/')
      })

      const nodeSet = new Set(graphFilePaths)
      const edges: GraphEdge[] = []
      const edgeKeys = new Set<string>()

      const contents = await Promise.all(
        graphFilePaths.map(async (path) => {
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

      const nodes = graphFilePaths.map((path) => {
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

  const renderConversationItem = (item: ConversationItem, tabId: string) => {
    if (isChatMessage(item)) {
      if (item.role === 'user') {
        if (item.attachments && item.attachments.length > 0) {
          return (
            <Message key={item.id} from={item.role} data-message-id={item.id}>
              <MessageContent className="group-[.is-user]:bg-transparent group-[.is-user]:px-0 group-[.is-user]:py-0 group-[.is-user]:rounded-none">
                <ChatMessageAttachments attachments={item.attachments} />
              </MessageContent>
              {item.content && (
                <MessageContent>{item.content}</MessageContent>
              )}
            </Message>
          )
        }
        const { message, files } = parseAttachedFiles(item.content)
        return (
          <Message key={item.id} from={item.role} data-message-id={item.id}>
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
        <Message key={item.id} from={item.role} data-message-id={item.id}>
          <MessageContent>
            <MessageResponse components={streamdownComponents}>{item.content}</MessageResponse>
          </MessageContent>
        </Message>
      )
    }

    if (isToolCall(item)) {
      const appActionData = getAppActionCardData(item)
      if (appActionData) {
        return <AppActionCard key={item.id} data={appActionData} status={item.status} />
      }
      const webSearchData = getWebSearchCardData(item)
      if (webSearchData) {
        return (
          <WebSearchResult
            key={item.id}
            query={webSearchData.query}
            results={webSearchData.results}
            status={item.status}
            title={webSearchData.title}
          />
        )
      }
      const composioConnectData = getComposioConnectCardData(item)
      if (composioConnectData) {
        // Skip rendering if this is a duplicate "already connected" card
        if (composioConnectData.hidden) return null
        return (
          <ComposioConnectCard
            key={item.id}
            toolkitSlug={composioConnectData.toolkitSlug}
            toolkitDisplayName={composioConnectData.toolkitDisplayName}
            status={item.status}
            alreadyConnected={composioConnectData.alreadyConnected}
            onConnected={handleComposioConnected}
          />
        )
      }
      const toolTitle = getToolDisplayName(item)
      const errorText = item.status === 'error' ? 'Tool error' : ''
      const output = normalizeToolOutput(item.result, item.status)
      const input = normalizeToolInput(item.input)
      return (
        <Tool
          key={item.id}
          open={isToolOpenForTab(tabId, item.id)}
          onOpenChange={(open) => setToolOpenForTab(tabId, item.id, open)}
        >
          <ToolHeader
            title={toolTitle}
            type={`tool-${item.name}`}
            state={toToolState(item.status)}
          />
          <ToolContent>
            <ToolTabbedContent input={input} output={output} errorText={errorText} />
          </ToolContent>
        </Tool>
      )
    }

    if (isErrorMessage(item)) {
      return (
        <Message key={item.id} from="assistant" data-message-id={item.id}>
          <MessageContent className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive">
            <pre className="whitespace-pre-wrap font-mono text-xs">{item.message}</pre>
          </MessageContent>
        </Message>
      )
    }

    return null
  }

  const activeChatTabState = React.useMemo<ChatTabViewState>(() => ({
    runId,
    conversation,
    currentAssistantMessage,
    pendingAskHumanRequests,
    allPermissionRequests,
    permissionResponses,
  }), [
    runId,
    conversation,
    currentAssistantMessage,
    pendingAskHumanRequests,
    allPermissionRequests,
    permissionResponses,
  ])
  const emptyChatTabState = React.useMemo<ChatTabViewState>(() => createEmptyChatTabViewState(), [])
  const getChatTabStateForRender = useCallback((tabId: string): ChatTabViewState => {
    if (tabId === activeChatTabId) return activeChatTabState
    return chatViewStateByTab[tabId] ?? emptyChatTabState
  }, [activeChatTabId, activeChatTabState, chatViewStateByTab, emptyChatTabState])
  const hasConversation = activeChatTabState.conversation.length > 0 || activeChatTabState.currentAssistantMessage
  const selectedTask = selectedBackgroundTask
    ? backgroundTasks.find(t => t.name === selectedBackgroundTask)
    : null
  const isRightPaneContext = Boolean(selectedPath || isGraphOpen)
  const isRightPaneOnlyMode = isRightPaneContext && isChatSidebarOpen && isRightPaneMaximized
  const shouldCollapseLeftPane = isRightPaneOnlyMode
  const openMarkdownTabs = React.useMemo(() => {
    const markdownTabs = fileTabs.filter(tab => tab.path.endsWith('.md'))
    if (selectedPath?.endsWith('.md')) {
      const hasSelectedTab = markdownTabs.some(tab => tab.path === selectedPath)
      if (!hasSelectedTab) {
        return [...markdownTabs, { id: '__active-markdown-tab__', path: selectedPath }]
      }
    }
    return markdownTabs
  }, [fileTabs, selectedPath])

  return (
    <TooltipProvider delayDuration={0}>
      <SidebarSectionProvider defaultSection="tasks" onSectionChange={(section) => {
        if (section === 'knowledge' && !selectedPath && !isGraphOpen) {
          void navigateToView({ type: 'file', path: BASES_DEFAULT_TAB_PATH })
        }
      }}>
        <div className="flex h-svh w-full overflow-hidden">
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
                onNewChat: handleNewChatTab,
                onSelectRun: (runIdToLoad) => {
                  cancelRecordingIfActive()
                  if (selectedPath || isGraphOpen) {
                    setIsChatSidebarOpen(true)
                  }

                  // If already open in a chat tab, switch to it
                  const existingTab = chatTabs.find(t => t.runId === runIdToLoad)
                  if (existingTab) {
                    switchChatTab(existingTab.id)
                    return
                  }
                  // In two-pane mode, keep current knowledge/graph context and just swap chat context.
                  if (selectedPath || isGraphOpen) {
                    setChatTabs(prev => prev.map(t => t.id === activeChatTabId ? { ...t, runId: runIdToLoad } : t))
                    loadRun(runIdToLoad)
                    return
                  }

                  // Outside two-pane mode, navigate to chat.
                  setChatTabs(prev => prev.map(t => t.id === activeChatTabId ? { ...t, runId: runIdToLoad } : t))
                  void navigateToView({ type: 'chat', runId: runIdToLoad })
                },
                onOpenInNewTab: (targetRunId) => {
                  openChatInNewTab(targetRunId)
                },
                onDeleteRun: async (runIdToDelete) => {
                  try {
                    await window.ipc.invoke('runs:delete', { runId: runIdToDelete })
                    // Close any chat tab showing the deleted run
                    const tabForRun = chatTabs.find(t => t.runId === runIdToDelete)
                    if (tabForRun) {
                      if (chatTabs.length > 1) {
                        closeChatTab(tabForRun.id)
                      } else {
                        // Only one tab, reset it to new chat
                        setChatTabs([{ id: tabForRun.id, runId: null }])
                        if (selectedPath || isGraphOpen) {
                          handleNewChat()
                        } else {
                          void navigateToView({ type: 'chat', runId: null })
                        }
                      }
                    } else if (runId === runIdToDelete) {
                      if (selectedPath || isGraphOpen) {
                        setChatTabs(prev => prev.map(t => t.id === activeChatTabId ? { ...t, runId: null } : t))
                        handleNewChat()
                      } else {
                        void navigateToView({ type: 'chat', runId: null })
                      }
                    }
                    await loadRuns()
                  } catch (err) {
                    console.error('Failed to delete run:', err)
                  }
                },
                onSelectBackgroundTask: (taskName) => {
                  void navigateToView({ type: 'task', name: taskName })
                },
              }}
              backgroundTasks={backgroundTasks}
              selectedBackgroundTask={selectedBackgroundTask}
            />
            <SidebarInset
              className={cn(
                "overflow-hidden! min-h-0 min-w-0 transition-[max-width] duration-200 ease-linear",
                shouldCollapseLeftPane && "pointer-events-none select-none"
              )}
              style={shouldCollapseLeftPane ? { maxWidth: 0 } : { maxWidth: '100%' }}
              aria-hidden={shouldCollapseLeftPane}
              onMouseDownCapture={() => setActiveShortcutPane('left')}
              onFocusCapture={() => setActiveShortcutPane('left')}
            >
              {/* Header - also serves as titlebar drag region, adjusts padding when sidebar collapsed */}
              <ContentHeader
                onNavigateBack={() => { void navigateBack() }}
                onNavigateForward={() => { void navigateForward() }}
                canNavigateBack={canNavigateBack}
                canNavigateForward={canNavigateForward}
                collapsedLeftPaddingPx={collapsedLeftPaddingPx}
              >
                {(selectedPath || isGraphOpen) && fileTabs.length >= 1 ? (
                  <TabBar
                    tabs={fileTabs}
                    activeTabId={activeFileTabId ?? ''}
                    getTabTitle={getFileTabTitle}
                    getTabId={(t) => t.id}
                    onSwitchTab={switchFileTab}
                    onCloseTab={closeFileTab}
                    allowSingleTabClose={fileTabs.length === 1 && (isGraphOpen || (selectedPath != null && isBaseFilePath(selectedPath)))}
                  />
                ) : (
                  <TabBar
                    tabs={chatTabs}
                    activeTabId={activeChatTabId}
                    getTabTitle={getChatTabTitle}
                    getTabId={(t) => t.id}
                    isProcessing={isChatTabProcessing}
                    onSwitchTab={switchChatTab}
                    onCloseTab={closeChatTab}
                  />
                )}
                {selectedPath && selectedPath.endsWith('.md') && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground self-center shrink-0 pl-2">
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
                {selectedPath && selectedPath.startsWith('knowledge/') && selectedPath.endsWith('.md') && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => {
                          if (versionHistoryPath) {
                            setVersionHistoryPath(null)
                            setViewingHistoricalVersion(null)
                          } else {
                            setVersionHistoryPath(selectedPath)
                          }
                        }}
                        className={cn(
                          "titlebar-no-drag flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors self-center shrink-0",
                          versionHistoryPath && "bg-accent text-foreground"
                        )}
                        aria-label="Version history"
                      >
                        <HistoryIcon className="size-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Version history</TooltipContent>
                  </Tooltip>
                )}
                {!selectedPath && !isGraphOpen && !selectedTask && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={handleNewChatTab}
                        className="titlebar-no-drag flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors self-center shrink-0"
                        aria-label="New chat tab"
                      >
                        <SquarePen className="size-5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">New chat tab</TooltipContent>
                  </Tooltip>
                )}
                {!selectedPath && !isGraphOpen && expandedFrom && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={handleCloseFullScreenChat}
                        className="titlebar-no-drag flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors self-center shrink-0"
                        aria-label="Restore two-pane view"
                      >
                        <Minimize2 className="size-5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Restore two-pane view</TooltipContent>
                  </Tooltip>
                )}
                {(selectedPath || isGraphOpen) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={toggleKnowledgePane}
                        className="titlebar-no-drag flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors -mr-1 self-center shrink-0"
                        aria-label={isChatSidebarOpen ? "Maximize knowledge view" : "Restore two-pane view"}
                      >
                        {isChatSidebarOpen ? <Maximize2 className="size-5" /> : <Minimize2 className="size-5" />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {isChatSidebarOpen ? "Maximize knowledge view" : "Restore two-pane view"}
                    </TooltipContent>
                  </Tooltip>
                )}
              </ContentHeader>

              {selectedPath && isBaseFilePath(selectedPath) ? (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <BasesView
                    tree={tree}
                    onSelectNote={(path) => navigateToFile(path)}
                    config={baseConfigByPath[selectedPath] ?? DEFAULT_BASE_CONFIG}
                    onConfigChange={(cfg) => handleBaseConfigChange(selectedPath, cfg)}
                    isDefaultBase={selectedPath === BASES_DEFAULT_TAB_PATH}
                    onSave={(name) => void handleBaseSave(name)}
                    externalSearch={externalBaseSearch}
                    onExternalSearchConsumed={() => setExternalBaseSearch(undefined)}
                    actions={{
                      rename: knowledgeActions.rename,
                      remove: knowledgeActions.remove,
                      copyPath: knowledgeActions.copyPath,
                    }}
                  />
                </div>
              ) : isGraphOpen ? (
                <div className="flex-1 min-h-0">
                  <GraphView
                    nodes={graphData.nodes}
                    edges={graphData.edges}
                    isLoading={false}
                    error={graphStatus === 'error' ? (graphError ?? 'Failed to build graph') : null}
                    onSelectNode={(path) => {
                      navigateToFile(path)
                    }}
                  />
                </div>
              ) : selectedPath ? (
                selectedPath.endsWith('.md') ? (
                  <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
                    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                      {openMarkdownTabs.map((tab) => {
                        const isActive = activeFileTabId
                          ? tab.id === activeFileTabId || tab.path === selectedPath
                          : tab.path === selectedPath
                        const isViewingHistory = viewingHistoricalVersion && isActive && versionHistoryPath === tab.path
                        const tabContent = isViewingHistory
                          ? viewingHistoricalVersion.content
                          : editorContentByPath[tab.path]
                            ?? (isActive && editorPathRef.current === tab.path ? editorContent : '')
                        return (
                          <div
                            key={tab.id}
                            className={cn(
                              'min-h-0 flex-1 flex-col overflow-hidden',
                              isActive ? 'flex' : 'hidden'
                            )}
                            data-file-tab-panel={tab.id}
                            aria-hidden={!isActive}
                          >
                            <MarkdownEditor
                              ref={(el) => {
                                if (el) editorRefsByTabId.current.set(tab.id, el)
                                else editorRefsByTabId.current.delete(tab.id)
                              }}
                              content={tabContent}
                              notePath={tab.path}
                              onChange={(markdown) => { if (!isViewingHistory) handleEditorChange(tab.path, markdown) }}
                              onPrimaryHeadingCommit={() => {
                                untitledRenameReadyPathsRef.current.add(tab.path)
                              }}
                              preserveUntitledTitleHeading={isUntitledPlaceholderName(getBaseName(tab.path))}
                              placeholder="Start writing..."
                              wikiLinks={wikiLinkConfig}
                              onImageUpload={handleImageUpload}
                              editorSessionKey={editorSessionByTabId[tab.id] ?? 0}
                              frontmatter={frontmatterByPathRef.current.get(tab.path) ?? null}
                              onFrontmatterChange={(newRaw) => {
                                frontmatterByPathRef.current.set(tab.path, newRaw)
                                // Write updated frontmatter to disk immediately
                                const currentBody = editorContentRef.current
                                const fullContent = joinFrontmatter(newRaw, currentBody)
                                initialContentByPathRef.current.set(tab.path, splitFrontmatter(fullContent).body)
                                initialContentRef.current = splitFrontmatter(fullContent).body
                                void window.ipc.invoke('workspace:writeFile', {
                                  path: tab.path,
                                  data: fullContent,
                                  opts: { encoding: 'utf8' },
                                })
                              }}
                              onHistoryHandlersChange={(handlers) => {
                                if (handlers) {
                                  fileHistoryHandlersRef.current.set(tab.id, handlers)
                                } else {
                                  fileHistoryHandlersRef.current.delete(tab.id)
                                }
                              }}
                              editable={!isViewingHistory}
                              onExport={async (format) => {
                                const markdown = tabContent
                                const title = getBaseName(tab.path)
                                try {
                                  await window.ipc.invoke('export:note', { markdown, format, title })
                                  analytics.noteExported(format)
                                } catch (err) {
                                  console.error('Export failed:', err)
                                }
                              }}
                            />
                          </div>
                        )
                      })}
                    </div>
                    {versionHistoryPath && (
                      <VersionHistoryPanel
                        path={versionHistoryPath}
                        onClose={() => {
                          setVersionHistoryPath(null)
                          setViewingHistoricalVersion(null)
                        }}
                        onSelectVersion={(oid, content) => {
                          if (oid === null) {
                            setViewingHistoricalVersion(null)
                          } else {
                            setViewingHistoricalVersion({ oid, content })
                          }
                        }}
                        onRestore={async (oid) => {
                          try {
                            await window.ipc.invoke('knowledge:restore', {
                              path: versionHistoryPath.startsWith('knowledge/')
                                ? versionHistoryPath.slice('knowledge/'.length)
                                : versionHistoryPath,
                              oid,
                            })
                            // Reload file content
                            const result = await window.ipc.invoke('workspace:readFile', { path: versionHistoryPath })
                            handleEditorChange(versionHistoryPath, result.data)
                            setViewingHistoricalVersion(null)
                            setVersionHistoryPath(null)
                          } catch (err) {
                            console.error('Failed to restore version:', err)
                          }
                        }}
                      />
                    )}
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
                <div className="relative min-h-0 flex-1">
                  {chatTabs.map((tab) => {
                    const isActive = tab.id === activeChatTabId
                    const tabState = getChatTabStateForRender(tab.id)
                    const tabHasConversation = tabState.conversation.length > 0 || tabState.currentAssistantMessage
                    const tabConversationContentClassName = tabHasConversation
                      ? "mx-auto w-full max-w-4xl pb-28"
                      : "mx-auto w-full max-w-4xl min-h-full items-center justify-center pb-0"
                    return (
                      <div
                        key={tab.id}
                        className={cn(
                          'min-h-0 h-full flex-col',
                          isActive
                            ? 'flex'
                            : 'pointer-events-none invisible absolute inset-0 flex'
                        )}
                        data-chat-tab-panel={tab.id}
                        aria-hidden={!isActive}
                      >
                        <Conversation
                          anchorMessageId={chatViewportAnchorByTab[tab.id]?.messageId}
                          anchorRequestKey={chatViewportAnchorByTab[tab.id]?.requestKey}
                          className="relative flex-1"
                        >
                          <ConversationContent className={tabConversationContentClassName}>
                            {!tabHasConversation ? (
                              <ConversationEmptyState className="h-auto">
                                <div className="text-2xl font-semibold tracking-tight text-foreground/80 sm:text-3xl md:text-4xl">
                                  What are we working on?
                                </div>
                              </ConversationEmptyState>
                            ) : (
                              <>
                                {tabState.conversation.map(item => {
                                  const rendered = renderConversationItem(item, tab.id)
                                  if (isToolCall(item)) {
                                    const permRequest = tabState.allPermissionRequests.get(item.id)
                                    if (permRequest) {
                                      const response = tabState.permissionResponses.get(item.id) || null
                                      return (
                                        <React.Fragment key={item.id}>
                                          {rendered}
                                          <PermissionRequest
                                            toolCall={permRequest.toolCall}
                                            onApprove={() => handlePermissionResponse(permRequest.toolCall.toolCallId, permRequest.subflow, 'approve')}
                                            onApproveSession={() => handlePermissionResponse(permRequest.toolCall.toolCallId, permRequest.subflow, 'approve', 'session')}
                                            onApproveAlways={() => handlePermissionResponse(permRequest.toolCall.toolCallId, permRequest.subflow, 'approve', 'always')}
                                            onDeny={() => handlePermissionResponse(permRequest.toolCall.toolCallId, permRequest.subflow, 'deny')}
                                            isProcessing={isActive && isProcessing}
                                            response={response}
                                          />
                                        </React.Fragment>
                                      )
                                    }
                                  }
                                  return rendered
                                })}

                                {Array.from(tabState.pendingAskHumanRequests.values()).map((request) => (
                                  <AskHumanRequest
                                    key={request.toolCallId}
                                    query={request.query}
                                    onResponse={(response) => handleAskHumanResponse(request.toolCallId, request.subflow, response)}
                                    isProcessing={isActive && isProcessing}
                                  />
                                ))}

                                {tabState.currentAssistantMessage && (
                                  <Message from="assistant">
                                    <MessageContent>
                                      <SmoothStreamingMessage text={tabState.currentAssistantMessage.replace(/<\/?voice>/g, '')} components={streamdownComponents} />
                                    </MessageContent>
                                  </Message>
                                )}

                                {isActive && isProcessing && !tabState.currentAssistantMessage && (
                                  <Message from="assistant">
                                    <MessageContent>
                                      <Shimmer duration={1}>Thinking...</Shimmer>
                                    </MessageContent>
                                  </Message>
                                )}
                              </>
                            )}
                          </ConversationContent>
                          <ConversationScrollButton />
                        </Conversation>
                      </div>
                    )
                  })}
                </div>

                <div className="sticky bottom-0 z-10 bg-background pb-12 pt-0 shadow-lg">
                  <div className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-linear-to-t from-background to-transparent" />
                  <div className="mx-auto w-full max-w-4xl px-4">
                    {!hasConversation && (
                      <Suggestions onSelect={setPresetMessage} className="mb-3 justify-center" />
                    )}
                    {chatTabs.map((tab) => {
                      const isActive = tab.id === activeChatTabId
                      const tabState = getChatTabStateForRender(tab.id)
                      return (
                        <div
                          key={tab.id}
                          className={isActive ? 'block' : 'hidden'}
                          data-chat-input-panel={tab.id}
                          aria-hidden={!isActive}
                        >
                          <ChatInputWithMentions
                            knowledgeFiles={knowledgeFiles}
                            recentFiles={recentWikiFiles}
                            visibleFiles={visibleKnowledgeFiles}
                            onSubmit={handlePromptSubmit}
                            onStop={handleStop}
                            isProcessing={isActive && isProcessing}
                            isStopping={isActive && isStopping}
                            isActive={isActive}
                            presetMessage={isActive ? presetMessage : undefined}
                            onPresetMessageConsumed={isActive ? () => setPresetMessage(undefined) : undefined}
                            runId={tabState.runId}
                            initialDraft={chatDraftsRef.current.get(tab.id)}
                            onDraftChange={(text) => setChatDraftForTab(tab.id, text)}
                            isRecording={isActive && isRecording}
                            recordingText={isActive ? voice.interimText : undefined}
                            recordingState={isActive ? (voice.state === 'connecting' ? 'connecting' : 'listening') : undefined}
                            onStartRecording={isActive ? handleStartRecording : undefined}
                            onSubmitRecording={isActive ? handleSubmitRecording : undefined}
                            onCancelRecording={isActive ? handleCancelRecording : undefined}
                            voiceAvailable={isActive && voiceAvailable}
                            ttsAvailable={isActive && ttsAvailable}
                            ttsEnabled={ttsEnabled}
                            ttsMode={ttsMode}
                            onToggleTts={isActive ? handleToggleTts : undefined}
                            onTtsModeChange={isActive ? handleTtsModeChange : undefined}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
              </FileCardProvider>
              )}
            </SidebarInset>

            {/* Chat sidebar - shown when viewing files/graph */}
            {isRightPaneContext && (
              <ChatSidebar
                defaultWidth={460}
                isOpen={isChatSidebarOpen}
                isMaximized={isRightPaneMaximized}
                chatTabs={chatTabs}
                activeChatTabId={activeChatTabId}
                getChatTabTitle={getChatTabTitle}
                isChatTabProcessing={isChatTabProcessing}
                onSwitchChatTab={switchChatTab}
                onCloseChatTab={closeChatTab}
                onNewChatTab={handleNewChatTabInSidebar}
                onOpenFullScreen={toggleRightPaneMaximize}
                conversation={conversation}
                currentAssistantMessage={currentAssistantMessage}
                chatTabStates={chatViewStateByTab}
                viewportAnchors={chatViewportAnchorByTab}
                isProcessing={isProcessing}
                isStopping={isStopping}
                onStop={handleStop}
                onSubmit={handlePromptSubmit}
                knowledgeFiles={knowledgeFiles}
                recentFiles={recentWikiFiles}
                visibleFiles={visibleKnowledgeFiles}
                runId={runId}
                presetMessage={presetMessage}
                onPresetMessageConsumed={() => setPresetMessage(undefined)}
                getInitialDraft={(tabId) => chatDraftsRef.current.get(tabId)}
                onDraftChangeForTab={setChatDraftForTab}
                pendingAskHumanRequests={pendingAskHumanRequests}
                allPermissionRequests={allPermissionRequests}
                permissionResponses={permissionResponses}
                onPermissionResponse={handlePermissionResponse}
                onAskHumanResponse={handleAskHumanResponse}
                isToolOpenForTab={isToolOpenForTab}
                onToolOpenChangeForTab={setToolOpenForTab}
                onOpenKnowledgeFile={(path) => { navigateToFile(path) }}
                onActivate={() => setActiveShortcutPane('right')}
                isRecording={isRecording}
                recordingText={voice.interimText}
                recordingState={voice.state === 'connecting' ? 'connecting' : 'listening'}
                onStartRecording={handleStartRecording}
                onSubmitRecording={handleSubmitRecording}
                onCancelRecording={handleCancelRecording}
                voiceAvailable={voiceAvailable}
                ttsAvailable={ttsAvailable}
                ttsEnabled={ttsEnabled}
                ttsMode={ttsMode}
                onToggleTts={handleToggleTts}
                onTtsModeChange={handleTtsModeChange}
                onComposioConnected={handleComposioConnected}
              />
            )}
            {/* Rendered last so its no-drag region paints over the sidebar drag region */}
            <FixedSidebarToggle
              onNewChat={handleNewChatTab}
              onOpenSearch={() => setIsSearchOpen(true)}
              meetingState={meetingTranscription.state}
              meetingSummarizing={meetingSummarizing}
              meetingAvailable={voiceAvailable}
              onToggleMeeting={() => { void handleToggleMeeting() }}
              leftInsetPx={isMac ? MACOS_TRAFFIC_LIGHTS_RESERVED_PX : 0}
            />
          </SidebarProvider>
        </div>
        <CommandPalette
          open={isSearchOpen}
          onOpenChange={setIsSearchOpen}
          onSelectFile={navigateToFile}
          onSelectRun={(id) => { void navigateToView({ type: 'chat', runId: id }) }}
          initialContext={paletteContext}
          onChatSubmit={submitFromPalette}
        />
      </SidebarSectionProvider>
      <Toaster />
      <OnboardingModal
        open={showOnboarding}
        onComplete={handleOnboardingComplete}
      />
      <Dialog open={showMeetingPermissions} onOpenChange={setShowMeetingPermissions}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Screen recording permission required</DialogTitle>
            <DialogDescription>
              Rowboat needs <strong>Screen Recording</strong> permission to capture meeting audio from other apps (Zoom, Meet, etc.). This feature won't work without it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>To enable this:</p>
            <ol className="list-decimal list-inside space-y-1.5">
              <li>Open <strong>System Settings</strong> → <strong>Privacy & Security</strong> → <strong>Screen Recording</strong></li>
              <li>Toggle on <strong>Rowboat</strong></li>
              <li>You may need to restart the app after granting permission</li>
            </ol>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMeetingPermissions(false)}>Cancel</Button>
            <Button variant="outline" onClick={() => { void handleOpenScreenRecordingSettings() }}>Open System Settings</Button>
            <Button onClick={() => { void handleCheckPermissionAndRetry() }} disabled={checkingPermission}>
              {checkingPermission ? 'Checking...' : 'Check Again'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  )
}

export default App
