import * as React from 'react'
import { useCallback, useEffect, useLayoutEffect, useState, useRef } from 'react'
import { workspace } from '@x/shared';
import { RunEvent } from '@x/shared/src/runs.js';
import type { LanguageModelUsage, ToolUIPart } from 'ai';
import './App.css'
import z from 'zod';
import { CheckIcon, LoaderIcon, PanelLeftIcon, ArrowLeft, ArrowRight, MessageSquare, ChevronLeftIcon, ChevronRightIcon, Plus, HistoryIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarkdownEditor, type MarkdownEditorHandle } from './components/markdown-editor';
import { ChatSidebar } from './components/chat-sidebar';
import { useSessionChat } from '@/hooks/useSessionChat';
import { subscribeSessionFeed } from '@/lib/session-chat/feed';
import { ChatHeader } from './components/chat-header';
import { ChatEmptyState } from './components/chat-empty-state';
import { ChatInputWithMentions, type CallPreset, type PermissionMode, type StagedAttachment } from './components/chat-input-with-mentions';
import { ChatMessageAttachments } from '@/components/chat-message-attachments'
import { GraphView, type GraphEdge, type GraphNode } from '@/components/graph-view';
import { BasesView, type BaseConfig, DEFAULT_BASE_CONFIG } from '@/components/bases-view';
import { ImageFileViewer } from '@/components/image-file-viewer';
import { VideoFileViewer } from '@/components/video-file-viewer';
import { AudioFileViewer } from '@/components/audio-file-viewer';
import { DocxFileViewer } from '@/components/docx-file-viewer';
import { PersistentViewerCache } from '@/components/persistent-viewer-cache';
import { UnsupportedFileViewer } from '@/components/unsupported-file-viewer';
import { getViewerType, isCacheableViewerPath } from '@/lib/file-types';
import { useDebounce } from './hooks/use-debounce';
import { SidebarContentPanel } from '@/components/sidebar-content';
import { SuggestedTopicsView } from '@/components/suggested-topics-view';
import { LiveNotesView } from '@/components/live-notes-view';
import { BgTasksView } from '@/components/bg-tasks-view';
import { AppsView } from '@/components/apps/apps-view';
import { EmailView } from '@/components/email-view';
import { WorkspaceView } from '@/components/workspace-view';
import { CodingRunBlock } from '@/components/coding-run';
import { SubAgentBlock } from '@/components/sub-agent-block';
import { KnowledgeView, type KnowledgeViewMode } from '@/components/knowledge-view';
import { GoogleDocPickerDialog } from '@/components/google-doc-picker-dialog';
import { ChatHistoryView } from '@/components/chat-history-view';
import { HomeView } from '@/components/home-view';
import { MeetingsView } from '@/components/meetings-view';
import { CodeView, type ActiveCodeSession } from '@/components/code/code-view';
import { CodeChat } from '@/components/code/code-chat';
import { ResizableRightPane } from '@/components/code/resizable-right-pane';
import { SidebarSectionProvider } from '@/contexts/sidebar-context';
import {
  Conversation,
  ConversationContent,
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

import { TurnActivityIndicator } from '@/components/turn-activity-indicator';
import { useSmoothedText } from './hooks/useSmoothedText';
import { Tool, ToolContent, ToolGroupComponent, ToolHeader, ToolTabbedContent } from '@/components/ai-elements/tool';
import { WebSearchResult } from '@/components/ai-elements/web-search-result';
import { AppActionCard } from '@/components/ai-elements/app-action-card';
import { ComposioConnectCard } from '@/components/ai-elements/composio-connect-card';
import { PermissionRequest } from '@/components/ai-elements/permission-request';
import { AutoPermissionDecision } from '@/components/ai-elements/auto-permission-decision';
import { TerminalOutput } from '@/components/terminal-output';
import { AskHumanRequest } from '@/components/ai-elements/ask-human-request';
import { ToolPermissionAutoDecisionEvent, ToolPermissionRequestEvent, AskHumanRequestEvent } from '@x/shared/src/runs.js';
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/sonner"
import { BillingErrorDialog } from "@/components/billing-error-dialog"
import { matchBillingError, type BillingErrorMatch } from "@/lib/billing-error"
import { dispatchCreditExhausted, dispatchCreditReplenished } from "@/lib/credit-status"
import { ensureMarkdownExtension, normalizeWikiPath, splitWikiFragment, stripKnowledgePrefix, toKnowledgePath, wikiLabel } from '@/lib/wiki-links'
import { splitFrontmatter, joinFrontmatter } from '@/lib/frontmatter'
import { extractConferenceLink } from '@/lib/calendar-event'
import { OnboardingModal } from '@/components/onboarding'
import { ComposioGoogleMigrationModal } from '@/components/composio-google-migration-modal'
import { CommandPalette, type CommandPaletteMention, type SearchType } from '@/components/search-dialog'
import { LiveNoteSidebar } from '@/components/live-note-sidebar'
import { BackgroundTaskDetail } from '@/components/background-task-detail'
import { BrowserPane } from '@/components/browser-pane/BrowserPane'
import { VersionHistoryPanel } from '@/components/version-history-panel'
import { FileCardProvider } from '@/contexts/file-card-context'
import { MarkdownPreOverride } from '@/components/ai-elements/markdown-code-override'
import { defaultRemarkPlugins } from 'streamdown'
import remarkBreaks from 'remark-breaks'
import { TabBar, type ChatTab, type FileTab } from '@/components/tab-bar'
import { CaffeinateIndicator } from '@/components/caffeinate-indicator'
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
  groupConversationItems,
  inferRunTitleFromMessage,
  isChatMessage,
  isErrorMessage,
  isToolCall,
  isToolGroup,
  isTurnUsageMessage,
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
import { useVideoMode } from '@/hooks/useVideoMode'
import { useVoiceTTS } from '@/hooks/useVoiceTTS'
import { VideoCallView } from '@/components/video-call-view'
import { ProductTour, type TourNavTarget } from '@/components/product-tour'
import { useMeetingTranscription, type CalendarEventMeta } from '@/hooks/useMeetingTranscription'
import { useAnalyticsIdentity } from '@/hooks/useAnalyticsIdentity'
import * as analytics from '@/lib/analytics'
import { playAckCue } from '@/lib/call-sounds'
import { useTheme } from '@/contexts/theme-context'
import { TokenUsageMenu } from '@/components/token-usage-menu'

type DirEntry = z.infer<typeof workspace.DirEntry>
type RunEventType = z.infer<typeof RunEvent>

interface TreeNode extends DirEntry {
  children?: TreeNode[]
  loaded?: boolean
}

const streamdownComponents = { pre: MarkdownPreOverride }

// Render user messages with markdown so bullets, bold, links, etc. survive the
// round-trip from the input textarea. `remarkBreaks` turns single newlines
// into <br> so typed line breaks are preserved without requiring blank lines.
const userMessageRemarkPlugins = [...Object.values(defaultRemarkPlugins), remarkBreaks]

function SmoothStreamingMessage({ text, components }: { text: string; components: typeof streamdownComponents }) {
  const smoothText = useSmoothedText(text)
  return <MessageResponse components={components}>{smoothText}</MessageResponse>
}

function AutoScrollPre({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null)
  const stickToBottom = useRef(true)

  useLayoutEffect(() => {
    const el = ref.current
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [children])

  const handleScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    stickToBottom.current = atBottom
  }, [])

  return (
    <pre ref={ref} onScroll={handleScroll} className={className}>
      {children}
    </pre>
  )
}

const DEFAULT_SIDEBAR_WIDTH = 256
const DEFAULT_CHAT_PANE_WIDTH = 460
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
const TITLEBAR_BUTTONS_COLLAPSED = 1
const TITLEBAR_BUTTON_GAPS_COLLAPSED = 0
const GRAPH_TAB_PATH = '__rowboat_graph_view__'
const SUGGESTED_TOPICS_TAB_PATH = '__rowboat_suggested_topics__'
const MEETINGS_TAB_PATH = '__rowboat_meetings__'
const LIVE_NOTES_TAB_PATH = '__rowboat_live_notes__'
const BG_TASKS_TAB_PATH = '__rowboat_bg_tasks__'
const APPS_TAB_PATH = '__rowboat_mini_apps__'
const EMAIL_TAB_PATH = '__rowboat_email__'
const WORKSPACE_TAB_PATH = '__rowboat_workspace__'
const WORKSPACE_ROOT = 'knowledge/Workspace'
const KNOWLEDGE_VIEW_TAB_PATH = '__rowboat_knowledge_view__'
const CHAT_HISTORY_TAB_PATH = '__rowboat_chat_history__'
const HOME_TAB_PATH = '__rowboat_home__'
const BASES_DEFAULT_TAB_PATH = '__rowboat_bases_default__'
const CODE_TAB_PATH = '__rowboat_code__'

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

type LinkedGoogleDocMeta = {
  id: string
  title: string
  url?: string
  syncedAt?: string
}

const parseLinkedGoogleDocFrontmatter = (raw: string | null | undefined): LinkedGoogleDocMeta | null => {
  if (!raw?.includes('google_doc:')) return null
  const doc: Partial<LinkedGoogleDocMeta> = {}
  let inGoogleDoc = false
  for (const line of raw.split('\n')) {
    if (line.trim() === '---') {
      inGoogleDoc = false
      continue
    }
    const topLevel = line.match(/^([A-Za-z_][\w-]*):\s*.*$/)
    if (topLevel) {
      inGoogleDoc = topLevel[1] === 'google_doc'
      continue
    }
    if (!inGoogleDoc) continue
    const nested = line.match(/^\s+([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!nested) continue
    const key = nested[1] as keyof LinkedGoogleDocMeta
    if (!['id', 'title', 'url', 'syncedAt'].includes(key)) continue
    let value = nested[2].trim()
    try {
      value = JSON.parse(value)
    } catch {
      value = value.replace(/^['"]|['"]$/g, '')
    }
    doc[key] = value
  }
  return doc.id && doc.title ? doc as LinkedGoogleDocMeta : null
}

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
const isSuggestedTopicsTabPath = (path: string) => path === SUGGESTED_TOPICS_TAB_PATH
const isMeetingsTabPath = (path: string) => path === MEETINGS_TAB_PATH
const isLiveNotesTabPath = (path: string) => path === LIVE_NOTES_TAB_PATH
const isBgTasksTabPath = (path: string) => path === BG_TASKS_TAB_PATH
const isAppsTabPath = (path: string) => path === APPS_TAB_PATH
const isEmailTabPath = (path: string) => path === EMAIL_TAB_PATH
const isWorkspaceTabPath = (path: string) => path === WORKSPACE_TAB_PATH
const isKnowledgeViewTabPath = (path: string) => path === KNOWLEDGE_VIEW_TAB_PATH
const isChatHistoryTabPath = (path: string) => path === CHAT_HISTORY_TAB_PATH
const isHomeTabPath = (path: string) => path === HOME_TAB_PATH
const isBaseFilePath = (path: string) => path.endsWith('.base') || path === BASES_DEFAULT_TAB_PATH
const isCodeTabPath = (path: string) => path === CODE_TAB_PATH

const getSuggestedTopicTargetFolder = (category?: string) => {
  const normalized = category?.trim().toLowerCase()
  switch (normalized) {
    case 'people':
    case 'person':
      return 'People'
    case 'organizations':
    case 'organization':
      return 'Organizations'
    case 'projects':
    case 'project':
      return 'Projects'
    case 'meetings':
    case 'meeting':
      return 'Meetings'
    case 'topics':
    case 'topic':
    default:
      return 'Topics'
  }
}

const buildSuggestedTopicExplorePrompt = ({
  title,
  description,
  category,
}: {
  title: string
  description: string
  category?: string
}) => {
  const folder = getSuggestedTopicTargetFolder(category)
  const categoryLabel = category?.trim() || 'Topics'
  return [
    'I am exploring a suggested topic card from the Suggested Topics panel.',
    'This card may represent a person, organization, topic, or project.',
    '',
    'Card context:',
    `- Title: ${title}`,
    `- Category: ${categoryLabel}`,
    `- Description: ${description}`,
    `- Target folder if we set this up: knowledge/${folder}/`,
    '',
    `Please start by telling me that you can set up a live note for "${title}" under knowledge/${folder}/.`,
    'Then briefly explain what that live note would track and ask me if you should set it up.',
    'Do not create or modify anything yet.',
    'Treat a clear confirmation from me as explicit approval to proceed.',
    `If I confirm later, load the \`live-note\` skill first, check whether a matching note already exists under knowledge/${folder}/, and extend its existing live objective instead of creating a duplicate.`,
    `If no matching note exists, create a new note under knowledge/${folder}/ with an appropriate filename.`,
    'Make the new note live (add a `live:` block to its frontmatter) rather than only writing static content, and keep any surrounding note scaffolding short and useful.',
    'Do not ask me to choose a note path unless there is a real ambiguity you cannot resolve from the card.',
  ].join('\n')
}

const buildLiveNoteSetupPrompt = () =>
  'I want to set up a Live note / task.'

const buildBgTaskSetupPrompt = (description: string) =>
  `Create a background task for me. Here's what I want it to do:\n\n${description}`

const buildBgTaskEditPrompt = (slug: string) =>
  `Let's tweak the background task \`${slug}\`. Please load the \`background-task\` skill first, read the task's current \`bg-tasks/${slug}/task.yaml\`, then ask me what I want to change.`

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

      // Pass through user-created folders that have no meeting-style date files
      if (dateGroups.size === 0) return [sourceNode]

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
  | { type: 'suggested-topics' }
  | { type: 'meetings' }
  | { type: 'live-notes' }
  | { type: 'email'; threadId?: string; searchQuery?: string }
  | { type: 'workspace'; path?: string }
  | { type: 'knowledge-view'; folderPath?: string; mode?: KnowledgeViewMode }
  | { type: 'chat-history' }
  | { type: 'home' }
  | { type: 'code' }
  | { type: 'bg-tasks' }
  | { type: 'apps' }

function viewStatesEqual(a: ViewState, b: ViewState): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'chat' && b.type === 'chat') return a.runId === b.runId
  if (a.type === 'file' && b.type === 'file') return a.path === b.path
  if (a.type === 'task' && b.type === 'task') return a.name === b.name
  if (a.type === 'workspace' && b.type === 'workspace') return (a.path ?? '') === (b.path ?? '')
  if (a.type === 'knowledge-view' && b.type === 'knowledge-view') return (a.folderPath ?? '') === (b.folderPath ?? '') && (a.mode ?? '') === (b.mode ?? '')
  if (a.type === 'email' && b.type === 'email') return (a.threadId ?? '') === (b.threadId ?? '') && (a.searchQuery ?? '') === (b.searchQuery ?? '')
  return true // both graph
}

/**
 * Parse a rowboat:// deep link into a ViewState. Returns null if the URL is
 * malformed or names an unknown target.
 *
 * Shape: rowboat://open?type=<file|chat|graph|task|suggested-topics|meetings|live-notes|email>&...
 *   file:             ?type=file&path=knowledge/foo.md
 *   chat:             ?type=chat&runId=abc123        (runId optional)
 *   graph:            ?type=graph
 *   task:             ?type=task&name=daily-brief
 *   suggested-topics: ?type=suggested-topics
 *   meetings:         ?type=meetings
 *   live-notes:       ?type=live-notes
 *   email:            ?type=email
 */
function parseDeepLink(input: string): ViewState | null {
  const SCHEME = 'rowboat://'
  if (!input.startsWith(SCHEME)) return null
  const rest = input.slice(SCHEME.length)
  const queryIdx = rest.indexOf('?')
  const host = (queryIdx >= 0 ? rest.slice(0, queryIdx) : rest).replace(/\/$/, '')
  if (host !== 'open') return null
  const params = new URLSearchParams(queryIdx >= 0 ? rest.slice(queryIdx + 1) : '')
  switch (params.get('type')) {
    case 'file': {
      const path = params.get('path')
      return path ? { type: 'file', path } : null
    }
    case 'chat':
      return { type: 'chat', runId: params.get('runId') || null }
    case 'graph':
      return { type: 'graph' }
    case 'task': {
      const name = params.get('name')
      return name ? { type: 'task', name } : null
    }
    case 'suggested-topics':
      return { type: 'suggested-topics' }
    case 'meetings':
      return { type: 'meetings' }
    case 'live-notes':
      return { type: 'live-notes' }
    case 'email': {
      const threadId = params.get('threadId')
      return { type: 'email', threadId: threadId || undefined }
    }
    case 'workspace': {
      const path = params.get('path')
      return { type: 'workspace', path: path ?? undefined }
    }
    case 'knowledge-view': {
      const folderPath = params.get('folderPath')
      const mode = params.get('mode')
      return {
        type: 'knowledge-view',
        folderPath: folderPath ?? undefined,
        mode: mode === 'graph' || mode === 'basis' || mode === 'files' ? mode : undefined,
      }
    }
    case 'chat-history':
      return { type: 'chat-history' }
    case 'home':
      return { type: 'home' }
    case 'code':
      return { type: 'code' }
    case 'bg-tasks':
      return { type: 'bg-tasks' }
    case 'apps':
      return { type: 'apps' }
    default:
      return null
  }
}

/** Sidebar toggle (fixed position, top-left) */
function FixedSidebarToggle({
  leftInsetPx,
}: {
  leftInsetPx: number
}) {
  const { toggleSidebar } = useSidebar()
  return (
    <div className="fixed left-0 top-0 z-50 flex h-10 items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
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
      className="rowboat-titlebar titlebar-drag-region flex h-10 shrink-0 items-stretch border-b border-border bg-sidebar overflow-hidden"
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
  const { chatPanePlacement, chatPaneSize } = useTheme()
  const isChatPaneInMiddle = chatPanePlacement === 'middle'

  type ShortcutPane = 'left' | 'right'
  type MarkdownHistoryHandlers = { undo: () => boolean; redo: () => boolean }

  useAnalyticsIdentity()

  // File browser state (for Knowledge section)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [, setFileContent] = useState<string>('')
  const [editorContent, setEditorContent] = useState<string>('')
  const editorContentRef = useRef<string>('')
  const [editorContentByPath, setEditorContentByPath] = useState<Record<string, string>>({})
  const editorContentByPathRef = useRef<Map<string, string>>(new Map())
  const [tree, setTree] = useState<TreeNode[]>([])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [recentWikiFiles, setRecentWikiFiles] = useState<string[]>([])
  const [isGraphOpen, setIsGraphOpen] = useState(false)
  const [isBrowserOpen, setIsBrowserOpen] = useState(false)
  const [isSuggestedTopicsOpen, setIsSuggestedTopicsOpen] = useState(false)
  const [isMeetingsOpen, setIsMeetingsOpen] = useState(false)
  const [isLiveNotesOpen, setIsLiveNotesOpen] = useState(false)
  const [isBgTasksOpen, setIsBgTasksOpen] = useState(false)
  const [isAppsOpen, setIsAppsOpen] = useState(false)
  const [isEmailOpen, setIsEmailOpen] = useState(false)
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false)
  const [workspaceInitialPath, setWorkspaceInitialPath] = useState<string | null>(null)
  const [isKnowledgeViewOpen, setIsKnowledgeViewOpen] = useState(false)
  const [knowledgeViewMode, setKnowledgeViewMode] = useState<KnowledgeViewMode>('graph')
  // Folder being browsed inside the knowledge view (null = root overview).
  // Lives in ViewState so folder drill-down participates in back/forward history.
  const [knowledgeViewFolderPath, setKnowledgeViewFolderPath] = useState<string | null>(null)
  const [googleDocPickerOpen, setGoogleDocPickerOpen] = useState(false)
  const [googleDocPickerTargetFolder, setGoogleDocPickerTargetFolder] = useState('knowledge')
  const [isChatHistoryOpen, setIsChatHistoryOpen] = useState(false)
  // Default landing view: Home with the chat docked according to appearance settings.
  const [isHomeOpen, setIsHomeOpen] = useState(true)
  const [emailInitialThreadId, setEmailInitialThreadId] = useState<string | null>(null)
  const [emailThreadIdVersion, setEmailThreadIdVersion] = useState(0)
  // Search query pushed into the email view's search box (e.g. the assistant's
  // read-view email query), so threads outside the synced inbox get real rows.
  const [emailInitialSearchQuery, setEmailInitialSearchQuery] = useState<string | null>(null)
  const [emailSearchQueryVersion, setEmailSearchQueryVersion] = useState(0)
  const [expandedFrom, setExpandedFrom] = useState<{
    path: string | null
    graph: boolean
    suggestedTopics: boolean
    meetings: boolean
    liveNotes: boolean
    bgTasks: boolean
    email: boolean
  } | null>(null)
  const [baseConfigByPath, setBaseConfigByPath] = useState<Record<string, BaseConfig>>({})
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({
    nodes: [],
    edges: [],
  })
  const [graphStatus, setGraphStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [graphError, setGraphError] = useState<string | null>(null)
  const [isChatSidebarOpen, setIsChatSidebarOpen] = useState(true)
  const [isRightPaneMaximized, setIsRightPaneMaximized] = useState(false)
  // Middle-pane collapse animation. Animating its max-width from 100% is janky:
  // 100% is relative to the parent (far wider than the pane's real width), so the
  // transition spends its first frames non-binding (nothing moves) then snaps shut.
  // Instead we snapshot the pane's real px width before it collapses and drive the
  // transition from that value.
  const [insetCollapseFromPx, setInsetCollapseFromPx] = useState<number | null>(null)
  const [insetMaxWidth, setInsetMaxWidth] = useState<string>('100%')
  const [insetAnimateMaxWidth, setInsetAnimateMaxWidth] = useState(true)
  // Live-note panel: bound to a single note path. Mounted as a sibling of the
  // markdown editor so it shares the layout (no overlap with chat) and
  // auto-closes when the active note changes.
  const [liveNotePanelPath, setLiveNotePanelPath] = useState<string | null>(null)
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
  const [googleDocSyncDirection, setGoogleDocSyncDirection] = useState<'up' | 'down' | null>(null)
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
  const [billingErrorMatch, setBillingErrorMatch] = useState<BillingErrorMatch | null>(null)
  const [billingErrorOpen, setBillingErrorOpen] = useState(false)
  const lastHandledBillingErrorIdRef = useRef<string | null>(null)
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState<string>('')

  useEffect(() => {
    for (let i = conversation.length - 1; i >= 0; i--) {
      const item = conversation[i]
      if (!isErrorMessage(item)) continue
      if (item.id === lastHandledBillingErrorIdRef.current) return
      const match = matchBillingError(item.message)
      if (match) {
        lastHandledBillingErrorIdRef.current = item.id
        setBillingErrorMatch(match)
        setBillingErrorOpen(true)
        if (match.kind === 'out_of_credits') dispatchCreditExhausted()
      }
      return
    }
  }, [conversation])
  const [, setModelUsage] = useState<LanguageModelUsage | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  // New runtime: the active session's chat data + actions. All logic lives in
  // SessionChatStore (tested headlessly); the hook is a thin subscription.
  // runId IS the session id in the sessions runtime.
  const sessionChat = useSessionChat(runId)
  const runIdRef = useRef<string | null>(null)
  const loadRunRequestIdRef = useRef(0)
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingRunIds, setProcessingRunIds] = useState<Set<string>>(new Set())
  const processingRunIdsRef = useRef<Set<string>>(new Set())
  const streamingBuffersRef = useRef<Map<string, { assistant: string }>>(new Map())
  const [isStopping, setIsStopping] = useState(false)
  const [, setStopClickedAt] = useState<number | null>(null)
  // Sessions runtime: whole-turn liveness drives the composer Stop control
  // and running indicator. Model reasoning is a narrower state used only to
  // label that indicator "Thinking..." while reasoning is actually streaming.
  const activeIsProcessing = sessionChat.chatState?.isProcessing ?? isProcessing
  const activeIsReasoning = sessionChat.chatState?.isReasoning ?? false
  const activeIsWaitingOnHuman = sessionChat.chatState?.isWaitingOnHuman ?? false
  const activeIsWorking = activeIsProcessing && !activeIsWaitingOnHuman
  // A failed session load must be visible, not a blank chat.
  const sessionLoadErrorItems = React.useMemo<ConversationItem[]>(() => (
    sessionChat.error
      ? [{ id: 'session-load-error', kind: 'error', message: `Failed to load chat: ${sessionChat.error}`, timestamp: 0 }]
      : []
  ), [sessionChat.error])
  const [agentId] = useState<string>('copilot')
  const [presetMessage, setPresetMessage] = useState<string | undefined>(undefined)

  // Voice mode state
  const [voiceAvailable, setVoiceAvailable] = useState(false)
  const [ttsAvailable, setTtsAvailable] = useState(false)
  // TTS plays only during calls now (the standing read-aloud toggle was
  // retired; a per-message "read aloud" action may replace it later).
  const ttsEnabledRef = useRef(false)
  // Voice-to-voice latency marks for the current call turn (performance.now):
  // t0 = utterance accepted, submit = message sent, speak = first TTS
  // speak(). Emitted as call_turn_latency when audio actually starts.
  const callTurnMarksRef = useRef<{ t0: number; submit?: number; speak?: number } | null>(null)
  // Late-bound handle to handleStop (defined much further down) so early
  // call handlers can stop the run without reordering the component.
  const stopRunRef = useRef<(() => Promise<void>) | null>(null)
  // Read-aloud style: 'summary' for typed chat, forced to 'full' during a
  // call and restored after. Context decides — the user never picks it.
  const ttsModeRef = useRef<'summary' | 'full'>('summary')
  const [tourActive, setTourActive] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const voiceTextBufferRef = useRef('')
  const spokenIndexRef = useRef(0)
  const isRecordingRef = useRef(false)

  const tts = useVoiceTTS()
  const ttsRef = useRef(tts)
  ttsRef.current = tts

  // Latest assistant line handed to TTS — shown as the caption in the
  // full-screen call view while the assistant is speaking.
  const [assistantCaption, setAssistantCaption] = useState('')
  useEffect(() => {
    if (tts.state === 'idle') setAssistantCaption('')
  }, [tts.state])

  // Speak newly completed <voice> blocks from the new runtime's live stream
  // (parity with the legacy text-delta voice extraction below). The store
  // accumulates completed blocks in chatState.voiceSegments; we speak only
  // segments that appeared after the current session became active.
  const spokenVoiceRef = useRef<{ key: string | null; count: number }>({ key: null, count: 0 })
  const voiceSegments = sessionChat.chatState?.voiceSegments
  useEffect(() => {
    if (!voiceSegments) return
    if (spokenVoiceRef.current.key !== runId) {
      // Session switch: skip anything already streamed before we arrived.
      spokenVoiceRef.current = { key: runId, count: voiceSegments.length }
      return
    }
    while (spokenVoiceRef.current.count < voiceSegments.length) {
      const segment = voiceSegments[spokenVoiceRef.current.count]
      spokenVoiceRef.current.count += 1
      if (ttsEnabledRef.current) {
        const marks = callTurnMarksRef.current
        if (marks && marks.speak === undefined) marks.speak = performance.now()
        ttsRef.current.speak(segment)
        setAssistantCaption(segment)
      }
    }
  }, [voiceSegments, runId])

  // Emit the turn's voice-to-voice latency breakdown once audio is audible.
  useEffect(() => {
    if (tts.state !== 'speaking') return
    const marks = callTurnMarksRef.current
    if (!marks || marks.submit === undefined || marks.speak === undefined) return
    callTurnMarksRef.current = null
    const now = performance.now()
    analytics.callTurnLatency({
      endpointToSubmitMs: marks.submit - marks.t0,
      submitToSpeakMs: marks.speak - marks.submit,
      speakToAudioMs: now - marks.speak,
      totalMs: now - marks.t0,
    })
  }, [tts.state])

  const voice = useVoiceMode()
  const voiceRef = useRef(voice)
  voiceRef.current = voice

  // Calls: one engine (hands-free voice loop + forced read-aloud TTS + frame
  // capture), started via presets that only differ in device defaults. The
  // presentation is DERIVED from devices, never picked: screen sharing →
  // floating popout; camera on → full-screen call; camera off → popout
  // (mascot pill). Handlers live below the voice/submit plumbing they drive.
  const video = useVideoMode()
  const [inCall, setInCall] = useState(false)
  const inCallRef = useRef(false)
  // User explicitly shrank the full-screen call to the floating pill.
  const [callMinimized, setCallMinimized] = useState(false)
  // In-call mute: a full input pause, not just audio — mic audio stops
  // reaching Deepgram AND camera/screen frame capture stops, so nothing said
  // or shown while muted ever reaches the assistant. Output is untouched
  // (in-flight speech keeps playing; the Stop control handles that).
  const [micMuted, setMicMuted] = useState(false)
  // Practice preset: adds the coaching persona to the system prompt.
  const [practiceMode, setPracticeMode] = useState(false)
  const practiceModeRef = useRef(false)

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

  // One-time Composio→native Google migration check. Runs on mount and again
  // after the user signs in to Rowboat (so we catch users who weren't signed
  // in at startup). The IPC is idempotent — once `dismissed_at` is set on the
  // main side, every subsequent call returns `{shouldShow: false}`.
  useEffect(() => {
    const run = async () => {
      try {
        const result = await window.ipc.invoke('migration:check-composio-google', null)
        if (result.shouldShow) {
          setShowComposioGoogleMigration(true)
        }
      } catch (error) {
        console.error('[migration] check-composio-google failed:', error)
      }
    }
    void run()
    const cleanup = window.ipc.on('oauth:didConnect', (event) => {
      if (event.provider === 'rowboat' && event.success) {
        void run()
      }
    })
    return cleanup
  }, [])

  const handleStartRecording = useCallback(() => {
    // A live call owns the mic — ignore push-to-talk while one is running.
    if (inCallRef.current) return
    setIsRecording(true)
    isRecordingRef.current = true
    voice.start()
  }, [voice])

  const handlePromptSubmitRef = useRef<((message: PromptInputMessage, mentions?: FileMention[], stagedAttachments?: StagedAttachment[], searchEnabled?: boolean, codeMode?: 'claude' | 'codex', permissionMode?: PermissionMode) => Promise<void>) | null>(null)
  const pendingVoiceInputRef = useRef(false)

  // Palette: per-tab editor handles for capturing cursor context on Cmd+K, and pending payload
  // queued across the new-chat-tab state flush before submit fires.
  const editorRefsByTabId = useRef<Map<string, MarkdownEditorHandle>>(new Map())
  const [pendingPaletteSubmit, setPendingPaletteSubmit] = useState<{ text: string; mention: CommandPaletteMention | null } | null>(null)

  const handleSubmitRecording = useCallback(async () => {
    if (!isRecordingRef.current) return
    const text = await voice.submit()
    setIsRecording(false)
    isRecordingRef.current = false
    if (text) {
      pendingVoiceInputRef.current = true
      handlePromptSubmitRef.current?.({ text, files: [] })
    }
  }, [voice])

  const handleCancelRecording = useCallback(() => {
    voice.cancel()
    setIsRecording(false)
    isRecordingRef.current = false
  }, [voice])

  // Start a call. Presets only differ in device defaults — the engine
  // (continuous listening, auto-submitted utterances, forced read-aloud TTS,
  // frame capture) is identical for all of them. The default entry ('share',
  // the call button's main click) is "work together": screen shared, camera
  // off, floating pill — the user keeps working while the assistant watches
  // along. 'video'/'practice' open face-to-face full screen instead.
  const startCall = useCallback(async (preset: CallPreset) => {
    if (inCallRef.current) return
    const camera = preset === 'video' || preset === 'practice'
    const ok = await video.start({ camera })
    if (!ok) return // camera denied/unavailable — stay out of the call
    if (preset === 'share') {
      // If screen capture fails (usually the macOS Screen Recording
      // permission), continue as a voice call — sharing is one tap away on
      // the pill once permission is granted.
      const shared = await video.startScreenShare()
      if (!shared) {
        toast("Couldn't share your screen", {
          description: 'Grant Rowboat Screen Recording access, then tap the share button on the call.',
          action: {
            label: 'Open Settings',
            onClick: () => void window.ipc.invoke('meeting:openScreenRecordingSettings', null).catch(() => {}),
          },
        })
      }
    }

    // A manual push-to-talk recording can't coexist with the call's mic.
    if (isRecordingRef.current) {
      voiceRef.current.cancel()
      setIsRecording(false)
      isRecordingRef.current = false
    }
    ttsEnabledRef.current = true
    ttsModeRef.current = 'full'
    void voiceRef.current.startContinuous((text) => {
      // Instant "heard you" feedback + start of the latency clock.
      playAckCue()
      callTurnMarksRef.current = { t0: performance.now() }
      pendingVoiceInputRef.current = true
      handlePromptSubmitRef.current?.({ text, files: [] })
    })

    setPracticeMode(preset === 'practice')
    practiceModeRef.current = preset === 'practice'
    setMicMuted(false)
    // Pill-first presets start minimized; face-to-face presets start expanded.
    setCallMinimized(preset === 'voice' || preset === 'share')
    inCallRef.current = true
    setInCall(true)
    analytics.callStarted(preset)
  }, [video])

  const endCall = useCallback(() => {
    if (!inCallRef.current) return
    voiceRef.current.cancel()
    ttsEnabledRef.current = false
    ttsModeRef.current = 'summary'
    ttsRef.current.cancel()
    callTurnMarksRef.current = null
    video.stop()
    setPracticeMode(false)
    practiceModeRef.current = false
    setMicMuted(false)
    setCallMinimized(false)
    inCallRef.current = false
    setInCall(false)
  }, [video])

  // During a call, mute the mic while the assistant is thinking or speaking
  // so its own TTS (or a half-turn) never gets transcribed back at it — and
  // whenever the user muted themselves.
  useEffect(() => {
    if (!inCall) return
    voiceRef.current.setPaused(micMuted || activeIsProcessing || tts.state !== 'idle')
  }, [inCall, micMuted, activeIsProcessing, tts.state])

  // The user-mute half that lives in the video pipeline: stop sampling
  // camera/screen frames while muted (see useVideoMode.setCapturePaused).
  const setCapturePaused = video.setCapturePaused
  useEffect(() => {
    setCapturePaused(micMuted)
  }, [micMuted, setCapturePaused])

  // Screen sharing: frames of the shared screen ride along with each message
  // next to the webcam frames. The surface change (full screen → pill) falls
  // out of the derivation below.
  const handleToggleScreenShare = useCallback(async () => {
    if (video.screenState === 'live') {
      video.stopScreenShare()
    } else {
      await video.startScreenShare()
    }
  }, [video])

  // Meet-style camera mute: the call (and any screen share) stays on, but no
  // webcam frames are captured while the camera is off. Deliberately does NOT
  // change the surface — turning your camera on from the pill puts your video
  // IN the pill; expanding to full screen is its own explicit action.
  const handleToggleCamera = useCallback(() => {
    void video.setCameraEnabled(!video.cameraOn)
  }, [video])

  // Zoom-style mute button, except it pauses ALL input (mic + frames) so the
  // user can talk to someone in the room without the assistant listening in.
  // Devices stay acquired (camera light and share indicator stay on) so
  // unmuting is instant.
  const handleToggleMic = useCallback(() => {
    setMicMuted((m) => !m)
  }, [])

  // Minimizing the full-screen call drops you back to working — and the pill
  // exists to work *together*, so sharing starts automatically (the symmetric
  // twin of expand, which stops it). If capture fails (permission), the call
  // still minimizes as a plain pill. `callMinimized` is also set so stopping
  // the share from the pill keeps you in the pill rather than snapping back
  // to full screen.
  const handleMinimizeCall = useCallback(async () => {
    setCallMinimized(true)
    await video.startScreenShare()
  }, [video])

  // Interrupt the assistant: silence TTS immediately, skip anything already
  // queued from the in-flight turn, and stop the run if it's still
  // generating (if it already finished, stopping the speech is all there is
  // to do). Wired to the Stop control next to the mascot on both surfaces.
  const handleInterruptAssistant = useCallback(() => {
    ttsRef.current.cancel()
    setAssistantCaption('')
    if (voiceSegments) {
      spokenVoiceRef.current.count = voiceSegments.length
    }
    if (activeIsProcessing) {
      void stopRunRef.current?.()
    }
  }, [voiceSegments, activeIsProcessing])

  // Current phase of the call (null when not in one).
  const videoCallStatus: 'listening' | 'thinking' | 'speaking' | null =
    inCall
      ? tts.state === 'speaking'
        ? 'speaking'
        : tts.state === 'synthesizing' || activeIsProcessing
          ? 'thinking'
          : 'listening'
      : null

  // The call's surface follows one rule: full screen and screen sharing are
  // mutually exclusive (a full-screen call covers the screen — sharing it
  // would show the call itself). Sharing → floating pill, always. Not
  // sharing → full screen unless the user shrank it (`callMinimized`).
  // Expanding the pill auto-stops any share; presenting from full screen
  // auto-collapses to the pill.
  const callSurface: 'fullscreen' | 'popout' | null = !inCall
    ? null
    : video.screenState === 'live' || callMinimized
      ? 'popout'
      : 'fullscreen'

  useEffect(() => {
    void window.ipc.invoke('video:setPopout', { show: callSurface === 'popout' }).catch(() => {})
  }, [callSurface])

  // Consent surface for screen sharing: an unmissable toast the moment any
  // share starts (auto-started calls included), with one-tap stop. The pill
  // also carries a persistent "Sharing screen" badge, and macOS shows its
  // purple recording indicator.
  const prevScreenStateRef = useRef(video.screenState)
  useEffect(() => {
    const prev = prevScreenStateRef.current
    prevScreenStateRef.current = video.screenState
    if (video.screenState === 'live' && prev !== 'live') {
      toast('Your screen is being shared', {
        description: 'The assistant sees snapshots of it along with what you say.',
        action: { label: 'Stop sharing', onClick: () => video.stopScreenShare() },
        duration: 6000,
      })
    }
  }, [video.screenState, video])

  // Keep the popout's mascot/status/devices/caption mirror of the call fresh.
  // The main process caches the latest state and replays it when the popout
  // loads.
  useEffect(() => {
    if (!inCall) return
    void window.ipc
      .invoke('video:popoutState', {
        ttsState: tts.state,
        status: videoCallStatus,
        cameraOn: video.cameraOn,
        micMuted,
        screenSharing: video.screenState === 'live',
        interimText: voice.interimText || null,
      })
      .catch(() => {})
  }, [inCall, tts.state, videoCallStatus, video.cameraOn, micMuted, video.screenState, voice.interimText])

  // Execute popout control-bar actions (the popout window has no access to
  // the call's mic/camera/capture — they live here). 'expand' goes full
  // screen, which by the exclusivity rule stops any running share; the main
  // process already refocused the app window.
  useEffect(() => {
    return window.ipc.on('video:popout-action', ({ action }) => {
      if (action === 'toggle-mic') handleToggleMic()
      else if (action === 'toggle-camera') handleToggleCamera()
      else if (action === 'toggle-share') void handleToggleScreenShare()
      else if (action === 'stop-speaking') handleInterruptAssistant()
      else if (action === 'end-call') endCall()
      else if (action === 'expand') {
        if (video.screenState === 'live') video.stopScreenShare()
        setCallMinimized(false)
      }
    })
  }, [handleToggleMic, handleToggleCamera, handleToggleScreenShare, handleInterruptAssistant, endCall, video])

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
  type RunListItem = { id: string; title?: string; createdAt: string; modifiedAt: string; agentId: string; useCase?: string }
  const [runs, setRuns] = useState<RunListItem[]>([])

  // Chat tab state
  const [chatTabs, setChatTabs] = useState<ChatTab[]>([{ id: 'default-chat-tab', runId: null }])
  const chatTabsRef = useRef(chatTabs)
  chatTabsRef.current = chatTabs
  const [activeChatTabId, setActiveChatTabId] = useState('default-chat-tab')
  const [chatViewStateByTab, setChatViewStateByTab] = useState<Record<string, ChatTabViewState>>({
    'default-chat-tab': createEmptyChatTabViewState(),
  })
  const chatViewStateByTabRef = useRef(chatViewStateByTab)
  const chatDraftsRef = useRef(new Map<string, string>())
  const selectedModelByTabRef = useRef(new Map<string, { provider: string; model: string }>())
  // Work directory is per-chat. Keyed by tab id; null/absent means none set.
  const [workDirByTab, setWorkDirByTab] = useState<Record<string, string | null>>({})
  const workDirByTabRef = useRef(workDirByTab)
  workDirByTabRef.current = workDirByTab
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
  // Persist a run's work directory to its per-run sidecar config file. The agent
  // runtime reads this same file (config/workdir-<runId>.json) on each turn.
  const persistRunWorkDir = useCallback(async (runId: string, value: string | null) => {
    try {
      await window.ipc.invoke('workspace:writeFile', {
        path: `config/workdir-${runId}.json`,
        data: JSON.stringify(value ? { path: value } : {}, null, 2),
      })
    } catch (err) {
      console.error('Failed to persist work directory for run', runId, err)
    }
  }, [])
  // Read a run's persisted work directory (used when (re)opening a run into a tab).
  const loadRunWorkDir = useCallback(async (runId: string): Promise<string | null> => {
    try {
      const result = await window.ipc.invoke('workspace:readFile', { path: `config/workdir-${runId}.json` })
      const parsed = JSON.parse(result.data)
      const value = typeof parsed?.path === 'string' ? parsed.path.trim() : ''
      return value || null
    } catch {
      return null
    }
  }, [])
  const setTabWorkDir = useCallback((tabId: string, value: string | null) => {
    setWorkDirByTab((prev) => ({ ...prev, [tabId]: value }))
    // If the tab is already bound to a run, persist immediately so the change
    // applies to that chat's subsequent messages.
    const runId = chatTabsRef.current.find((t) => t.id === tabId)?.runId
    if (runId) void persistRunWorkDir(runId, value)
  }, [persistRunWorkDir])
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
  const [fileTabs, setFileTabs] = useState<FileTab[]>([{ id: 'home-tab', path: HOME_TAB_PATH }])
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>('home-tab')
  const activeFileTabIdRef = useRef(activeFileTabId)
  activeFileTabIdRef.current = activeFileTabId
  // The Code section is tab-derived (no boolean to keep in sync with the other
  // section flags): it is open exactly while its sentinel tab is active.
  const isCodeOpen = React.useMemo(() => {
    const activeTab = fileTabs.find((tab) => tab.id === activeFileTabId)
    return activeTab ? isCodeTabPath(activeTab.path) : false
  }, [fileTabs, activeFileTabId])
  // The code session that owns the right-hand chat pane: rowboat-mode sessions
  // bind the assistant chat to their run; direct-mode sessions swap the pane
  // for the direct-drive chat.
  const [activeCodeSession, setActiveCodeSession] = useState<ActiveCodeSession | null>(null)
  // A file the code chat asked to review — consumed by the workspace pane.
  const [codeDiffPath, setCodeDiffPath] = useState<string | null>(null)
  const boundCodeSessionRef = useRef<string | null>(null)
  // Composer locks for runs that are code sessions: the session's cwd + agent
  // are frozen in the chat input (the backend pins them server-side anyway).
  // Kept after the Code view unmounts — the chat tab stays bound to the run.
  const [codeSessionLocks, setCodeSessionLocks] = useState<Record<string, { cwd: string; agent: 'claude' | 'codex' }>>({})
  const [editorSessionByTabId, setEditorSessionByTabId] = useState<Record<string, number>>({})
  const fileHistoryHandlersRef = useRef<Map<string, MarkdownHistoryHandlers>>(new Map())
  const fileTabIdCounterRef = useRef(0)
  const newFileTabId = () => `file-tab-${++fileTabIdCounterRef.current}`

  const getFileTabTitle = useCallback((tab: FileTab) => {
    if (isGraphTabPath(tab.path)) return 'Graph View'
    if (isSuggestedTopicsTabPath(tab.path)) return 'Suggested Topics'
    if (isMeetingsTabPath(tab.path)) return 'Meetings'
    if (isLiveNotesTabPath(tab.path)) return 'Live notes'
    if (isBgTasksTabPath(tab.path)) return 'Background tasks'
    if (isAppsTabPath(tab.path)) return 'Mini Apps'
    if (isEmailTabPath(tab.path)) return 'Email'
    if (isWorkspaceTabPath(tab.path)) return 'Workspace'
    if (isKnowledgeViewTabPath(tab.path)) return 'Brain'
    if (isChatHistoryTabPath(tab.path)) return 'Chat history'
    if (isHomeTabPath(tab.path)) return 'Home'
    if (isCodeTabPath(tab.path)) return 'Code'
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
  const [autoPermissionDecisions, setAutoPermissionDecisions] = useState<Map<string, z.infer<typeof ToolPermissionAutoDecisionEvent>>>(new Map())

  useEffect(() => {
    chatViewStateByTabRef.current = chatViewStateByTab
  }, [chatViewStateByTab])

  useEffect(() => {
    const snapshot: ChatTabViewState = {
      runId,
      conversation,
      currentAssistantMessage,
      sessionUsage: {},
      pendingAskHumanRequests: new Map(pendingAskHumanRequests),
      allPermissionRequests: new Map(allPermissionRequests),
      permissionResponses: new Map(permissionResponses),
      autoPermissionDecisions: new Map(autoPermissionDecisions),
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
    autoPermissionDecisions,
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

  // One-time Composio→native Google migration modal
  const [showComposioGoogleMigration, setShowComposioGoogleMigration] = useState(false)

  // Search state
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  // Optional scope override for the next time search opens (cleared on close).
  const [searchDefaultScope, setSearchDefaultScope] = useState<SearchType | undefined>(undefined)

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

  const reloadMarkdownFileIntoEditor = useCallback(async (path: string) => {
    const result = await window.ipc.invoke('workspace:readFile', { path, encoding: 'utf8' })
    const { raw: fm, body } = splitFrontmatter(result.data)
    frontmatterByPathRef.current.set(path, fm)
    setFileContent(result.data)
    setEditorContent(body)
    setEditorCacheForPath(path, body)
    editorContentRef.current = body
    editorPathRef.current = path
    initialContentByPathRef.current.set(path, body)
    initialContentRef.current = body
    setLastSaved(new Date())
    setEditorSessionByTabId((prev) => {
      let changed = false
      const next = { ...prev }
      for (const tab of fileTabs) {
        if (tab.path !== path) continue
        next[tab.id] = (next[tab.id] ?? 0) + 1
        changed = true
      }
      return changed ? next : prev
    })
  }, [fileTabs, setEditorCacheForPath])

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

  const syncGoogleDocDown = useCallback(async (targetPath?: string) => {
    const path = targetPath ?? selectedPathRef.current
    if (!path || !path.startsWith('knowledge/') || !path.endsWith('.md')) return

    setGoogleDocSyncDirection('down')
    markRecentLocalMarkdownWrite(path)
    try {
      await window.ipc.invoke('google-docs:refreshSnapshot', { path })
      markRecentLocalMarkdownWrite(path)
      await reloadMarkdownFileIntoEditor(path)
      toast.success('Pulled latest Google Doc')
    } catch (err) {
      console.error('Failed to sync Google Doc down:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to pull Google Doc')
    } finally {
      setGoogleDocSyncDirection(null)
    }
  }, [markRecentLocalMarkdownWrite, reloadMarkdownFileIntoEditor])

  const syncGoogleDocUp = useCallback(async (targetPath?: string) => {
    const path = targetPath ?? selectedPathRef.current
    if (!path || !path.startsWith('knowledge/') || !path.endsWith('.md')) return

    const body = editorContentByPathRef.current.get(path) ?? editorContentRef.current
    const markdown = joinFrontmatter(frontmatterByPathRef.current.get(path) ?? null, body)
    setGoogleDocSyncDirection('up')
    markRecentLocalMarkdownWrite(path)
    try {
      let result = await window.ipc.invoke('google-docs:sync', { path, markdown })
      if (result.conflict) {
        const overwrite = window.confirm(
          'This Google Doc changed since your last sync.\n\n' +
          'Overwrite it with your local version? Cancel to keep the remote copy ' +
          '(use “Sync down” to pull it first).',
        )
        if (!overwrite) {
          toast.info('Sync up cancelled — remote Google Doc is unchanged')
          return
        }
        result = await window.ipc.invoke('google-docs:sync', { path, markdown, force: true })
      }
      if (!result.synced) {
        throw new Error(result.error || 'This note is not linked to a Google Doc.')
      }
      markRecentLocalMarkdownWrite(path)
      await reloadMarkdownFileIntoEditor(path)
      toast.success('Pushed changes to Google Doc')
    } catch (err) {
      console.error('Failed to sync Google Doc up:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to push Google Doc')
    } finally {
      setGoogleDocSyncDirection(null)
    }
  }, [markRecentLocalMarkdownWrite, reloadMarkdownFileIntoEditor])
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

      // Reload bg-task summaries if anything under bg-tasks/ changed
      if (
        eventPaths.some((p) => p === 'bg-tasks' || p.startsWith('bg-tasks/'))
      ) {
        loadBgTaskSummaries()
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
    // Only the markdown editor still consumes fileContent. Every other viewer
    // (media + UnsupportedFileViewer) self-loads, so skip the generic UTF-8
    // loader to avoid double-fetching and to avoid slurping binary bytes.
    if (!pathToLoad.endsWith('.md')) {
      setFileContent('')
      return
    }
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
    if (selectedPathRef.current === pathAtStart && debouncedContent !== editorContentRef.current) return

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
      const { sessions } = await window.ipc.invoke('sessions:list', {})
      setRuns(sessions.map((entry) => ({
        id: entry.sessionId,
        title: entry.title ?? 'New chat',
        createdAt: entry.createdAt,
        modifiedAt: entry.updatedAt,
        agentId: entry.lastAgentId ?? 'copilot',
      })))
    } catch (err) {
      console.error('Failed to load sessions:', err)
    }
  }, [])

  // Load runs on mount
  useEffect(() => {
    loadRuns()
  }, [loadRuns])

  // Keep the runs list live: the session index publishes index-changed on
  // every write (session created, turn settled, title change, delete), so the
  // list stays current without re-fetching.
  useEffect(() => {
    return subscribeSessionFeed((event) => {
      if (event.kind !== 'index-changed') return
      setRuns((prev) => {
        if (event.entry === null) {
          return prev.filter((run) => run.id !== event.sessionId)
        }
        const next: RunListItem = {
          id: event.entry.sessionId,
          title: event.entry.title ?? 'New chat',
          createdAt: event.entry.createdAt,
          modifiedAt: event.entry.updatedAt,
          agentId: event.entry.lastAgentId ?? 'copilot',
        }
        // Re-sort: chat-header and home-view slice the top of this list
        // without sorting, so it must stay newest-first like sessions:list.
        const recency = (run: RunListItem) => {
          const ms = new Date(run.modifiedAt).getTime()
          return Number.isNaN(ms) ? 0 : ms
        }
        return [...prev.filter((run) => run.id !== next.id), next]
          .sort((a, b) => recency(b) - recency(a))
      })
    })
  }, [])

  const [bgTaskSummaries, setBgTaskSummaries] = useState<Array<{
    slug: string
    name: string
    active: boolean
    createdAt: string
    lastAttemptAt?: string
    lastRunAt?: string
    lastRunError?: string
  }>>([])
  const [bgTaskInitialSlug, setBgTaskInitialSlug] = useState<string | null>(null)
  const [bgTaskSlugVersion, setBgTaskSlugVersion] = useState(0)
  // Mini App to auto-open in the Mini Apps view (set by app-navigation open-app).
  const [appInitialId, setAppInitialId] = useState<string | null>(null)
  const [appIdVersion, setAppIdVersion] = useState(0)

  const loadBgTaskSummaries = useCallback(async () => {
    try {
      const result = await window.ipc.invoke('bg-task:list', { limit: 200 })
      setBgTaskSummaries(result.items.map((it) => ({
        slug: it.slug,
        name: it.name,
        active: it.active,
        createdAt: it.createdAt,
        lastAttemptAt: it.lastAttemptAt,
        lastRunAt: it.lastRunAt,
        lastRunError: it.lastRunError,
      })))
    } catch (err) {
      console.error('Failed to load bg-task summaries:', err)
    }
  }, [])

  useEffect(() => {
    loadBgTaskSummaries()
  }, [loadBgTaskSummaries])

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

  // Switch the active session. The useSessionChat hook loads and follows the
  // conversation; this only resets composer/tab state.
  const loadRun = useCallback(async (id: string) => {
    const requestId = (loadRunRequestIdRef.current += 1)
    setConversation([])
    setCurrentAssistantMessage('')
    setRunId(id)
    setMessage('')
    setIsProcessing(false)
    setIsStopping(false)
    setStopClickedAt(null)
    setPendingPermissionRequests(new Map())
    setPendingAskHumanRequests(new Map())
    setAllPermissionRequests(new Map())
    setPermissionResponses(new Map())
    setAutoPermissionDecisions(new Map())
    try {
      // Restore the session's per-chat work directory into the active tab.
      const tabId = activeChatTabIdRef.current
      const wd = await loadRunWorkDir(id)
      if (loadRunRequestIdRef.current !== requestId) return
      setWorkDirByTab((prev) => ({ ...prev, [tabId]: wd }))
    } catch (err) {
      console.error('Failed to load session work dir:', err)
    }
  }, [loadRunWorkDir])

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
        // Run creation alone isn't a turn. Code-session runs are created when
        // the session is (no message follows until the user sends one), so
        // marking them processing here would never be cleared — and wedge the
        // composer (Stop shown, send blocked) once the session binds a chat tab.
        if (event.useCase === 'code_session') return
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
                setAssistantCaption(voiceContent)
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
              dispatchCreditReplenished()
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
                  // a code_agent_run finished — drop any lingering permission card
                  pendingCodePermission: null,
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

          if (event.toolCallId) {
            setToolOpenForTab(activeChatTabIdRef.current, event.toolCallId, false)
          }

          // Handle app-navigation tool results — trigger UI side effects
          if (event.toolName === 'app-navigation') {
            const result = event.result as { success?: boolean; action?: string; [key: string]: unknown } | undefined
            if (result?.success) {
              pendingAppNavRef.current = result
            }
          }

          break
        }

      case 'tool-output-stream': {
        if (!isActiveRun) return
        setConversation(prev => prev.map(item => {
          if (
            isToolCall(item)
            && item.id === event.toolCallId
          ) {
            if (!item.streamingOutput) {
              setToolOpenForTab(activeChatTabIdRef.current, item.id, true)
            }
            return { ...item, streamingOutput: (item.streamingOutput ?? '') + event.output }
          }
          return item
        }))
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

      case 'code-run-event': {
        if (!isActiveRun) return
        setConversation(prev => prev.map(item => {
          if (isToolCall(item) && item.id === event.toolCallId) {
            const existing = item.codeRunEvents ?? []
            if (existing.length === 0) {
              setToolOpenForTab(activeChatTabIdRef.current, item.id, true)
            }
            return { ...item, codeRunEvents: [...existing, event.event] }
          }
          return item
        }))
        break
      }

      case 'code-run-permission-request': {
        if (!isActiveRun) return
        setConversation(prev => prev.map(item => {
          if (isToolCall(item) && item.id === event.toolCallId) {
            setToolOpenForTab(activeChatTabIdRef.current, item.id, true)
            return { ...item, pendingCodePermission: { requestId: event.requestId, ask: event.ask } }
          }
          return item
        }))
        break
      }

      case 'tool-permission-auto-decision': {
        if (!isActiveRun) return
        setAutoPermissionDecisions(prev => {
          const next = new Map(prev)
          next.set(event.toolCallId, event)
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
        if (!matchBillingError(event.error)) {
          toast.error(event.error.split('\n')[0] || 'Model error')
        }
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

  type MiddlePaneContextPayload =
    | { kind: 'note'; path: string; content: string }
    | { kind: 'browser'; url: string; title: string }
  const buildMiddlePaneContext = async (): Promise<MiddlePaneContextPayload | undefined> => {
    // Nothing visible in the middle pane when the right pane is maximized.
    if (isRightPaneMaximized) return undefined

    // Browser is an overlay on top of any note — when it's open, it's what the user is looking at.
    if (isBrowserOpen) {
      try {
        const state = await window.ipc.invoke('browser:getState', null)
        const activeTab = state.tabs.find((t) => t.id === state.activeTabId)
        if (activeTab) {
          return { kind: 'browser', url: activeTab.url, title: activeTab.title }
        }
      } catch {
        // fall through to no-context if browser state is unavailable
      }
      return undefined
    }

    // Note case: only markdown files are meaningfully readable as context.
    const path = selectedPathRef.current
    if (!path || !path.endsWith('.md')) return undefined
    const content = editorContentRef.current ?? ''
    return { kind: 'note', path, content }
  }

  const handlePromptSubmit = async (
    message: PromptInputMessage,
    mentions?: FileMention[],
    stagedAttachments: StagedAttachment[] = [],
    searchEnabled?: boolean,
    codeMode?: 'claude' | 'codex',
    permissionMode?: PermissionMode,
  ) => {
    if (activeIsProcessing) return

    const submitTabId = activeChatTabIdRef.current
    const { text } = message
    const userMessage = text.trim()
    const hasAttachments = stagedAttachments.length > 0
    if (!userMessage && !hasAttachments) return

    setMessage('')

    // Video chat mode: drain the webcam frames buffered since the last send
    // so they ride along with this message as inline image parts.
    const marks = callTurnMarksRef.current
    if (inCallRef.current && marks && marks.submit === undefined) {
      marks.submit = performance.now()
    }

    const videoFrames = inCallRef.current ? video.collectFrames() : []

    const userMessageId = `user-${Date.now()}`
    const displayAttachments: ChatMessage['attachments'] = hasAttachments || videoFrames.length > 0
      ? [
          ...stagedAttachments.map((attachment) => ({
            path: attachment.path,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            size: attachment.size,
            thumbnailUrl: attachment.thumbnailUrl,
          })),
          ...videoFrames.map((frame, index) => ({
            path: '',
            filename: `${frame.source}-frame-${index + 1}.jpg`,
            mimeType: frame.mediaType,
            thumbnailUrl: frame.dataUrl,
            isVideoFrame: true,
          })),
        ]
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
      const selected = selectedModelByTabRef.current.get(submitTabId)
      if (!currentRunId) {
        const createdSession = await window.ipc.invoke('sessions:create', {})
        currentRunId = createdSession.sessionId
        newRunCreatedAt = new Date().toISOString()
        setRunId(currentRunId)
        analytics.chatSessionCreated(currentRunId)
        // Update active chat tab's runId to the new run
        setChatTabs((prev) => prev.map((tab) => (
          tab.id === submitTabId
            ? { ...tab, runId: currentRunId }
            : tab
        )))
        // Flush this tab's pending work directory onto the freshly created run so
        // the agent picks it up on the first turn. Done before createMessage below.
        const pendingWorkDir = workDirByTabRef.current[submitTabId] ?? null
        if (pendingWorkDir) await persistRunWorkDir(currentRunId, pendingWorkDir)
        isNewRun = true
      }

      let titleSource = userMessage
      const hasMentions = (mentions?.length ?? 0) > 0

      // Per-message turn config. Composition inputs land in the system prompt
      // via the agent resolver; keep them session-sticky where possible so the
      // provider prefix cache survives across turns.
      const sendConfig = {
        agent: {
          agentId,
          overrides: {
            ...(selected ? { model: { provider: selected.provider, model: selected.model } } : {}),
            composition: {
              workDirId: currentRunId,
              ...(pendingVoiceInputRef.current ? { voiceInput: true } : {}),
              ...(ttsEnabledRef.current ? { voiceOutput: ttsModeRef.current } : {}),
              ...(searchEnabled ? { searchEnabled: true } : {}),
              ...(codeMode ? { codeMode } : {}),
              ...(inCallRef.current && (video.cameraOn || video.screenState === 'live') ? { videoMode: true } : {}),
              ...(practiceModeRef.current ? { coachMode: true } : {}),
            },
          },
        },
        autoPermission: (permissionMode ?? 'manual') === 'auto',
      }
      const userMessageContextFor = (middlePane: Awaited<ReturnType<typeof buildMiddlePaneContext>>) => ({
        currentDateTime: new Date().toISOString(),
        middlePane: middlePane ?? { kind: 'empty' as const },
      })

      if (hasAttachments || hasMentions || videoFrames.length > 0) {
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
          | {
              type: 'image'
              data: string
              mediaType: string
              source: 'camera' | 'screen'
              capturedAt: string
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

        for (const frame of videoFrames) {
          contentParts.push({
            type: 'image',
            data: frame.data,
            mediaType: frame.mediaType,
            source: frame.source,
            capturedAt: frame.capturedAt,
          })
        }

        const middlePaneContext = await buildMiddlePaneContext()
        await window.ipc.invoke('sessions:sendMessage', {
          sessionId: currentRunId,
          input: {
            role: 'user',
            content: contentParts,
            userMessageContext: userMessageContextFor(middlePaneContext),
          },
          config: sendConfig,
        })
        analytics.chatMessageSent({
          voiceInput: pendingVoiceInputRef.current || undefined,
          voiceOutput: ttsEnabledRef.current ? ttsModeRef.current : undefined,
          searchEnabled: searchEnabled || undefined,
        })
      } else {
        const middlePaneContext = await buildMiddlePaneContext()
        await window.ipc.invoke('sessions:sendMessage', {
          sessionId: currentRunId,
          input: {
            role: 'user',
            content: userMessage,
            userMessageContext: userMessageContextFor(middlePaneContext),
          },
          config: sendConfig,
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
          const createdAt = newRunCreatedAt ?? new Date().toISOString()
          return [{
            id: currentRunId!,
            title: inferredTitle,
            createdAt,
            modifiedAt: createdAt,
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

  // The composer's stop state clears when the active turn settles.
  useEffect(() => {
    if (sessionChat.chatState && !sessionChat.chatState.isProcessing) {
      setIsStopping(false)
      setStopClickedAt(null)
    }
  }, [sessionChat.chatState])

  const handleStop = useCallback(async () => {
    if (!runId) return
    setStopClickedAt(Date.now())
    setIsStopping(true)
    // Stopping the run must also silence it — the TTS queue holds segments
    // that were already extracted from the stream and would keep playing
    // long after the turn is aborted.
    ttsRef.current.cancel()
    setAssistantCaption('')
    try {
      await sessionChat.stop()
    } catch (error) {
      console.error('Failed to stop turn:', error)
    }
  }, [runId, sessionChat])
  stopRunRef.current = handleStop

  const handlePermissionResponse = useCallback(async (
    toolCallId: string,
    subflow: string[],
    response: 'approve' | 'deny',
    scope?: 'once' | 'session' | 'always',
  ) => {
    if (!runId) return

    void subflow // subflows retired with the runs runtime
    try {
      await sessionChat.respondToPermission(
        toolCallId,
        response === 'approve' ? 'allow' : 'deny',
        scope ? { scope } : undefined,
      )
    } catch (error) {
      console.error('Failed to authorize permission:', error)
    }
  }, [runId, sessionChat])

  // Answer a mid-run permission request from a code_agent_run coding turn. The
  // pending ask lives on the tool call itself, so we optimistically clear it and
  // tell main which decision the user picked (keyed by the request id).
  const handleCodePermissionResponse = useCallback(async (
    toolCallId: string,
    requestId: string,
    decision: 'allow_once' | 'allow_always' | 'reject',
  ) => {
    setConversation(prev => prev.map(item =>
      isToolCall(item) && item.id === toolCallId
        ? { ...item, pendingCodePermission: null }
        : item
    ))
    try {
      await window.ipc.invoke('codeRun:resolvePermission', { requestId, decision })
    } catch (error) {
      console.error('Failed to resolve code permission:', error)
    }
  }, [])

  const handleAskHumanResponse = useCallback(async (toolCallId: string, subflow: string[], response: string) => {
    if (!runId) return
    void subflow // subflows retired with the runs runtime
    try {
      await sessionChat.answerAskHuman(toolCallId, response)
    } catch (error) {
      console.error('Failed to provide human input:', error)
    }
  }, [runId, sessionChat])

  const dismissBrowserOverlay = useCallback(() => {
    setIsBrowserOpen(false)
  }, [])

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
    setAutoPermissionDecisions(new Map())
    setSelectedBackgroundTask(null)
    setChatViewportAnchor(activeChatTabIdRef.current, null)
    setChatViewStateByTab(prev => ({
      ...prev,
      [activeChatTabIdRef.current]: createEmptyChatTabViewState(),
    }))
    // A brand-new chat starts with no work directory.
    setWorkDirByTab(prev => ({ ...prev, [activeChatTabIdRef.current]: null }))
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
      setAutoPermissionDecisions(new Map())
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
    setAutoPermissionDecisions(new Map(cached.autoPermissionDecisions))
    setIsProcessing(Boolean(resolvedRunId && processingRunIdsRef.current.has(resolvedRunId)))
    return true
  }, [])

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

  // A code session was selected (or changed mode/status) in the Code view.
  // Rowboat-mode sessions take over the assistant chat pane by binding their
  // run to a chat tab — the conversation IS the assistant chat, no copy.
  // Direct-mode sessions render their own pane instead (see right-pane JSX).
  const handleCodeSessionSelected = useCallback((active: ActiveCodeSession | null) => {
    setActiveCodeSession(active)
    if (active) {
      const { id, cwd, agent } = active.session
      setCodeSessionLocks((prev) => (
        prev[id]?.cwd === cwd && prev[id]?.agent === agent
          ? prev
          : { ...prev, [id]: { cwd, agent } }
      ))
    }
    const rowboatSessionId = active && active.session.mode === 'rowboat' ? active.session.id : null
    if (!rowboatSessionId) {
      boundCodeSessionRef.current = null
      return
    }
    if (boundCodeSessionRef.current === rowboatSessionId) return
    boundCodeSessionRef.current = rowboatSessionId
    const existingTab = chatTabsRef.current.find((t) => t.runId === rowboatSessionId)
    if (existingTab) {
      switchChatTab(existingTab.id)
      return
    }
    setChatTabs((prev) => prev.map((t) => (
      t.id === activeChatTabIdRef.current ? { ...t, runId: rowboatSessionId } : t
    )))
    loadRun(rowboatSessionId)
  }, [switchChatTab, loadRun])

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
    selectedModelByTabRef.current.delete(tabId)
    chatScrollTopByTabRef.current.delete(tabId)
    setWorkDirByTab((prev) => {
      if (!(tabId in prev)) return prev
      const next = { ...prev }
      delete next[tabId]
      return next
    })
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
    dismissBrowserOverlay()
    const existingTab = fileTabs.find(t => t.path === path)
    if (existingTab) {
      setActiveFileTabId(existingTab.id)
      setIsGraphOpen(false)
      setIsSuggestedTopicsOpen(false)
      setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
      setSelectedPath(path)
      return
    }
    const id = newFileTabId()
    setFileTabs(prev => [...prev, { id, path }])
    setActiveFileTabId(id)
    setIsGraphOpen(false)
    setIsSuggestedTopicsOpen(false)
    setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
    setSelectedPath(path)
  }, [fileTabs, dismissBrowserOverlay])

  const switchFileTab = useCallback((tabId: string) => {
    const tab = fileTabs.find(t => t.id === tabId)
    if (!tab) return
    dismissBrowserOverlay()
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
      setIsSuggestedTopicsOpen(false)
      setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
      return
    }
    if (isSuggestedTopicsTabPath(tab.path)) {
      setSelectedPath(null)
      setIsGraphOpen(false)
      setIsSuggestedTopicsOpen(true)
      setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
      return
    }
    if (isLiveNotesTabPath(tab.path)) {
      setSelectedPath(null)
      setIsGraphOpen(false)
      setIsSuggestedTopicsOpen(false)
      setIsMeetingsOpen(false)
      setIsBgTasksOpen(false)
      setIsEmailOpen(false)
      setIsWorkspaceOpen(false)
      setIsKnowledgeViewOpen(false)
      setIsChatHistoryOpen(false)
      setIsHomeOpen(false); setIsAppsOpen(false)
      setIsLiveNotesOpen(true)
      return
    }
    if (isBgTasksTabPath(tab.path)) {
      setSelectedPath(null)
      setIsGraphOpen(false)
      setIsSuggestedTopicsOpen(false)
      setIsMeetingsOpen(false)
      setIsLiveNotesOpen(false)
      setIsEmailOpen(false)
      setIsWorkspaceOpen(false)
      setIsKnowledgeViewOpen(false)
      setIsChatHistoryOpen(false)
      setIsHomeOpen(false); setIsAppsOpen(false)
      setIsBgTasksOpen(true)
      return
    }
    if (isAppsTabPath(tab.path)) {
      setSelectedPath(null)
      setIsGraphOpen(false)
      setIsSuggestedTopicsOpen(false)
      setIsMeetingsOpen(false)
      setIsLiveNotesOpen(false)
      setIsBgTasksOpen(false)
      setIsEmailOpen(false)
      setIsWorkspaceOpen(false)
      setIsKnowledgeViewOpen(false)
      setIsChatHistoryOpen(false)
      setIsHomeOpen(false)
      setIsAppsOpen(true)
      return
    }
    if (isMeetingsTabPath(tab.path)) {
      setSelectedPath(null)
      setIsGraphOpen(false)
      setIsSuggestedTopicsOpen(false)
      setIsMeetingsOpen(true)
      setIsLiveNotesOpen(false)
      setIsBgTasksOpen(false)
      setIsEmailOpen(false)
      setIsWorkspaceOpen(false)
      setIsKnowledgeViewOpen(false)
      setIsChatHistoryOpen(false)
      setIsHomeOpen(false); setIsAppsOpen(false)
      return
    }
    if (isEmailTabPath(tab.path)) {
      setSelectedPath(null)
      setIsGraphOpen(false)
      setIsSuggestedTopicsOpen(false)
      setIsMeetingsOpen(false)
      setIsLiveNotesOpen(false)
      setIsBgTasksOpen(false)
      setIsWorkspaceOpen(false)
      setIsKnowledgeViewOpen(false)
      setIsChatHistoryOpen(false)
      setIsHomeOpen(false); setIsAppsOpen(false)
      setIsEmailOpen(true)
      return
    }
    if (isWorkspaceTabPath(tab.path)) {
      setSelectedPath(null)
      setIsGraphOpen(false)
      setIsSuggestedTopicsOpen(false)
      setIsMeetingsOpen(false)
      setIsLiveNotesOpen(false)
      setIsBgTasksOpen(false)
      setIsEmailOpen(false)
      setIsKnowledgeViewOpen(false)
      setIsChatHistoryOpen(false)
      setIsHomeOpen(false); setIsAppsOpen(false)
      setIsWorkspaceOpen(true)
      return
    }
    if (isKnowledgeViewTabPath(tab.path)) {
      setSelectedPath(null)
      setIsGraphOpen(false)
      setIsSuggestedTopicsOpen(false)
      setIsMeetingsOpen(false)
      setIsLiveNotesOpen(false)
      setIsBgTasksOpen(false)
      setIsEmailOpen(false)
      setIsWorkspaceOpen(false)
      setIsChatHistoryOpen(false)
      setIsHomeOpen(false); setIsAppsOpen(false)
      setIsKnowledgeViewOpen(true)
      return
    }
    if (isChatHistoryTabPath(tab.path)) {
      setSelectedPath(null)
      setIsGraphOpen(false)
      setIsSuggestedTopicsOpen(false)
      setIsMeetingsOpen(false)
      setIsLiveNotesOpen(false)
      setIsBgTasksOpen(false)
      setIsEmailOpen(false)
      setIsWorkspaceOpen(false)
      setIsKnowledgeViewOpen(false)
      setIsChatHistoryOpen(true); setIsHomeOpen(false); setIsAppsOpen(false)
      return
    }
    if (isHomeTabPath(tab.path)) {
      setSelectedPath(null)
      setIsGraphOpen(false)
      setIsSuggestedTopicsOpen(false)
      setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false)
      setIsHomeOpen(true); setIsAppsOpen(false)
      return
    }
    if (isCodeTabPath(tab.path)) {
      // isCodeOpen itself is derived from the active tab — just clear the rest.
      setSelectedPath(null)
      setIsGraphOpen(false)
      setIsSuggestedTopicsOpen(false)
      setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
      return
    }
    setIsGraphOpen(false)
    setIsSuggestedTopicsOpen(false)
    setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
    setSelectedPath(tab.path)
  }, [fileTabs, isRightPaneMaximized, dismissBrowserOverlay])

  const closeFileTab = useCallback((tabId: string) => {
    const closingTab = fileTabs.find(t => t.id === tabId)
    if (closingTab && !isGraphTabPath(closingTab.path) && !isSuggestedTopicsTabPath(closingTab.path) && !isLiveNotesTabPath(closingTab.path) && !isBgTasksTabPath(closingTab.path) && !isAppsTabPath(closingTab.path) && !isEmailTabPath(closingTab.path) && !isWorkspaceTabPath(closingTab.path) && !isKnowledgeViewTabPath(closingTab.path) && !isChatHistoryTabPath(closingTab.path) && !isHomeTabPath(closingTab.path) && !isCodeTabPath(closingTab.path) && !isBaseFilePath(closingTab.path)) {
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
        setIsSuggestedTopicsOpen(false)
        setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
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
          setIsSuggestedTopicsOpen(false)
          setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
        } else if (isSuggestedTopicsTabPath(newActiveTab.path)) {
          setSelectedPath(null)
          setIsGraphOpen(false)
          setIsSuggestedTopicsOpen(true)
          setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
        } else if (isMeetingsTabPath(newActiveTab.path)) {
          setSelectedPath(null)
          setIsGraphOpen(false)
          setIsSuggestedTopicsOpen(false)
          setIsMeetingsOpen(true)
          setIsLiveNotesOpen(false)
          setIsBgTasksOpen(false)
          setIsEmailOpen(false)
          setIsWorkspaceOpen(false)
          setIsKnowledgeViewOpen(false)
          setIsChatHistoryOpen(false)
      setIsHomeOpen(false); setIsAppsOpen(false)
        } else if (isLiveNotesTabPath(newActiveTab.path)) {
          setSelectedPath(null)
          setIsGraphOpen(false)
          setIsSuggestedTopicsOpen(false)
          setIsMeetingsOpen(false)
          setIsBgTasksOpen(false)
          setIsEmailOpen(false)
          setIsWorkspaceOpen(false)
          setIsKnowledgeViewOpen(false)
          setIsChatHistoryOpen(false)
      setIsHomeOpen(false); setIsAppsOpen(false)
          setIsLiveNotesOpen(true)
        } else if (isBgTasksTabPath(newActiveTab.path)) {
          setSelectedPath(null)
          setIsGraphOpen(false)
          setIsSuggestedTopicsOpen(false)
          setIsMeetingsOpen(false)
          setIsLiveNotesOpen(false)
          setIsBgTasksOpen(true)
          setIsEmailOpen(false)
          setIsWorkspaceOpen(false)
          setIsKnowledgeViewOpen(false)
          setIsChatHistoryOpen(false)
      setIsHomeOpen(false); setIsAppsOpen(false)
        } else if (isAppsTabPath(newActiveTab.path)) {
          setSelectedPath(null)
          setIsGraphOpen(false)
          setIsSuggestedTopicsOpen(false)
          setIsMeetingsOpen(false)
          setIsLiveNotesOpen(false)
          setIsBgTasksOpen(false)
          setIsEmailOpen(false)
          setIsWorkspaceOpen(false)
          setIsKnowledgeViewOpen(false)
          setIsChatHistoryOpen(false)
          setIsHomeOpen(false)
          setIsAppsOpen(true)
        } else if (isEmailTabPath(newActiveTab.path)) {
          setSelectedPath(null)
          setIsGraphOpen(false)
          setIsSuggestedTopicsOpen(false)
          setIsMeetingsOpen(false)
          setIsLiveNotesOpen(false)
          setIsBgTasksOpen(false)
          setIsWorkspaceOpen(false)
          setIsKnowledgeViewOpen(false)
          setIsChatHistoryOpen(false)
      setIsHomeOpen(false); setIsAppsOpen(false)
          setIsEmailOpen(true)
        } else if (isWorkspaceTabPath(newActiveTab.path)) {
          setSelectedPath(null)
          setIsGraphOpen(false)
          setIsSuggestedTopicsOpen(false)
          setIsMeetingsOpen(false)
          setIsLiveNotesOpen(false)
          setIsBgTasksOpen(false)
          setIsEmailOpen(false)
          setIsKnowledgeViewOpen(false)
          setIsChatHistoryOpen(false)
      setIsHomeOpen(false); setIsAppsOpen(false)
          setIsWorkspaceOpen(true)
        } else if (isKnowledgeViewTabPath(newActiveTab.path)) {
          setSelectedPath(null)
          setIsGraphOpen(false)
          setIsSuggestedTopicsOpen(false)
          setIsMeetingsOpen(false)
          setIsLiveNotesOpen(false)
          setIsBgTasksOpen(false)
          setIsEmailOpen(false)
          setIsWorkspaceOpen(false)
          setIsChatHistoryOpen(false)
      setIsHomeOpen(false); setIsAppsOpen(false)
          setIsKnowledgeViewOpen(true)
        } else if (isChatHistoryTabPath(newActiveTab.path)) {
          setSelectedPath(null)
          setIsGraphOpen(false)
          setIsSuggestedTopicsOpen(false)
          setIsMeetingsOpen(false)
          setIsLiveNotesOpen(false)
          setIsBgTasksOpen(false)
          setIsEmailOpen(false)
          setIsWorkspaceOpen(false)
          setIsKnowledgeViewOpen(false)
          setIsChatHistoryOpen(true); setIsHomeOpen(false); setIsAppsOpen(false)
        } else if (isHomeTabPath(newActiveTab.path)) {
          setSelectedPath(null)
          setIsGraphOpen(false)
          setIsSuggestedTopicsOpen(false)
          setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false)
          setIsHomeOpen(true); setIsAppsOpen(false)
        } else {
          setIsGraphOpen(false)
          setIsSuggestedTopicsOpen(false)
          setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
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
    // Single-chat model: reset the one conversation in place instead of
    // opening a new tab.
    setChatTabs([{ id: activeChatTabIdRef.current, runId: null }])
    dismissBrowserOverlay()
    handleNewChat()
    // Left-pane "new chat" should always open full chat view.
    if (selectedPath || isGraphOpen || isSuggestedTopicsOpen || isMeetingsOpen || isLiveNotesOpen || isBgTasksOpen || isAppsOpen || isEmailOpen || isWorkspaceOpen || isKnowledgeViewOpen || isChatHistoryOpen || isHomeOpen) {
      setExpandedFrom({
        path: selectedPath,
        graph: isGraphOpen,
        suggestedTopics: isSuggestedTopicsOpen,
        meetings: isMeetingsOpen,
        liveNotes: isLiveNotesOpen,
        bgTasks: isBgTasksOpen,
        email: isEmailOpen,
      })
    } else {
      setExpandedFrom(null)
    }
    setIsRightPaneMaximized(false)
    setSelectedPath(null)
    setIsGraphOpen(false)
    setIsSuggestedTopicsOpen(false)
    setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
  }, [dismissBrowserOverlay, handleNewChat, selectedPath, isGraphOpen, isSuggestedTopicsOpen, isMeetingsOpen, isLiveNotesOpen, isBgTasksOpen, isAppsOpen, isEmailOpen, isWorkspaceOpen, isKnowledgeViewOpen, isChatHistoryOpen, isHomeOpen])

  // Sidebar variant: reset the chat in place without leaving file/graph context.
  const handleNewChatTabInSidebar = useCallback(() => {
    setChatTabs([{ id: activeChatTabIdRef.current, runId: null }])
    handleNewChat()
  }, [handleNewChat])

  // Palette → sidebar submission. Opens the sidebar (if closed), forces a fresh chat tab,
  // queues the message; the pending-submit effect (below) flushes it once state has settled
  // so handlePromptSubmit sees the new tab's null runId.
  const submitFromPalette = useCallback((text: string, mention: CommandPaletteMention | null) => {
    if (!isChatSidebarOpen) setIsChatSidebarOpen(true)
    handleNewChatTabInSidebar()
    setPendingPaletteSubmit({ text, mention })
  }, [isChatSidebarOpen, handleNewChatTabInSidebar])

  // Open the chat sidebar on a fresh tab and pre-fill (not send) a builder prompt.
  const prefillChat = useCallback((text: string) => {
    if (!isChatSidebarOpen) setIsChatSidebarOpen(true)
    handleNewChatTabInSidebar()
    setPresetMessage(text)
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

  // Listener for "Edit with Copilot" events from the live-note panel.
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{
        filePath?: string
      }>
      const filePath = ev.detail?.filePath
      if (!filePath) return
      const displayName = filePath.split('/').pop() ?? filePath
      submitFromPalette(
        `Let's tweak the live note objective in this note. Please load the \`live-note\` skill first, then ask me what I want to change.`,
        { path: filePath, displayName },
      )
    }
    window.addEventListener('rowboat:open-copilot-edit-live-note', handler as EventListener)
    return () => window.removeEventListener('rowboat:open-copilot-edit-live-note', handler as EventListener)
  }, [submitFromPalette])

  // Listener for the toolbar "Live note" button — opens the panel for a path.
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ filePath?: string }>
      const filePath = ev.detail?.filePath
      if (!filePath) return
      setLiveNotePanelPath(filePath)
    }
    window.addEventListener('rowboat:open-live-note-panel', handler as EventListener)
    return () => window.removeEventListener('rowboat:open-live-note-panel', handler as EventListener)
  }, [])

  // Auto-close the live-note panel when the active note changes — the panel is
  // bound to a specific path, so switching notes invalidates it.
  useEffect(() => {
    if (liveNotePanelPath && liveNotePanelPath !== selectedPath) {
      setLiveNotePanelPath(null)
    }
  }, [selectedPath, liveNotePanelPath])

  // Listener for prompt-block "Run" events
  // (dispatched by apps/renderer/src/extensions/prompt-block.tsx)
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{
        instruction?: string
        filePath?: string
        label?: string
      }>
      const instruction = ev.detail?.instruction
      const filePath = ev.detail?.filePath
      if (!instruction) return
      const mention = filePath
        ? { path: filePath, displayName: filePath.split('/').pop() ?? filePath }
        : null
      submitFromPalette(instruction, mention)
    }
    window.addEventListener('rowboat:open-copilot-prompt', handler as EventListener)
    return () => window.removeEventListener('rowboat:open-copilot-prompt', handler as EventListener)
  }, [submitFromPalette])

  // Reveal the chat in the right side pane (from the middle-panel chat icon).
  const openChatSidePane = useCallback(() => {
    setIsRightPaneMaximized(false)
    setIsChatSidebarOpen(true)
  }, [])

  // Browser is an overlay on the middle pane: opening it forces the chat
  // sidebar to be visible on the right; closing it restores whatever the
  // middle pane was showing previously (file/graph/task/chat).
  const handleToggleBrowser = useCallback(() => {
    setIsBrowserOpen(prev => {
      const next = !prev
      if (next) {
        setIsChatSidebarOpen(true)
        setIsRightPaneMaximized(false)
      }
      return next
    })
  }, [])

  const handleCloseBrowser = useCallback(() => {
    setIsBrowserOpen(false)
  }, [])

  const toggleRightPaneMaximize = useCallback(() => {
    setIsChatSidebarOpen(true)
    setIsRightPaneMaximized(prev => {
      if (!prev) {
        // About to collapse the middle pane: capture its real width now, while it's
        // still laid out, so the collapse can animate from a binding px value.
        const px = document.querySelector('[data-slot="sidebar-inset"]')?.getBoundingClientRect().width
        setInsetCollapseFromPx(px && px > 0 ? px : null)
      }
      return !prev
    })
  }, [])

  const handleOpenFullScreenChat = useCallback(() => {
    // Remember where we came from so the close button can return
    if (selectedPath || isGraphOpen || isSuggestedTopicsOpen || isMeetingsOpen || isLiveNotesOpen || isBgTasksOpen || isAppsOpen || isEmailOpen || isWorkspaceOpen || isKnowledgeViewOpen || isChatHistoryOpen || isHomeOpen) {
      setExpandedFrom({
        path: selectedPath,
        graph: isGraphOpen,
        suggestedTopics: isSuggestedTopicsOpen,
        meetings: isMeetingsOpen,
        liveNotes: isLiveNotesOpen,
        bgTasks: isBgTasksOpen,
        email: isEmailOpen,
      })
    }
    dismissBrowserOverlay()
    setIsRightPaneMaximized(false)
    setSelectedPath(null)
    setIsGraphOpen(false)
    setIsSuggestedTopicsOpen(false)
    setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
  }, [selectedPath, isGraphOpen, isSuggestedTopicsOpen, isMeetingsOpen, isLiveNotesOpen, isBgTasksOpen, isAppsOpen, isEmailOpen, isWorkspaceOpen, isKnowledgeViewOpen, isChatHistoryOpen, dismissBrowserOverlay])

  const handleCloseFullScreenChat = useCallback((): boolean => {
    let restored = false
    if (expandedFrom) {
      restored = true
      if (expandedFrom.graph) {
        setIsGraphOpen(true)
        setIsSuggestedTopicsOpen(false)
        setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
      } else if (expandedFrom.suggestedTopics) {
        setIsGraphOpen(false)
        setIsSuggestedTopicsOpen(true)
        setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
      } else if (expandedFrom.meetings) {
        setIsGraphOpen(false)
        setIsSuggestedTopicsOpen(false)
        setIsMeetingsOpen(true)
        setIsLiveNotesOpen(false)
        setIsBgTasksOpen(false)
        setIsEmailOpen(false)
      } else if (expandedFrom.liveNotes) {
        setIsGraphOpen(false)
        setIsSuggestedTopicsOpen(false)
        setIsMeetingsOpen(false)
        setIsBgTasksOpen(false)
        setIsEmailOpen(false)
        setIsLiveNotesOpen(true)
      } else if (expandedFrom.bgTasks) {
        setIsGraphOpen(false)
        setIsSuggestedTopicsOpen(false)
        setIsMeetingsOpen(false)
        setIsLiveNotesOpen(false)
        setIsBgTasksOpen(true)
        setIsEmailOpen(false)
      } else if (expandedFrom.email) {
        setIsGraphOpen(false)
        setIsSuggestedTopicsOpen(false)
        setIsMeetingsOpen(false)
        setIsLiveNotesOpen(false)
        setIsBgTasksOpen(false)
        setIsEmailOpen(true)
      } else if (expandedFrom.path) {
        setIsGraphOpen(false)
        setIsSuggestedTopicsOpen(false)
        setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
        setSelectedPath(expandedFrom.path)
      } else {
        // expandedFrom was captured from a view this restorer doesn't track
        // (e.g. Home): there's nothing to re-open, so report it and let the
        // caller fall back instead of leaving a blank full-screen chat.
        restored = false
      }
      setExpandedFrom(null)
      setIsRightPaneMaximized(false)
    }
    return restored
  }, [expandedFrom])

  const currentViewState = React.useMemo<ViewState>(() => {
    if (selectedBackgroundTask) return { type: 'task', name: selectedBackgroundTask }
    if (isEmailOpen) return { type: 'email' }
    if (isMeetingsOpen) return { type: 'meetings' }
    if (isLiveNotesOpen) return { type: 'live-notes' }
    if (isSuggestedTopicsOpen) return { type: 'suggested-topics' }
    if (isWorkspaceOpen) return { type: 'workspace', path: workspaceInitialPath ?? undefined }
    if (isKnowledgeViewOpen) return { type: 'knowledge-view', folderPath: knowledgeViewFolderPath ?? undefined, mode: knowledgeViewMode }
    if (isChatHistoryOpen) return { type: 'chat-history' }
    if (isHomeOpen) return { type: 'home' }
    if (isCodeOpen) return { type: 'code' }
    if (isBgTasksOpen) return { type: 'bg-tasks' }
    if (isAppsOpen) return { type: 'apps' }
    if (selectedPath) return { type: 'file', path: selectedPath }
    if (isGraphOpen) return { type: 'graph' }
    return { type: 'chat', runId }
  }, [selectedBackgroundTask, isEmailOpen, isMeetingsOpen, isLiveNotesOpen, isBgTasksOpen, isAppsOpen, isSuggestedTopicsOpen, selectedPath, isGraphOpen, isWorkspaceOpen, isKnowledgeViewOpen, knowledgeViewFolderPath, knowledgeViewMode, isChatHistoryOpen, isHomeOpen, isCodeOpen, workspaceInitialPath, runId])

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

  const ensureSuggestedTopicsFileTab = useCallback(() => {
    const existing = fileTabs.find((tab) => isSuggestedTopicsTabPath(tab.path))
    if (existing) {
      setActiveFileTabId(existing.id)
      return
    }
    const id = newFileTabId()
    setFileTabs((prev) => [...prev, { id, path: SUGGESTED_TOPICS_TAB_PATH }])
    setActiveFileTabId(id)
  }, [fileTabs])

  const ensureLiveNotesFileTab = useCallback(() => {
    const existing = fileTabs.find((tab) => isLiveNotesTabPath(tab.path))
    if (existing) {
      setActiveFileTabId(existing.id)
      return
    }
    const id = newFileTabId()
    setFileTabs((prev) => [...prev, { id, path: LIVE_NOTES_TAB_PATH }])
    setActiveFileTabId(id)
  }, [fileTabs])

  const ensureMeetingsFileTab = useCallback(() => {
    const existing = fileTabs.find((tab) => isMeetingsTabPath(tab.path))
    if (existing) {
      setActiveFileTabId(existing.id)
      return
    }
    const id = newFileTabId()
    setFileTabs((prev) => [...prev, { id, path: MEETINGS_TAB_PATH }])
    setActiveFileTabId(id)
  }, [fileTabs])

  const ensureBgTasksFileTab = useCallback(() => {
    const existing = fileTabs.find((tab) => isBgTasksTabPath(tab.path))
    if (existing) {
      setActiveFileTabId(existing.id)
      return
    }
    const id = newFileTabId()
    setFileTabs((prev) => [...prev, { id, path: BG_TASKS_TAB_PATH }])
    setActiveFileTabId(id)
  }, [fileTabs])

  const ensureAppsFileTab = useCallback(() => {
    const existing = fileTabs.find((tab) => isAppsTabPath(tab.path))
    if (existing) {
      setActiveFileTabId(existing.id)
      return
    }
    const id = newFileTabId()
    setFileTabs((prev) => [...prev, { id, path: APPS_TAB_PATH }])
    setActiveFileTabId(id)
  }, [fileTabs])

  const ensureEmailFileTab = useCallback(() => {
    const existing = fileTabs.find((tab) => isEmailTabPath(tab.path))
    if (existing) {
      setActiveFileTabId(existing.id)
      return
    }
    const id = newFileTabId()
    setFileTabs((prev) => [...prev, { id, path: EMAIL_TAB_PATH }])
    setActiveFileTabId(id)
  }, [fileTabs])

  const ensureWorkspaceFileTab = useCallback(() => {
    const existing = fileTabs.find((tab) => isWorkspaceTabPath(tab.path))
    if (existing) {
      setActiveFileTabId(existing.id)
      return
    }
    const id = newFileTabId()
    setFileTabs((prev) => [...prev, { id, path: WORKSPACE_TAB_PATH }])
    setActiveFileTabId(id)
  }, [fileTabs])

  const ensureKnowledgeViewFileTab = useCallback(() => {
    const existing = fileTabs.find((tab) => isKnowledgeViewTabPath(tab.path))
    if (existing) {
      setActiveFileTabId(existing.id)
      return
    }
    const id = newFileTabId()
    setFileTabs((prev) => [...prev, { id, path: KNOWLEDGE_VIEW_TAB_PATH }])
    setActiveFileTabId(id)
  }, [fileTabs])

  const ensureChatHistoryFileTab = useCallback(() => {
    const existing = fileTabs.find((tab) => isChatHistoryTabPath(tab.path))
    if (existing) {
      setActiveFileTabId(existing.id)
      return
    }
    const id = newFileTabId()
    setFileTabs((prev) => [...prev, { id, path: CHAT_HISTORY_TAB_PATH }])
    setActiveFileTabId(id)
  }, [fileTabs])

  const ensureHomeFileTab = useCallback(() => {
    const existing = fileTabs.find((tab) => isHomeTabPath(tab.path))
    if (existing) {
      setActiveFileTabId(existing.id)
      return
    }
    const id = newFileTabId()
    setFileTabs((prev) => [...prev, { id, path: HOME_TAB_PATH }])
    setActiveFileTabId(id)
  }, [fileTabs])

  const ensureCodeFileTab = useCallback(() => {
    const existing = fileTabs.find((tab) => isCodeTabPath(tab.path))
    if (existing) {
      setActiveFileTabId(existing.id)
      return
    }
    const id = newFileTabId()
    setFileTabs((prev) => [...prev, { id, path: CODE_TAB_PATH }])
    setActiveFileTabId(id)
  }, [fileTabs])

  const openEmailView = useCallback((threadId?: string) => {
    setSelectedPath(null)
    setIsGraphOpen(false)
    setIsBrowserOpen(false)
    setIsSuggestedTopicsOpen(false)
    setIsMeetingsOpen(false)
    setIsLiveNotesOpen(false)
    setIsBgTasksOpen(false)
    setIsWorkspaceOpen(false)
    setIsKnowledgeViewOpen(false)
    setIsChatHistoryOpen(false)
    setIsHomeOpen(false); setIsAppsOpen(false)
    setSelectedBackgroundTask(null)
    setExpandedFrom(null)
    setIsRightPaneMaximized(false)
    setIsEmailOpen(true)
    if (threadId) {
      setEmailInitialThreadId(threadId)
      setEmailThreadIdVersion((v) => v + 1)
    }
    ensureEmailFileTab()
  }, [ensureEmailFileTab])

  const openBgTasksView = useCallback(() => {
    setSelectedPath(null)
    setIsGraphOpen(false)
    setIsBrowserOpen(false)
    setIsSuggestedTopicsOpen(false)
    setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
    setSelectedBackgroundTask(null)
    setExpandedFrom(null)
    setIsRightPaneMaximized(false)
    setIsBgTasksOpen(true)
    ensureBgTasksFileTab()
  }, [ensureBgTasksFileTab])

  const openAppsView = useCallback(() => {
    setSelectedPath(null)
    setIsGraphOpen(false)
    setIsBrowserOpen(false)
    setIsSuggestedTopicsOpen(false)
    setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false)
    setSelectedBackgroundTask(null)
    setExpandedFrom(null)
    setIsRightPaneMaximized(false)
    setIsAppsOpen(true)
    ensureAppsFileTab()
  }, [ensureAppsFileTab])

  const openMeetingsView = useCallback(() => {
    setSelectedPath(null)
    setIsGraphOpen(false)
    setIsBrowserOpen(false)
    setIsSuggestedTopicsOpen(false)
    setIsMeetingsOpen(true)
    setIsLiveNotesOpen(false)
    setIsBgTasksOpen(false)
    setIsEmailOpen(false)
    setIsWorkspaceOpen(false)
    setIsKnowledgeViewOpen(false)
    setIsChatHistoryOpen(false)
    setIsHomeOpen(false); setIsAppsOpen(false)
    setSelectedBackgroundTask(null)
    setExpandedFrom(null)
    setIsRightPaneMaximized(false)
    ensureMeetingsFileTab()
  }, [ensureMeetingsFileTab])

  const openCodeView = useCallback(() => {
    setSelectedPath(null)
    setIsGraphOpen(false)
    setIsBrowserOpen(false)
    setIsSuggestedTopicsOpen(false)
    setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
    setSelectedBackgroundTask(null)
    setExpandedFrom(null)
    setIsRightPaneMaximized(false)
    ensureCodeFileTab()
  }, [ensureCodeFileTab])

  const applyViewState = useCallback(async (view: ViewState) => {
    switch (view.type) {
      case 'file':
        setSelectedBackgroundTask(null)
        setIsGraphOpen(false)
        // Navigating to a file dismisses the browser overlay so the file is
        // visible in the middle pane.
        setIsBrowserOpen(false)
        setIsSuggestedTopicsOpen(false)
        setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
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
        setIsBrowserOpen(false)
        setIsSuggestedTopicsOpen(false)
        setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
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
        setIsBrowserOpen(false)
        setIsSuggestedTopicsOpen(false)
        setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
        setExpandedFrom(null)
        setIsRightPaneMaximized(false)
        setSelectedBackgroundTask(view.name)
        return
      case 'suggested-topics':
        setSelectedPath(null)
        setIsGraphOpen(false)
        setIsBrowserOpen(false)
        setExpandedFrom(null)
        setIsRightPaneMaximized(false)
        setSelectedBackgroundTask(null)
        setIsSuggestedTopicsOpen(true)
        setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
        ensureSuggestedTopicsFileTab()
        return
      case 'meetings':
        setSelectedPath(null)
        setIsGraphOpen(false)
        setIsBrowserOpen(false)
        setExpandedFrom(null)
        setIsRightPaneMaximized(false)
        setSelectedBackgroundTask(null)
        setIsSuggestedTopicsOpen(false)
        setIsMeetingsOpen(true)
        setIsLiveNotesOpen(false)
        setIsBgTasksOpen(false)
        setIsEmailOpen(false)
        setIsWorkspaceOpen(false)
        setIsKnowledgeViewOpen(false)
        setIsChatHistoryOpen(false)
      setIsHomeOpen(false); setIsAppsOpen(false)
        ensureMeetingsFileTab()
        return
      case 'live-notes':
        setSelectedPath(null)
        setIsGraphOpen(false)
        setIsBrowserOpen(false)
        setExpandedFrom(null)
        setIsRightPaneMaximized(false)
        setSelectedBackgroundTask(null)
        setIsSuggestedTopicsOpen(false)
        setIsMeetingsOpen(false)
        setIsBgTasksOpen(false)
        setIsEmailOpen(false)
        setIsWorkspaceOpen(false)
        setIsKnowledgeViewOpen(false)
        setIsChatHistoryOpen(false)
      setIsHomeOpen(false); setIsAppsOpen(false)
        setIsLiveNotesOpen(true)
        ensureLiveNotesFileTab()
        return
      case 'email':
        setSelectedPath(null)
        setIsGraphOpen(false)
        setIsBrowserOpen(false)
        setExpandedFrom(null)
        setIsRightPaneMaximized(false)
        setSelectedBackgroundTask(null)
        setIsSuggestedTopicsOpen(false)
        setIsMeetingsOpen(false)
        setIsLiveNotesOpen(false)
        setIsBgTasksOpen(false)
        setIsEmailOpen(true)
        setIsWorkspaceOpen(false)
        setIsKnowledgeViewOpen(false)
        setIsChatHistoryOpen(false)
      setIsHomeOpen(false); setIsAppsOpen(false)
        // Deep links (e.g. a new-email notification) carry the thread to open;
        // bump the version so EmailView re-selects it even if email is already open.
        if (view.threadId) {
          setEmailInitialThreadId(view.threadId)
          setEmailThreadIdVersion((v) => v + 1)
        }
        if (view.searchQuery) {
          setEmailInitialSearchQuery(view.searchQuery)
          setEmailSearchQueryVersion((v) => v + 1)
        }
        ensureEmailFileTab()
        return
      case 'workspace':
        setSelectedPath(null)
        setIsGraphOpen(false)
        setIsBrowserOpen(false)
        setExpandedFrom(null)
        setIsRightPaneMaximized(false)
        setSelectedBackgroundTask(null)
        setIsSuggestedTopicsOpen(false)
        setIsMeetingsOpen(false)
        setIsLiveNotesOpen(false)
        setIsBgTasksOpen(false)
        setIsEmailOpen(false)
        setIsWorkspaceOpen(true)
        setIsKnowledgeViewOpen(false)
        setIsChatHistoryOpen(false)
      setIsHomeOpen(false); setIsAppsOpen(false)
        setWorkspaceInitialPath(view.path ?? null)
        ensureWorkspaceFileTab()
        return
      case 'knowledge-view':
        setSelectedPath(null)
        setIsGraphOpen(false)
        setIsBrowserOpen(false)
        setExpandedFrom(null)
        setIsRightPaneMaximized(false)
        setSelectedBackgroundTask(null)
        setIsSuggestedTopicsOpen(false)
        setIsMeetingsOpen(false)
        setIsLiveNotesOpen(false)
        setIsBgTasksOpen(false)
        setIsEmailOpen(false)
        setIsWorkspaceOpen(false)
        setIsKnowledgeViewOpen(true)
        setKnowledgeViewMode(view.mode ?? (view.folderPath ? 'files' : 'graph'))
        setKnowledgeViewFolderPath(view.folderPath ?? null)
        setIsChatHistoryOpen(false)
      setIsHomeOpen(false); setIsAppsOpen(false)
        ensureKnowledgeViewFileTab()
        return
      case 'chat-history':
        setSelectedPath(null)
        setIsGraphOpen(false)
        setIsBrowserOpen(false)
        setExpandedFrom(null)
        setIsRightPaneMaximized(false)
        setSelectedBackgroundTask(null)
        setIsSuggestedTopicsOpen(false)
        setIsMeetingsOpen(false)
        setIsLiveNotesOpen(false)
        setIsBgTasksOpen(false)
        setIsEmailOpen(false)
        setIsWorkspaceOpen(false)
        setIsKnowledgeViewOpen(false)
        setIsChatHistoryOpen(true); setIsHomeOpen(false); setIsAppsOpen(false)
        ensureChatHistoryFileTab()
        return
      case 'home':
        setSelectedPath(null)
        setIsGraphOpen(false)
        setIsBrowserOpen(false)
        setExpandedFrom(null)
        setIsRightPaneMaximized(false)
        setSelectedBackgroundTask(null)
        setIsSuggestedTopicsOpen(false)
        setIsMeetingsOpen(false)
        setIsLiveNotesOpen(false)
        setIsBgTasksOpen(false)
        setIsEmailOpen(false)
        setIsWorkspaceOpen(false)
        setIsKnowledgeViewOpen(false)
        setIsChatHistoryOpen(false)
        setIsHomeOpen(true); setIsAppsOpen(false)
        ensureHomeFileTab()
        return
      case 'code':
        setSelectedPath(null)
        setIsGraphOpen(false)
        setIsBrowserOpen(false)
        setExpandedFrom(null)
        setIsRightPaneMaximized(false)
        setSelectedBackgroundTask(null)
        setIsSuggestedTopicsOpen(false)
        setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
        ensureCodeFileTab()
        return
      case 'bg-tasks':
        setSelectedPath(null)
        setIsGraphOpen(false)
        setIsBrowserOpen(false)
        setExpandedFrom(null)
        setIsRightPaneMaximized(false)
        setSelectedBackgroundTask(null)
        setIsSuggestedTopicsOpen(false)
        setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
        setIsBgTasksOpen(true)
        ensureBgTasksFileTab()
        return
      case 'apps':
        setSelectedPath(null)
        setIsGraphOpen(false)
        setIsBrowserOpen(false)
        setExpandedFrom(null)
        setIsRightPaneMaximized(false)
        setSelectedBackgroundTask(null)
        setIsSuggestedTopicsOpen(false)
        setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false)
        setIsAppsOpen(true)
        ensureAppsFileTab()
        return
      case 'chat':
        setSelectedPath(null)
        setIsGraphOpen(false)
        setIsBrowserOpen(false)
        setExpandedFrom(null)
        setIsRightPaneMaximized(false)
        setSelectedBackgroundTask(null)
        setIsSuggestedTopicsOpen(false)
        setIsMeetingsOpen(false); setIsLiveNotesOpen(false); setIsBgTasksOpen(false); setIsEmailOpen(false); setIsWorkspaceOpen(false); setIsKnowledgeViewOpen(false); setIsChatHistoryOpen(false); setIsHomeOpen(false); setIsAppsOpen(false)
        if (view.runId) {
          const targetRunId = view.runId
          // Bind the loaded run to a chat tab so its title (derived from
          // tab.runId) updates. Reuse an existing tab for this run if one is
          // open, otherwise rebind the active tab.
          const existingTab = chatTabsRef.current.find((tab) => tab.runId === targetRunId)
          if (existingTab) {
            setActiveChatTabId(existingTab.id)
          } else {
            setChatTabs((prev) => prev.map((tab) => (
              tab.id === activeChatTabIdRef.current ? { ...tab, runId: targetRunId } : tab
            )))
          }
          await loadRun(targetRunId)
        } else {
          handleNewChat()
        }
        return
    }
  }, [ensureEmailFileTab, ensureMeetingsFileTab, ensureLiveNotesFileTab, ensureFileTabForPath, ensureGraphFileTab, ensureSuggestedTopicsFileTab, ensureWorkspaceFileTab, ensureKnowledgeViewFileTab, ensureChatHistoryFileTab, ensureHomeFileTab, ensureCodeFileTab, ensureBgTasksFileTab, ensureAppsFileTab, handleNewChat, isRightPaneMaximized, loadRun])

  const navigateToView = useCallback(async (nextView: ViewState) => {
    const current = currentViewState
    if (viewStatesEqual(current, nextView)) {
      if (isBrowserOpen) {
        dismissBrowserOverlay()
      }
      return
    }

    cancelRecordingIfActive()
    const nextHistory = {
      back: appendUnique(historyRef.current.back, current),
      forward: [] as ViewState[],
    }
    setHistory(nextHistory)
    await applyViewState(nextView)
  }, [appendUnique, applyViewState, cancelRecordingIfActive, currentViewState, setHistory, isBrowserOpen, dismissBrowserOverlay])

  // Move the maximized/full-screen chat into the right side pane: restore the
  // view we expanded from (or fall back to Home) and dock the chat on the right.
  const pushChatToSidePane = useCallback(() => {
    setIsRightPaneMaximized(false)
    setIsChatSidebarOpen(true)
    // Restore the view we expanded from; if there was nothing to restore
    // (e.g. the chat was started fresh from Home), fall back to Home so a
    // single click always docks the chat instead of needing two.
    if (!handleCloseFullScreenChat()) {
      void navigateToView({ type: 'home' })
    }
  }, [handleCloseFullScreenChat, navigateToView])

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

  // Deep-link handler kept in a ref so the useEffect below can register the
  // IPC listener (and run the one-time pending-link drain) just once on mount,
  // rather than re-running on every navigation when navigateToView's identity
  // changes.
  const navigateToViewRef = useRef(navigateToView)
  useEffect(() => { navigateToViewRef.current = navigateToView }, [navigateToView])

  useEffect(() => {
    const handle = (url: string) => {
      const view = parseDeepLink(url)
      if (view) void navigateToViewRef.current(view)
    }
    void window.ipc.invoke('app:consumePendingDeepLink', null).then(({ url }) => {
      if (url) handle(url)
    })
    return window.ipc.on('app:openUrl', ({ url }) => handle(url))
  }, [])

  // Report the UI theme to the apps server (spec §7.1): apps read it from
  // GET /_rowboat/app and get live changes via the SSE theme event.
  useEffect(() => {
    const report = () => {
      const theme = document.documentElement.classList.contains('dark') ? 'dark' as const : 'light' as const
      void window.ipc.invoke('apps:setTheme', { theme }).catch(() => { /* server may be down */ })
    }
    report()
    const observer = new MutationObserver(report)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  // Triggered by main when the user clicks a calendar-meeting notification.
  // Reuses the same flow as the in-app "Join meeting & take notes" button.
  // When `openMeeting` is true, also opens the meeting URL in the system browser.
  useEffect(() => {
    return window.ipc.on('app:takeMeetingNotes', ({ event, openMeeting }) => {
      const e = event as {
        summary?: string
        start?: { dateTime?: string; date?: string; timeZone?: string }
        end?: { dateTime?: string; date?: string; timeZone?: string }
        location?: string
        htmlLink?: string
        hangoutLink?: string
        conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> }
      }
      if (!e || typeof e !== 'object') return
      const conferenceLink = extractConferenceLink(e as Record<string, unknown>)
      if (openMeeting && conferenceLink) {
        window.open(conferenceLink, '_blank')
      } else if (openMeeting) {
        console.warn('[take-meeting-notes] openMeeting requested but event has no conference link', e)
      }
      window.__pendingCalendarEvent = {
        summary: e.summary,
        start: e.start,
        end: e.end,
        location: e.location,
        htmlLink: e.htmlLink,
        conferenceLink,
        source: 'calendar-sync',
      }
      window.dispatchEvent(new Event('calendar-block:join-meeting'))
    })
  }, [])

  const handleBaseConfigChange = useCallback((path: string, config: BaseConfig) => {
    setBaseConfigByPath((prev) => ({ ...prev, [path]: config }))
  }, [])

  const handleBaseSave = useCallback(async (path: string, name: string | null) => {
    const isDefault = path === BASES_DEFAULT_TAB_PATH
    const config = baseConfigByPath[path] ?? DEFAULT_BASE_CONFIG

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
          path,
          data: JSON.stringify(config, null, 2),
        })
      } catch (err) {
        console.error('Failed to save base:', err)
      }
    }
  }, [baseConfigByPath, loadDirectory, navigateToView])

  // External search set by app-navigation tool (passed to BasesView)
  const [externalBaseSearch, setExternalBaseSearch] = useState<string | undefined>(undefined)

  // Apply an app-navigation tool result to the UI. Shared by both event
  // paths (legacy runs:events and the session-chat turn runtime).
  const applyAppNavigation = useCallback((result: Record<string, unknown>) => {
    // During a call, navigation must be VISIBLE: the full-screen call view
    // would cover the very thing being shown — collapse it to the pill —
    // and if the user is in another app, bring Rowboat forward.
    const visibleActions = ['open-note', 'open-view', 'read-view', 'open-item', 'update-base-view', 'create-base']
    if (inCallRef.current && visibleActions.includes(result.action as string)) {
      setCallMinimized(true)
      void window.ipc.invoke('app:focusMainWindow', null).catch(() => {})
    }

    // Views the assistant can open (or auto-open while reading them via
    // read-view — the user should SEE what's being read).
    const navigateToNamedView = (view: string) => {
      switch (view) {
        case 'graph': void navigateToView({ type: 'graph' }); break
        case 'bases': void navigateToView({ type: 'file', path: BASES_DEFAULT_TAB_PATH }); break
        case 'home': void navigateToView({ type: 'home' }); break
        case 'email': void navigateToView({ type: 'email' }); break
        case 'meetings': void navigateToView({ type: 'meetings' }); break
        case 'live-notes': void navigateToView({ type: 'live-notes' }); break
        case 'bg-tasks': void navigateToView({ type: 'bg-tasks' }); break
        case 'chat-history': void navigateToView({ type: 'chat-history' }); break
        case 'knowledge': void navigateToView({ type: 'knowledge-view' }); break
        case 'workspace': void navigateToView({ type: 'workspace' }); break
        case 'code': void navigateToView({ type: 'code' }); break
      }
    }

    switch (result.action) {
      case 'open-note':
        navigateToFile(result.path as string)
        break
      case 'open-view':
      case 'read-view':
        // A read-view email search runs against the whole mailbox, so drive
        // the email view's own search box with the same query — matched
        // threads get real rows even when they're outside the synced inbox
        // (and a follow-up open-item can then select them).
        if (result.action === 'read-view' && result.view === 'email' && typeof result.query === 'string' && result.query.trim()) {
          void navigateToView({ type: 'email', searchQuery: result.query.trim() })
        } else {
          navigateToNamedView(result.view as string)
        }
        break
      case 'open-item': {
        switch (result.kind) {
          case 'email-thread':
            void navigateToView({ type: 'email', threadId: result.threadId as string })
            break
          case 'note':
            navigateToFile(result.path as string)
            break
          case 'bg-task':
            void navigateToView({ type: 'task', name: result.taskName as string })
            break
          case 'session':
            void navigateToView({ type: 'chat', runId: result.sessionId as string })
            break
        }
        break
      }
      case 'open-app':
        if (result.appId) {
          setAppInitialId(result.appId as string)
          setAppIdVersion((v) => v + 1)
          openAppsView()
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigateToFile, navigateToView, selectedPath])

  // Legacy runs:events path: handleRunEvent stashes the result in a ref;
  // polled every render (the triggering event always causes one).
  useEffect(() => {
    const result = pendingAppNavRef.current
    if (!result) return
    pendingAppNavRef.current = null
    applyAppNavigation(result)
  })

  // Turn-runtime path: the session-chat store surfaces tool results in the
  // conversation; apply newly completed app-navigation calls exactly once.
  // On session switch/load, everything already in the transcript happened in
  // the past — seed as processed without replaying navigations.
  const processedAppNavRef = useRef<{ key: string | null; ids: Set<string> }>({ key: null, ids: new Set() })
  useEffect(() => {
    const conversation = sessionChat.chatState?.conversation
    if (!conversation) return
    const completed = conversation.filter(
      (item): item is ToolCall => isToolCall(item) && item.name === 'app-navigation' && item.status === 'completed'
    )
    if (processedAppNavRef.current.key !== runId) {
      processedAppNavRef.current = { key: runId, ids: new Set(completed.map((t) => t.id)) }
      return
    }
    for (const tool of completed) {
      if (processedAppNavRef.current.ids.has(tool.id)) continue
      processedAppNavRef.current.ids.add(tool.id)
      const result = tool.result as Record<string, unknown> | undefined
      if (result && result.success) applyAppNavigation(result)
    }
  }, [sessionChat.chatState?.conversation, runId, applyAppNavigation])

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
  const isFullScreenChat = !selectedPath && !isGraphOpen && !isSuggestedTopicsOpen && !isMeetingsOpen && !isLiveNotesOpen && !isBgTasksOpen && !isAppsOpen && !isEmailOpen && !isWorkspaceOpen && !isKnowledgeViewOpen && !isChatHistoryOpen && !isHomeOpen && !isCodeOpen && !selectedBackgroundTask && !isBrowserOpen
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

  // Keyboard shortcut: Cmd+K / Ctrl+K opens the search palette (search-only).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setIsSearchOpen(true)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Keyboard shortcut: Cmd+N / Ctrl+N opens a new chat tab.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        handleNewChatTab()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleNewChatTab])

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
      const rightPaneAvailable = Boolean((selectedPath || isGraphOpen || isSuggestedTopicsOpen || isMeetingsOpen || isLiveNotesOpen || isBgTasksOpen || isAppsOpen || isEmailOpen || isWorkspaceOpen || isKnowledgeViewOpen || isChatHistoryOpen || isHomeOpen) && isChatSidebarOpen)
      const targetPane: ShortcutPane = rightPaneAvailable
        ? (isRightPaneMaximized ? 'right' : activeShortcutPane)
        : 'left'
      const inFileView = targetPane === 'left' && Boolean(selectedPath || isGraphOpen || isSuggestedTopicsOpen || isMeetingsOpen || isLiveNotesOpen || isBgTasksOpen || isAppsOpen || isEmailOpen || isWorkspaceOpen || isKnowledgeViewOpen || isChatHistoryOpen || isHomeOpen)
      const selectedKnowledgePath = isGraphOpen
        ? GRAPH_TAB_PATH
        : isSuggestedTopicsOpen
          ? SUGGESTED_TOPICS_TAB_PATH
          : isMeetingsOpen
            ? MEETINGS_TAB_PATH
          : isLiveNotesOpen
            ? LIVE_NOTES_TAB_PATH
          : isBgTasksOpen
            ? BG_TASKS_TAB_PATH
          : isAppsOpen
            ? APPS_TAB_PATH
          : isEmailOpen
            ? EMAIL_TAB_PATH
          : isWorkspaceOpen
            ? WORKSPACE_TAB_PATH
          : isKnowledgeViewOpen
            ? KNOWLEDGE_VIEW_TAB_PATH
          : isChatHistoryOpen
            ? CHAT_HISTORY_TAB_PATH
          : isHomeOpen
            ? HOME_TAB_PATH
          : selectedPath
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

      // Ctrl+Tab — next tab, Ctrl+Shift+Tab — previous tab (browser-style).
      // Bound to Ctrl specifically (Cmd+Tab is the OS app switcher on macOS).
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault()
        const direction = e.shiftKey ? -1 : 1
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
  }, [selectedPath, isGraphOpen, isSuggestedTopicsOpen, isMeetingsOpen, isLiveNotesOpen, isBgTasksOpen, isAppsOpen, isEmailOpen, isWorkspaceOpen, isKnowledgeViewOpen, isChatHistoryOpen, isChatSidebarOpen, isRightPaneMaximized, activeShortcutPane, chatTabs, fileTabs, activeChatTabId, activeFileTabId, closeChatTab, closeFileTab, switchChatTab, switchFileTab])

  const toggleExpand = (path: string, kind: 'file' | 'dir') => {
    if (kind === 'file') {
      navigateToFile(path)
      return
    }

    // Top-level knowledge folders open as a bases view with folder filter
    const parts = path.split('/')
    if (parts.length === 2 && parts[0] === 'knowledge') {
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
      if (!selectedPath && !isGraphOpen && !isSuggestedTopicsOpen && !isMeetingsOpen && !isLiveNotesOpen && !isBgTasksOpen && !isAppsOpen && !isEmailOpen && !isWorkspaceOpen && !isKnowledgeViewOpen && !isChatHistoryOpen && !selectedBackgroundTask) {
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

  // Handler for onboarding completion. When the user accepts the tour offer
  // on the final step, hand off to the mascot tour once the modal's exit
  // animation has cleared.
  const handleOnboardingComplete = useCallback(async (opts?: { startTour?: boolean }) => {
    try {
      await window.ipc.invoke('onboarding:markComplete', null)
    } catch (err) {
      console.error('Failed to mark onboarding complete:', err)
    }
    setShowOnboarding(false)
    if (opts?.startTour) {
      window.setTimeout(() => setTourActive(true), 400)
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
        setExpandedPaths(prev => new Set([...prev, parentPath]))
        navigateToFile(fullPath)
      } catch (err) {
        console.error('Failed to create note:', err)
        throw err
      }
    },
    addGoogleDoc: (parentPath: string = 'knowledge') => {
      setGoogleDocPickerTargetFolder(parentPath)
      setGoogleDocPickerOpen(true)
    },
    createFolder: async (parentPath: string = 'knowledge'): Promise<string> => {
      try {
        let index = 1
        let name = 'New folder'
        let fullPath = `${parentPath}/${name}`
        while (index < 1000) {
          const exists = await window.ipc.invoke('workspace:exists', { path: fullPath })
          if (!exists.exists) break
          index += 1
          name = `New folder ${index}`
          fullPath = `${parentPath}/${name}`
        }
        await window.ipc.invoke('workspace:mkdir', {
          path: fullPath,
          recursive: true
        })
        setExpandedPaths(prev => new Set([...prev, parentPath]))
        return fullPath
      } catch (err) {
        console.error('Failed to create folder:', err)
        throw err
      }
    },
    openGraph: () => {
      // From chat-only landing state, open graph directly in full knowledge view.
      if (!selectedPath && !isGraphOpen && !isSuggestedTopicsOpen && !isMeetingsOpen && !isLiveNotesOpen && !isBgTasksOpen && !isAppsOpen && !isEmailOpen && !isWorkspaceOpen && !isKnowledgeViewOpen && !isChatHistoryOpen && !selectedBackgroundTask) {
        setIsChatSidebarOpen(false)
        setIsRightPaneMaximized(false)
      }
      void navigateToView({ type: 'graph' })
    },
    openBases: () => {
      if (!selectedPath && !isGraphOpen && !isSuggestedTopicsOpen && !isMeetingsOpen && !isLiveNotesOpen && !isBgTasksOpen && !isAppsOpen && !isEmailOpen && !isWorkspaceOpen && !isKnowledgeViewOpen && !isChatHistoryOpen && !selectedBackgroundTask) {
        setIsChatSidebarOpen(false)
        setIsRightPaneMaximized(false)
      }
      void navigateToView({ type: 'file', path: BASES_DEFAULT_TAB_PATH })
    },
    openWorkspaceAt: (path?: string) => {
      if (!selectedPath && !isGraphOpen && !isSuggestedTopicsOpen && !isMeetingsOpen && !isLiveNotesOpen && !isBgTasksOpen && !isAppsOpen && !isEmailOpen && !isWorkspaceOpen && !isKnowledgeViewOpen && !isChatHistoryOpen && !selectedBackgroundTask) {
        setIsChatSidebarOpen(false)
        setIsRightPaneMaximized(false)
      }
      void navigateToView({ type: 'workspace', path })
    },
    openKnowledgeView: () => {
      // Open in the middle pane without touching the chat sidebar — leave it
      // open or closed exactly as the user had it (matches Email/Meetings).
      void navigateToView({ type: 'knowledge-view' })
    },
    createWorkspace: async (name: string): Promise<string> => {
      const trimmed = name.trim()
      if (!trimmed) throw new Error('Name is required')
      if (trimmed.includes('/')) throw new Error('Name cannot contain "/"')
      const rootExists = await window.ipc.invoke('workspace:exists', { path: WORKSPACE_ROOT })
      if (!rootExists.exists) {
        await window.ipc.invoke('workspace:mkdir', { path: WORKSPACE_ROOT, recursive: true })
      }
      const target = `${WORKSPACE_ROOT}/${trimmed}`
      const exists = await window.ipc.invoke('workspace:exists', { path: target })
      if (exists.exists) {
        throw new Error(`A workspace named "${trimmed}" already exists`)
      }
      await window.ipc.invoke('workspace:mkdir', { path: target, recursive: true })
      return target
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
    revealInFileManager: (path: string, isDir: boolean) => {
      const channel = isDir ? 'shell:openPath' : 'shell:showItemInFolder'
      void window.ipc.invoke(channel, { path }).catch((err) => {
        console.error('Failed to open in file manager:', err)
      })
    },
    onOpenInNewTab: (path: string) => {
      openFileInNewTab(path)
    },
  }), [tree, selectedPath, isGraphOpen, selectedBackgroundTask, workspaceRoot, navigateToFile, navigateToView, openFileInNewTab, fileTabs, closeFileTab, removeEditorCacheForPath])

  // Drives the mascot product tour through the app's main sections
  const handleTourNavigate = useCallback((target: TourNavTarget) => {
    switch (target) {
      case 'home':
        void navigateToView({ type: 'home' })
        break
      case 'email':
        openEmailView()
        break
      case 'meetings':
        openMeetingsView()
        break
      case 'code':
        openCodeView()
        break
      case 'knowledge':
        knowledgeActions.openKnowledgeView()
        break
      case 'agents':
        openBgTasksView()
        break
      case 'apps':
        openAppsView()
        break
      case 'workspaces':
        knowledgeActions.openWorkspaceAt()
        break
    }
  }, [navigateToView, openEmailView, openMeetingsView, openCodeView, knowledgeActions, openBgTasksView, openAppsView])

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
  const [recordingMeetingSource, setRecordingMeetingSource] = useState<string | null>(null)

  const [checkingPermission, setCheckingPermission] = useState(false)

  const startMeetingNow = useCallback(async () => {
    const calEvent = pendingCalendarEventRef.current
    pendingCalendarEventRef.current = undefined
    setRecordingMeetingSource(calEvent?.source ?? null)
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
      setRecordingMeetingSource(null)

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

  // Meeting prep: create a person note for an unmatched attendee via Copilot.
  useEffect(() => {
    const handler = () => {
      const pending = window.__pendingMeetingPrepCreate
      if (pending) {
        setPresetMessage(pending.prompt)
        setIsChatSidebarOpen(true)
        window.__pendingMeetingPrepCreate = undefined
      }
    }
    window.addEventListener('meeting-prep:create-note', handler)
    return () => window.removeEventListener('meeting-prep:create-note', handler)
  }, [])

  const resolveWikiFilePath = useCallback((wikiPath: string) => {
    const normalized = normalizeWikiPath(wikiPath)
    const { path: basePath } = splitWikiFragment(normalized)
    if (!basePath) return null

    const targetPath = ensureMarkdownExtension(basePath)
    const targetKey = targetPath.toLowerCase()
    const exactMatch = knowledgeFiles.find((filePath) => normalizeWikiPath(filePath).toLowerCase() === targetKey)
    if (exactMatch) return toKnowledgePath(exactMatch)

    if (!basePath.includes('/')) {
      const targetBaseName = targetPath.split('/').pop()?.toLowerCase()
      const basenameMatches = knowledgeFiles.filter((filePath) => {
        const normalizedFile = normalizeWikiPath(filePath)
        return normalizedFile.split('/').pop()?.toLowerCase() === targetBaseName
      })
      if (basenameMatches.length === 1) return toKnowledgePath(basenameMatches[0])
    }

    return toKnowledgePath(basePath)
  }, [knowledgeFiles])

  const ensureWikiFile = useCallback(async (wikiPath: string) => {
    const resolvedPath = resolveWikiFilePath(wikiPath)
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
  }, [resolveWikiFilePath])

  const openWikiLink = useCallback(async (wikiPath: string) => {
    const { path: basePath } = splitWikiFragment(normalizeWikiPath(wikiPath))
    if (!basePath) return
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

  const isBrainGraphOpen = isKnowledgeViewOpen && knowledgeViewMode === 'graph'

  useEffect(() => {
    if (!isGraphOpen && !isBrainGraphOpen) return
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
  }, [isGraphOpen, isBrainGraphOpen, knowledgeFilePaths])

  const renderConversationItem = (
    item: ConversationItem,
    tabId: string,
    options?: { autoPermissionDetail?: { decision: 'allow'; reason: string } },
  ) => {
    if (isChatMessage(item)) {
      if (item.role === 'user') {
        if (item.attachments && item.attachments.length > 0) {
          return (
            <Message key={item.id} from={item.role} data-message-id={item.id}>
              <MessageContent className="group-[.is-user]:bg-transparent group-[.is-user]:px-0 group-[.is-user]:py-0 group-[.is-user]:rounded-none">
                <ChatMessageAttachments attachments={item.attachments} />
              </MessageContent>
              {item.content && (
                <MessageContent>
                  <MessageResponse
                    components={streamdownComponents}
                    remarkPlugins={userMessageRemarkPlugins}
                  >
                    {item.content}
                  </MessageResponse>
                </MessageContent>
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
              <MessageResponse
                components={streamdownComponents}
                remarkPlugins={userMessageRemarkPlugins}
              >
                {message}
              </MessageResponse>
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
      if (item.name === 'code_agent_run') {
        return (
          <CodingRunBlock
            key={item.id}
            item={item}
            open={isToolOpenForTab(tabId, item.id)}
            onOpenChange={(open) => setToolOpenForTab(tabId, item.id, open)}
            onPermissionDecision={(decision) => {
              if (item.pendingCodePermission) {
                handleCodePermissionResponse(item.id, item.pendingCodePermission.requestId, decision)
              }
            }}
          />
        )
      }
      if (item.name === 'spawn-agent') {
        return (
          <SubAgentBlock
            key={item.id}
            item={item}
            open={isToolOpenForTab(tabId, item.id)}
            onOpenChange={(open) => setToolOpenForTab(tabId, item.id, open)}
          />
        )
      }
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
          autoPermissionDetail={options?.autoPermissionDetail}
        >
          <ToolHeader
            title={toolTitle}
            type={`tool-${item.name}`}
            state={toToolState(item.status)}
          />
          <ToolContent>
            {item.streamingOutput ? (
              <AutoScrollPre className="max-h-80 overflow-auto px-4 py-3 font-mono text-xs whitespace-pre-wrap text-foreground/90">
                <TerminalOutput raw={item.streamingOutput} />
              </AutoScrollPre>
            ) : (
              <ToolTabbedContent input={input} output={output} errorText={errorText} />
            )}
          </ToolContent>
        </Tool>
      )
    }

    if (isTurnUsageMessage(item)) {
      return (
        <div key={item.id} className="-mt-6 flex justify-start px-1" data-message-id={item.id}>
          <TokenUsageMenu
            usage={item.usage}
            scope="turn"
            modelCallCount={item.modelCallCount}
            align="start"
          />
        </div>
      )
    }

    if (isErrorMessage(item)) {
      if (matchBillingError(item.message)) {
        return null
      }
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

  // The active chat's view state, backed by the sessions hook (legacy
  // standalone states remain only as the pre-load fallback until stage 7).
  const activeChatTabState = React.useMemo<ChatTabViewState>(() => (
    sessionChat.chatState
      ? { runId, ...sessionChat.chatState }
      : {
          runId,
          sessionUsage: {},
          conversation: sessionLoadErrorItems.length > 0 ? sessionLoadErrorItems : conversation,
          currentAssistantMessage,
          pendingAskHumanRequests,
          allPermissionRequests,
          permissionResponses,
          autoPermissionDecisions,
        }
  ), [
    runId,
    sessionChat.chatState,
    sessionLoadErrorItems,
    conversation,
    currentAssistantMessage,
    pendingAskHumanRequests,
    allPermissionRequests,
    permissionResponses,
    autoPermissionDecisions,
  ])
  const emptyChatTabState = React.useMemo<ChatTabViewState>(() => createEmptyChatTabViewState(), [])
  const getChatTabStateForRender = useCallback((tabId: string): ChatTabViewState => {
    if (tabId === activeChatTabId) return activeChatTabState
    return chatViewStateByTab[tabId] ?? emptyChatTabState
  }, [activeChatTabId, activeChatTabState, chatViewStateByTab, emptyChatTabState])
  const chatTabStatesForRender = React.useMemo(() => ({
    ...chatViewStateByTab,
    [activeChatTabId]: activeChatTabState,
  }), [chatViewStateByTab, activeChatTabId, activeChatTabState])
  const selectedTask = selectedBackgroundTask
    ? backgroundTasks.find(t => t.name === selectedBackgroundTask)
    : null
  const isRightPaneContext = Boolean(selectedPath || isGraphOpen || isSuggestedTopicsOpen || isMeetingsOpen || isLiveNotesOpen || isBgTasksOpen || isAppsOpen || isEmailOpen || isWorkspaceOpen || isKnowledgeViewOpen || isChatHistoryOpen || isHomeOpen || isCodeOpen || isBrowserOpen)
  const isRightPaneOnlyMode = isRightPaneContext && isChatSidebarOpen && isRightPaneMaximized
  const shouldCollapseLeftPane = isRightPaneOnlyMode
  const nonChatPaneStyle = React.useMemo<React.CSSProperties>(() => {
    const style: React.CSSProperties = { maxWidth: insetMaxWidth }
    if (!isRightPaneContext || !isChatSidebarOpen || isRightPaneMaximized) return style
    if (chatPaneSize === 'chat-equal') {
      return { ...style, width: 0, flex: '1 1 0' }
    }
    if (chatPaneSize === 'chat-bigger') {
      return { ...style, width: DEFAULT_CHAT_PANE_WIDTH, flex: '0 0 auto' }
    }
    return style
  }, [chatPaneSize, insetMaxWidth, isChatSidebarOpen, isRightPaneContext, isRightPaneMaximized])
  // Collapsing: pin max-width to the snapshot px (no transition) for one frame so it's
  // binding immediately (no flex jump), then animate to 0. Expanding goes back to 100%
  // — its non-binding range lands at the end of the range, where it isn't visible.
  useLayoutEffect(() => {
    if (!shouldCollapseLeftPane) {
      setInsetAnimateMaxWidth(true)
      setInsetMaxWidth('100%')
      return
    }
    if (insetCollapseFromPx == null) {
      setInsetMaxWidth('0px')
      return
    }
    setInsetAnimateMaxWidth(false)
    setInsetMaxWidth(`${insetCollapseFromPx}px`)
    const id = requestAnimationFrame(() => {
      setInsetAnimateMaxWidth(true)
      setInsetMaxWidth('0px')
    })
    return () => cancelAnimationFrame(id)
  }, [shouldCollapseLeftPane, insetCollapseFromPx])
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
        if (section === 'knowledge' && !selectedPath && !isGraphOpen && !isSuggestedTopicsOpen && !isMeetingsOpen && !isLiveNotesOpen && !isBgTasksOpen && !isAppsOpen && !isEmailOpen && !isWorkspaceOpen && !isKnowledgeViewOpen && !isChatHistoryOpen && !isHomeOpen) {
          void navigateToView({ type: 'file', path: BASES_DEFAULT_TAB_PATH })
        }
      }}>
        <div className="rowboat-shell flex h-svh w-full overflow-hidden">
          {/* Content sidebar with SidebarProvider for collapse functionality */}
          <SidebarProvider
            style={{
              "--sidebar-width": `${DEFAULT_SIDEBAR_WIDTH}px`,
            } as React.CSSProperties}
          >
            <SidebarContentPanel
              tree={tree}
              onSelectFile={toggleExpand}
              knowledgeActions={knowledgeActions}
              bgTaskSummaries={bgTaskSummaries}
              activeNav={
                isHomeOpen ? 'home'
                : isEmailOpen ? 'email'
                : isMeetingsOpen ? 'meetings'
                : isCodeOpen ? 'code'
                : (isKnowledgeViewOpen || isGraphOpen || (selectedPath != null && selectedPath.startsWith('knowledge/'))) ? 'knowledge'
                : isBgTasksOpen ? 'agents'
                : isAppsOpen ? 'apps'
                : isWorkspaceOpen ? 'workspaces'
                : null
              }
              onOpenMeetings={openMeetingsView}
              onOpenCode={openCodeView}
              onOpenBgTasks={() => { setBgTaskInitialSlug(null); setBgTaskSlugVersion((v) => v + 1); openBgTasksView() }}
              onOpenAgent={(slug) => { setBgTaskInitialSlug(slug); setBgTaskSlugVersion((v) => v + 1); openBgTasksView() }}
              onOpenApps={openAppsView}
              recentRuns={runs}
              onOpenRun={(rid) => void navigateToView({ type: 'chat', runId: rid })}
              onOpenChatHistory={() => void navigateToView({ type: 'chat-history' })}
              onOpenEmail={(threadId) => openEmailView(threadId)}
              onOpenHome={() => void navigateToView({ type: 'home' })}
              onNewChat={handleNewChatTab}
              onToggleBrowser={handleToggleBrowser}
              onVoiceNoteCreated={handleVoiceNoteCreated}
              onStartTour={() => setTourActive(true)}
              meetingRecordingState={meetingTranscription.state}
              recordingMeetingSource={recordingMeetingSource}
              onToggleMeetingRecording={() => { void handleToggleMeeting() }}
            />
            <SidebarInset
              className={cn(
                "overflow-hidden! min-h-0 min-w-0",
                isRightPaneContext && isChatPaneInMiddle && "order-3",
                insetAnimateMaxWidth && "transition-[max-width] duration-200 ease-linear",
                shouldCollapseLeftPane && "pointer-events-none select-none"
              )}
              style={nonChatPaneStyle}
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
                {(selectedPath || isGraphOpen || isSuggestedTopicsOpen || isMeetingsOpen || isLiveNotesOpen || isBgTasksOpen || isAppsOpen || isEmailOpen || isWorkspaceOpen || isKnowledgeViewOpen || isChatHistoryOpen || isHomeOpen || isCodeOpen) && fileTabs.length >= 1 ? (
                  <TabBar
                    tabs={fileTabs}
                    activeTabId={activeFileTabId ?? ''}
                    getTabTitle={getFileTabTitle}
                    getTabId={(t) => t.id}
                    onSwitchTab={switchFileTab}
                    onCloseTab={closeFileTab}
                    allowSingleTabClose={fileTabs.length === 1 && (isGraphOpen || isSuggestedTopicsOpen || isMeetingsOpen || isLiveNotesOpen || isBgTasksOpen || isAppsOpen || isEmailOpen || isWorkspaceOpen || isKnowledgeViewOpen || isChatHistoryOpen || isHomeOpen || isCodeOpen || (selectedPath != null && isBaseFilePath(selectedPath)))}
                  />
                ) : isFullScreenChat ? (
                  <ChatHeader
                    activeTitle={(() => {
                      const activeTab = chatTabs.find((t) => t.id === activeChatTabId)
                      return activeTab ? getChatTabTitle(activeTab) : 'New chat'
                    })()}
                    onNewChatTab={handleNewChatTab}
                    recentRuns={runs}
                    activeRunId={runId}
                    sessionUsage={activeChatTabState.sessionUsage}
                    onSelectRun={(rid) => void navigateToView({ type: 'chat', runId: rid })}
                    onOpenChatHistory={() => void navigateToView({ type: 'chat-history' })}
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
                {!isFullScreenChat && !selectedPath && !isGraphOpen && !isSuggestedTopicsOpen && !isMeetingsOpen && !isLiveNotesOpen && !isBgTasksOpen && !isAppsOpen && !isEmailOpen && !isWorkspaceOpen && !isKnowledgeViewOpen && !isChatHistoryOpen && !isCodeOpen && !selectedTask && !isBrowserOpen && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={handleNewChatTab}
                        className="titlebar-no-drag flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors self-center shrink-0"
                        aria-label="New chat"
                      >
                        <Plus className="size-5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">New chat</TooltipContent>
                  </Tooltip>
                )}
                <CaffeinateIndicator />
                {/* Trailing layout control. Always mounted (just toggled invisible
                    when inactive) so its -webkit-app-region:no-drag rect is stable —
                    a freshly-mounted no-drag button inside the drag-region header
                    otherwise has its first click swallowed by the window drag. */}
                {(() => {
                  const viewOpen = selectedPath || isGraphOpen || isSuggestedTopicsOpen || isMeetingsOpen || isLiveNotesOpen || isBgTasksOpen || isAppsOpen || isEmailOpen || isWorkspaceOpen || isKnowledgeViewOpen || isChatHistoryOpen || isHomeOpen
                  const action = isFullScreenChat
                    ? { onClick: pushChatToSidePane, icon: <ArrowRight className="size-5" />, label: 'Dock chat to side pane' }
                    : (viewOpen && !isChatSidebarOpen)
                      ? { onClick: openChatSidePane, icon: <MessageSquare className="size-5" />, label: 'Open chat' }
                      : (viewOpen && isChatSidebarOpen && !isRightPaneMaximized)
                        ? {
                            onClick: () => setIsChatSidebarOpen(false),
                            icon: isChatPaneInMiddle ? <ArrowLeft className="size-5" /> : <ArrowRight className="size-5" />,
                            label: 'Expand pane'
                          }
                        : null
                  return (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={action ? action.onClick : undefined}
                          disabled={!action}
                          aria-hidden={!action}
                          aria-label={action?.label}
                          className={cn(
                            'titlebar-no-drag flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors -mr-1 self-center shrink-0',
                            action ? 'hover:bg-accent hover:text-foreground' : 'invisible pointer-events-none',
                          )}
                        >
                          {action?.icon}
                        </button>
                      </TooltipTrigger>
                      {action && <TooltipContent side="bottom">{action.label}</TooltipContent>}
                    </Tooltip>
                  )
                })()}
              </ContentHeader>

              {isBrowserOpen ? (
                <BrowserPane
                  onClose={handleCloseBrowser}
                  forceHidden={isSearchOpen || showMeetingPermissions}
                />
              ) : isHomeOpen ? (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <HomeView
                    tree={tree}
                    runs={runs}
                    bgTaskSummaries={bgTaskSummaries}
                    onOpenEmail={() => openEmailView()}
                    onOpenMeetings={openMeetingsView}
                    onOpenAgents={() => { setBgTaskInitialSlug(null); setBgTaskSlugVersion((v) => v + 1); openBgTasksView() }}
                    onOpenAgent={(slug) => { setBgTaskInitialSlug(slug); setBgTaskSlugVersion((v) => v + 1); openBgTasksView() }}
                    onOpenNote={(path) => navigateToFile(path)}
                    onOpenRun={(rid) => void navigateToView({ type: 'chat', runId: rid })}
                    onTakeMeetingNotes={() => { void handleToggleMeeting() }}
                    onOpenChat={handleNewChatTab}
                  />
                </div>
              ) : isSuggestedTopicsOpen ? (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <SuggestedTopicsView
                    onExploreTopic={(topic) => {
                      const prompt = buildSuggestedTopicExplorePrompt(topic)
                      submitFromPalette(prompt, null)
                    }}
                  />
                </div>
              ) : isMeetingsOpen ? (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <MeetingsView
                    onOpenNote={(path) => navigateToFile(path)}
                    onTakeMeetingNotes={() => { void handleToggleMeeting() }}
                    meetingState={meetingTranscription.state}
                    meetingSummarizing={meetingSummarizing}
                  />
                </div>
              ) : isCodeOpen ? (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <CodeView
                    onSessionSelected={handleCodeSessionSelected}
                    openDiffPath={codeDiffPath}
                    onDiffOpened={() => setCodeDiffPath(null)}
                  />
                </div>
              ) : isLiveNotesOpen ? (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <LiveNotesView
                    onOpenNote={(path) => navigateToFile(path)}
                    onAddNewLiveNote={() => {
                      submitFromPalette(buildLiveNoteSetupPrompt(), null)
                    }}
                  />
                </div>
              ) : isBgTasksOpen ? (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <BgTasksView
                    initialSlug={bgTaskInitialSlug}
                    slugVersion={bgTaskSlugVersion}
                    onCreateWithCopilot={(description) => {
                      submitFromPalette(buildBgTaskSetupPrompt(description), null)
                    }}
                    onEditWithCopilot={(slug) => {
                      submitFromPalette(buildBgTaskEditPrompt(slug), null)
                    }}
                  />
                </div>
              ) : isAppsOpen ? (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <AppsView
                    initialAppFolder={appInitialId}
                    initialVersion={appIdVersion}
                    onNewApp={() => prefillChat('Build me an app that ')}
                  />
                </div>
              ) : isEmailOpen ? (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <EmailView initialThreadId={emailInitialThreadId} threadIdVersion={emailThreadIdVersion} initialSearchQuery={emailInitialSearchQuery} searchQueryVersion={emailSearchQueryVersion} />
                </div>
              ) : isWorkspaceOpen ? (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <WorkspaceView
                    tree={tree}
                    initialPath={workspaceInitialPath}
                    actions={{
                      remove: knowledgeActions.remove,
                      copyPath: knowledgeActions.copyPath,
                      revealInFileManager: knowledgeActions.revealInFileManager,
                      createNote: knowledgeActions.createNote,
                      addGoogleDoc: knowledgeActions.addGoogleDoc,
                      createFolder: knowledgeActions.createFolder,
                      onOpenInNewTab: knowledgeActions.onOpenInNewTab,
                    }}
                    onNavigate={(path) => { void navigateToView({ type: 'workspace', path: path === WORKSPACE_ROOT ? undefined : path }) }}
                    onOpenNote={(path) => navigateToFile(path)}
                    onCreateWorkspace={async (name) => { await knowledgeActions.createWorkspace(name) }}
                    onOpenRun={(rid) => void navigateToView({ type: 'chat', runId: rid })}
                  />
                </div>
              ) : isKnowledgeViewOpen ? (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <KnowledgeView
                    tree={tree}
                    actions={{
                      createNote: knowledgeActions.createNote,
                      addGoogleDoc: knowledgeActions.addGoogleDoc,
                      createFolder: knowledgeActions.createFolder,
                      rename: knowledgeActions.rename,
                      remove: knowledgeActions.remove,
                      copyPath: knowledgeActions.copyPath,
                      revealInFileManager: knowledgeActions.revealInFileManager,
                      onOpenInNewTab: knowledgeActions.onOpenInNewTab,
                    }}
                    mode={knowledgeViewMode}
                    onModeChange={setKnowledgeViewMode}
                    graphContent={(
                      <GraphView
                        nodes={graphData.nodes}
                        edges={graphData.edges}
                        isLoading={false}
                        error={graphStatus === 'error' ? (graphError ?? 'Failed to build graph') : null}
                        onSelectNode={(path) => {
                          navigateToFile(path)
                        }}
                      />
                    )}
                    basisContent={(
                      <BasesView
                        tree={tree}
                        onSelectNote={(path) => navigateToFile(path)}
                        config={baseConfigByPath[BASES_DEFAULT_TAB_PATH] ?? DEFAULT_BASE_CONFIG}
                        onConfigChange={(cfg) => handleBaseConfigChange(BASES_DEFAULT_TAB_PATH, cfg)}
                        isDefaultBase
                        onSave={(name) => void handleBaseSave(BASES_DEFAULT_TAB_PATH, name)}
                        externalSearch={externalBaseSearch}
                        onExternalSearchConsumed={() => setExternalBaseSearch(undefined)}
                        actions={{
                          rename: knowledgeActions.rename,
                          remove: knowledgeActions.remove,
                          copyPath: knowledgeActions.copyPath,
                          revealInFileManager: knowledgeActions.revealInFileManager,
                        }}
                      />
                    )}
                    folderPath={knowledgeViewFolderPath}
                    onNavigateFolder={(path) => {
                      setKnowledgeViewMode('files')
                      void navigateToView({ type: 'knowledge-view', folderPath: path ?? undefined, mode: 'files' })
                    }}
                    onOpenNote={(path) => navigateToFile(path)}
                    onOpenSearch={() => { setSearchDefaultScope('knowledge'); setIsSearchOpen(true) }}
                    onVoiceNoteCreated={handleVoiceNoteCreated}
                  />
                </div>
              ) : isChatHistoryOpen ? (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <ChatHistoryView
                    runs={runs}
                    currentRunId={runId}
                    processingRunIds={processingRunIds}
                    onSelectRun={(rid) => void navigateToView({ type: 'chat', runId: rid })}
                    onDeleteRun={async (rid) => {
                      try {
                        await window.ipc.invoke('sessions:delete', { sessionId: rid })
                        await loadRuns()
                      } catch (err) {
                        console.error('Failed to delete run:', err)
                      }
                    }}
                    onNewChat={handleNewChatTab}
                    onOpenSearch={() => setIsSearchOpen(true)}
                  />
                </div>
              ) : selectedPath && isBaseFilePath(selectedPath) ? (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <BasesView
                    tree={tree}
                    onSelectNote={(path) => navigateToFile(path)}
                    config={baseConfigByPath[selectedPath] ?? DEFAULT_BASE_CONFIG}
                    onConfigChange={(cfg) => handleBaseConfigChange(selectedPath, cfg)}
                    isDefaultBase={selectedPath === BASES_DEFAULT_TAB_PATH}
                    onSave={(name) => void handleBaseSave(selectedPath, name)}
                    externalSearch={externalBaseSearch}
                    onExternalSearchConsumed={() => setExternalBaseSearch(undefined)}
                    actions={{
                      rename: knowledgeActions.rename,
                      remove: knowledgeActions.remove,
                      copyPath: knowledgeActions.copyPath,
                      revealInFileManager: knowledgeActions.revealInFileManager,
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
                <>
                {/* Always-mounted persistent cache for HTML/PDF — hidden when active file is something else, so iframes preserve scroll/page/zoom across switches. */}
                <div
                  className="flex-1 min-h-0 overflow-hidden"
                  style={{ display: isCacheableViewerPath(selectedPath) ? 'block' : 'none' }}
                >
                  <PersistentViewerCache activePath={selectedPath} />
                </div>
                {!isCacheableViewerPath(selectedPath) && (
                selectedPath.endsWith('.md') ? (
                  <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
                    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                      {openMarkdownTabs.map((tab) => {
                        const isActive = activeFileTabId
                          ? tab.id === activeFileTabId || tab.path === selectedPath
                          : tab.path === selectedPath
                        const isViewingHistory = viewingHistoricalVersion && isActive && versionHistoryPath === tab.path
                        const tabFrontmatter = frontmatterByPathRef.current.get(tab.path) ?? null
                        const linkedGoogleDoc = parseLinkedGoogleDocFrontmatter(tabFrontmatter)
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
                              frontmatter={tabFrontmatter}
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
                              googleDoc={linkedGoogleDoc && !isViewingHistory ? {
                                title: linkedGoogleDoc.title,
                                isSyncing: isActive ? googleDocSyncDirection : null,
                                lastSyncedAt: linkedGoogleDoc.syncedAt,
                                onOpen: () => {
                                  if (linkedGoogleDoc.url) {
                                    window.open(linkedGoogleDoc.url, '_blank')
                                  }
                                },
                                onSyncDown: () => { void syncGoogleDocDown(tab.path) },
                                onSyncUp: () => { void syncGoogleDocUp(tab.path) },
                              } : undefined}
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
                    <LiveNoteSidebar
                      filePath={liveNotePanelPath}
                      onClose={() => setLiveNotePanelPath(null)}
                    />
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
                ) : selectedPath && getViewerType(selectedPath) === 'image' ? (
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <ImageFileViewer path={selectedPath} />
                  </div>
                ) : selectedPath && getViewerType(selectedPath) === 'video' ? (
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <VideoFileViewer path={selectedPath} />
                  </div>
                ) : selectedPath && getViewerType(selectedPath) === 'audio' ? (
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <AudioFileViewer path={selectedPath} />
                  </div>
                ) : selectedPath && getViewerType(selectedPath) === 'docx' ? (
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <DocxFileViewer path={selectedPath} />
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <UnsupportedFileViewer path={selectedPath} />
                  </div>
                )
                )}
                </>
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
                              <ChatEmptyState
                                wide
                                onPickPrompt={setPresetMessage}
                              />
                            ) : (
                              <>
                                {groupConversationItems(
                                  tabState.conversation,
                                  (id) => !!tabState.allPermissionRequests.get(id) || !!tabState.autoPermissionDecisions.get(id)
                                ).map(item => {
                                  if (isToolGroup(item)) {
                                    return (
                                      <ToolGroupComponent
                                        key={item.groupId}
                                        group={item}
                                        isToolOpen={(toolId) => isToolOpenForTab(tab.id, toolId)}
                                        onToolOpenChange={(toolId, open) => setToolOpenForTab(tab.id, toolId, open)}
                                      />
                                    )
                                  }
                                  const autoDecision = isToolCall(item)
                                    ? tabState.autoPermissionDecisions.get(item.id)
                                    : undefined
                                  const rendered = renderConversationItem(
                                    item,
                                    tab.id,
                                    autoDecision?.decision === 'allow'
                                      ? { autoPermissionDetail: { decision: 'allow', reason: autoDecision.reason } }
                                      : undefined,
                                  )
                                  if (isToolCall(item)) {
                                    const deniedAutoDecision = autoDecision?.decision === 'deny' ? autoDecision : null
                                    const permRequest = tabState.allPermissionRequests.get(item.id)
                                    if (deniedAutoDecision || permRequest) {
                                      const response = tabState.permissionResponses.get(item.id) || null
                                      return (
                                        <React.Fragment key={item.id}>
                                          {deniedAutoDecision && (
                                            <AutoPermissionDecision
                                              toolCall={deniedAutoDecision.toolCall}
                                              permission={deniedAutoDecision.permission}
                                              decision={deniedAutoDecision.decision}
                                              reason={deniedAutoDecision.reason}
                                            />
                                          )}
                                          {permRequest && (
                                            <PermissionRequest
                                              toolCall={permRequest.toolCall}
                                              permission={permRequest.permission}
                                              onApprove={() => handlePermissionResponse(permRequest.toolCall.toolCallId, permRequest.subflow, 'approve')}
                                              onApproveSession={() => handlePermissionResponse(permRequest.toolCall.toolCallId, permRequest.subflow, 'approve', 'session')}
                                              onApproveAlways={() => handlePermissionResponse(permRequest.toolCall.toolCallId, permRequest.subflow, 'approve', 'always')}
                                              onDeny={() => handlePermissionResponse(permRequest.toolCall.toolCallId, permRequest.subflow, 'deny')}
                                              isProcessing={isActive && activeIsWorking}
                                              response={response}
                                            />
                                          )}
                                          {rendered}
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
                                    options={request.options}
                                    onResponse={(response) => handleAskHumanResponse(request.toolCallId, request.subflow, response)}
                                    isProcessing={isActive && activeIsWorking}
                                  />
                                ))}

                                {tabState.currentAssistantMessage && (
                                  <Message from="assistant">
                                    <MessageContent>
                                      <SmoothStreamingMessage text={tabState.currentAssistantMessage.replace(/<\/?voice>/g, '')} components={streamdownComponents} />
                                    </MessageContent>
                                  </Message>
                                )}

                                {isActive && activeIsProcessing && (
                                  <Message from="assistant">
                                    <MessageContent>
                                      <TurnActivityIndicator isReasoning={activeIsReasoning} />
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

                <div className="rowboat-composer-dock sticky bottom-0 z-10 bg-background pb-12 pt-0 shadow-lg">
                  <div className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-linear-to-t from-background to-transparent" />
                  <div className="mx-auto w-full max-w-4xl px-4">
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
                            isProcessing={isActive && activeIsProcessing}
                            isStopping={isActive && isStopping}
                            isActive={isActive}
                            presetMessage={isActive ? presetMessage : undefined}
                            onPresetMessageConsumed={isActive ? () => setPresetMessage(undefined) : undefined}
                            runId={tabState.runId}
                            codeSessionLock={tabState.runId ? codeSessionLocks[tabState.runId] ?? null : null}
                            initialDraft={chatDraftsRef.current.get(tab.id)}
                            onDraftChange={(text) => setChatDraftForTab(tab.id, text)}
                            onSelectedModelChange={(m) => {
                              if (m) {
                                selectedModelByTabRef.current.set(tab.id, m)
                              } else {
                                selectedModelByTabRef.current.delete(tab.id)
                              }
                            }}
                            workDir={workDirByTab[tab.id] ?? null}
                            onWorkDirChange={(v) => setTabWorkDir(tab.id, v)}
                            isRecording={isActive && isRecording}
                            recordingText={isActive ? voice.interimText : undefined}
                            recordingState={isActive ? (voice.state === 'submitting' ? 'stopping' : voice.state === 'connecting' ? 'connecting' : 'listening') : undefined}
                            audioLevelsRef={voice.audioLevelsRef}
                            onStartRecording={isActive ? handleStartRecording : undefined}
                            onSubmitRecording={isActive ? handleSubmitRecording : undefined}
                            onCancelRecording={isActive ? handleCancelRecording : undefined}
                            voiceAvailable={isActive && voiceAvailable}
                            inCall={inCall}
                            onStartCall={isActive ? startCall : undefined}
                            onEndCall={isActive ? endCall : undefined}
                            callAvailable={voiceAvailable && ttsAvailable}
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

            {/* Chat pane - shown when viewing files/graph. For a direct-mode
                code session it swaps to the direct-drive chat; rowboat-mode
                sessions use the regular assistant chat bound to their run. */}
            {isRightPaneContext && isCodeOpen && activeCodeSession?.session.mode === 'direct' ? (
              <ResizableRightPane
                defaultWidth={DEFAULT_CHAT_PANE_WIDTH}
                onActivate={() => setActiveShortcutPane('right')}
              >
                <CodeChat
                  key={activeCodeSession.session.id}
                  session={activeCodeSession.session}
                  status={activeCodeSession.status}
                  onOpenDiff={setCodeDiffPath}
                  voiceAvailable={voiceAvailable}
                />
              </ResizableRightPane>
            ) : isRightPaneContext && (
              <ChatSidebar
                placement={chatPanePlacement}
                paneSize={chatPaneSize}
                className={isChatPaneInMiddle ? "order-2" : undefined}
                defaultWidth={DEFAULT_CHAT_PANE_WIDTH}
                isOpen={isChatSidebarOpen}
                isMaximized={isRightPaneMaximized}
                chatTabs={chatTabs}
                activeChatTabId={activeChatTabId}
                getChatTabTitle={getChatTabTitle}
                onNewChatTab={handleNewChatTabInSidebar}
                recentRuns={runs}
                onSelectRun={(rid) => {
                  const existingTab = chatTabs.find((t) => t.runId === rid)
                  if (existingTab) {
                    switchChatTab(existingTab.id)
                    return
                  }
                  setChatTabs((prev) => prev.map((t) => (t.id === activeChatTabId ? { ...t, runId: rid } : t)))
                  loadRun(rid)
                }}
                onOpenChatHistory={() => void navigateToView({ type: 'chat-history' })}
                onOpenFullScreen={toggleRightPaneMaximize}
                conversation={activeChatTabState.conversation}
                currentAssistantMessage={activeChatTabState.currentAssistantMessage}
                sessionUsage={activeChatTabState.sessionUsage}
                chatTabStates={chatTabStatesForRender}
                viewportAnchors={chatViewportAnchorByTab}
                isProcessing={activeIsProcessing}
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
                onSelectedModelChangeForTab={(tabId, m) => {
                  if (m) {
                    selectedModelByTabRef.current.set(tabId, m)
                  } else {
                    selectedModelByTabRef.current.delete(tabId)
                  }
                }}
                workDirByTab={workDirByTab}
                onWorkDirChangeForTab={setTabWorkDir}
                codeSessionLocks={codeSessionLocks}
                pinnedToCodeSession={
                  isCodeOpen
                    && activeCodeSession?.session.mode === 'rowboat'
                    // Only while the pane is actually bound to the session — a
                    // palette-initiated fresh chat, for example, unbinds it.
                    && chatTabs.find((t) => t.id === activeChatTabId)?.runId === activeCodeSession.session.id
                    ? { title: activeCodeSession.session.title }
                    : null
                }
                pendingAskHumanRequests={activeChatTabState.pendingAskHumanRequests}
                allPermissionRequests={activeChatTabState.allPermissionRequests}
                permissionResponses={activeChatTabState.permissionResponses}
                autoPermissionDecisions={activeChatTabState.autoPermissionDecisions}
                isReasoning={activeIsReasoning}
                isWaitingOnHuman={activeIsWaitingOnHuman}
                onPermissionResponse={handlePermissionResponse}
                onAskHumanResponse={handleAskHumanResponse}
                isToolOpenForTab={isToolOpenForTab}
                onToolOpenChangeForTab={setToolOpenForTab}
                onOpenKnowledgeFile={(path) => { navigateToFile(path) }}
                onActivate={() => setActiveShortcutPane('right')}
                collapsedLeftPaddingPx={collapsedLeftPaddingPx}
                isRecording={isRecording}
                recordingText={voice.interimText}
                recordingState={voice.state === 'submitting' ? 'stopping' : voice.state === 'connecting' ? 'connecting' : 'listening'}
                audioLevelsRef={voice.audioLevelsRef}
                onStartRecording={handleStartRecording}
                onSubmitRecording={handleSubmitRecording}
                onCancelRecording={handleCancelRecording}
                voiceAvailable={voiceAvailable}
                inCall={inCall}
                onStartCall={startCall}
                onEndCall={endCall}
                callAvailable={voiceAvailable && ttsAvailable}
                onComposioConnected={handleComposioConnected}
              />
            )}
            {/* Full-screen call: user tile + animated mascot tile. Shown only
                when the derived surface says so (camera on, no screen share,
                not minimized) — otherwise the call lives in the floating
                popout window. */}
            {callSurface === 'fullscreen' && (
              <VideoCallView
                streamRef={video.streamRef}
                onToggleScreenShare={handleToggleScreenShare}
                cameraOn={video.cameraOn}
                onToggleCamera={handleToggleCamera}
                micMuted={micMuted}
                onToggleMic={handleToggleMic}
                practiceMode={practiceMode}
                onMinimize={() => void handleMinimizeCall()}
                onInterrupt={handleInterruptAssistant}
                ttsState={tts.state}
                getTtsLevel={tts.getLevel}
                status={videoCallStatus ?? 'listening'}
                interimText={voice.interimText}
                assistantCaption={assistantCaption}
                onLeave={endCall}
              />
            )}
            {/* Mascot-guided product tour */}
            {tourActive && (
              <ProductTour
                onClose={() => setTourActive(false)}
                onNavigate={handleTourNavigate}
                ttsAvailable={ttsAvailable}
                ttsState={tts.state}
                speak={tts.speak}
                speakUrl={tts.speakUrl}
                cancelSpeech={tts.cancel}
                getLevel={tts.getLevel}
              />
            )}
            {/* Rendered last so its no-drag region paints over the sidebar drag region */}
            <FixedSidebarToggle
              leftInsetPx={isMac ? MACOS_TRAFFIC_LIGHTS_RESERVED_PX : 0}
            />
          </SidebarProvider>
        </div>
        <CommandPalette
          open={isSearchOpen}
          onOpenChange={(o) => { setIsSearchOpen(o); if (!o) setSearchDefaultScope(undefined) }}
          defaultScope={searchDefaultScope}
          onSelectFile={navigateToFile}
          onSelectRun={(id) => { void navigateToView({ type: 'chat', runId: id }) }}
        />
      </SidebarSectionProvider>
      <Toaster />
      <BillingErrorDialog
        open={billingErrorOpen}
        match={billingErrorMatch}
        onOpenChange={setBillingErrorOpen}
      />
      <OnboardingModal
        open={showOnboarding}
        onComplete={handleOnboardingComplete}
      />
      <ComposioGoogleMigrationModal
        open={showComposioGoogleMigration}
        onOpenChange={setShowComposioGoogleMigration}
        onReconnect={() => {
          // Trigger the rowboat-mode Google connect flow. With no credentials
          // and the user signed in to Rowboat, the main process opens the
          // webapp `/oauth/google/start` URL. The deep link returns and
          // completeRowboatGoogleConnect persists the tokens.
          void window.ipc.invoke('oauth:connect', { provider: 'google' })
        }}
      />
      <GoogleDocPickerDialog
        open={googleDocPickerOpen}
        targetFolder={googleDocPickerTargetFolder}
        onOpenChange={setGoogleDocPickerOpen}
        onImported={(path) => {
          const parentPath = path.split('/').slice(0, -1).join('/') || 'knowledge'
          setExpandedPaths(prev => new Set([...prev, parentPath]))
          void loadDirectory().then(setTree)
          navigateToFile(path)
        }}
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
