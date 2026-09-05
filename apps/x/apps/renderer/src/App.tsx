import * as React from 'react'
import { Activity, useCallback, useEffect, useLayoutEffect, useMemo, useState, useRef } from 'react'
import { workspace, quickAskShortcut, pttKey } from '@x/shared';
import { RunEvent } from '@x/shared/src/runs.js';
import type { ToolUIPart } from 'ai';
import './App.css'
import z from 'zod';
import { CheckIcon, LoaderIcon, PanelLeftIcon, ArrowLeft, ArrowRight, MessageSquare, ChevronLeftIcon, ChevronRightIcon, Plus, HistoryIcon, SquarePen } from 'lucide-react';
import { cn, compactPath, parentPath } from '@/lib/utils';
import { SPACES_ENABLED } from '@/lib/feature-flags';
import { MarkdownEditor, type MarkdownEditorHandle } from './components/markdown-editor';
import { ChatSidebar } from './components/chat-sidebar';
import { useSessionChat } from '@/hooks/useSessionChat';
import { subscribeSessionFeed } from '@/lib/session-chat/feed';
import { ChatHeader } from './components/chat-header';
import { ChatSessionPane, ChatSessionComposer, queuedMessageText } from './components/chat-session';
// Value import: the Home to-do surface mounts a standalone composer directly
// (not tab-bound); chat tabs render theirs through ChatSessionComposer.
import { ChatInputWithMentions, type CallPreset, type PermissionMode, type StagedAttachment, type ModelSelection } from './components/chat-input-with-mentions';
import { GraphView, type GraphEdge, type GraphNode } from '@/components/graph-view';
import { BasesView, type BaseConfig, DEFAULT_BASE_CONFIG } from '@/components/bases-view';
import { ImageFileViewer } from '@/components/image-file-viewer';
import { VideoFileViewer } from '@/components/video-file-viewer';
import { AudioFileViewer } from '@/components/audio-file-viewer';
import { DocxFileViewer } from '@/components/docx-file-viewer';
import { SpreadsheetFileViewer } from '@/components/spreadsheet-file-viewer';
import { PptxEditor } from '@/components/pptx-editor';
import { PersistentViewerCache } from '@/components/persistent-viewer-cache';
import { UnsupportedFileViewer } from '@/components/unsupported-file-viewer';
import { getViewerType, isCacheableViewerPath } from '@/lib/file-types';
import {
  readFileAfterExternalChangesSettle,
  reloadCleanActiveMarkdownAfterExternalChange,
} from '@/lib/active-markdown-external-change';
import { useDebounce } from './hooks/use-debounce';
import { DockSidebar, DOCK_GUTTER_PX, LAST_SPACE_STORAGE_KEY } from '@/components/dock-sidebar';
import { SidebarContentPanel } from '@/components/sidebar-content';
import { SuggestedTopicsView } from '@/components/suggested-topics-view';
import { LiveNotesView } from '@/components/live-notes-view';
import { BgTasksView } from '@/components/bg-tasks-view';
import { AppsView } from '@/components/apps/apps-view';
import { SpacesView, type SpaceSelection } from '@/components/spaces-view';
import { railKey, type RailSelection } from '@/lib/spaces-selection';
import { useSpacesOrgs } from '@/hooks/use-spaces';
import { EmailView } from '@/components/email-view';
import { WorkspaceView } from '@/components/workspace-view';
import { KnowledgeView, type KnowledgeViewMode } from '@/components/knowledge-view';
import { GoogleDocPickerDialog } from '@/components/google-doc-picker-dialog';
import { NewPresentationDialog } from '@/components/new-presentation-dialog';
import { ChatHistoryView } from '@/components/chat-history-view';
import { TodoView } from '@/components/todo-view';
import { MeetingsView } from '@/components/meetings-view';
import { CodeView, type ActiveCodeSession } from '@/components/code/code-view';
import { CodeWorkspaceDrawer } from '@/components/code/workspace-drawer';
import type { CodePanel } from '@/components/code/code-panels';
import { useCodeGitStatus } from '@/components/code/use-code-git-status';
import { refreshCodeSessions } from '@/components/code/use-code-sessions';
import { CodeDiffOpenerProvider } from '@/contexts/code-diff-context';
import { SidebarSectionProvider } from '@/contexts/sidebar-context';
import {
  type PromptInputMessage,
  type FileMention,
} from '@/components/ai-elements/prompt-input';

import { ToolPermissionAutoDecisionEvent, ToolPermissionRequestEvent, AskHumanRequestEvent } from '@x/shared/src/runs.js';
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { SettingsDialog } from "@/components/settings-dialog"
import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/sonner"
import { UpdateCard } from "@/components/update-card"
import { BillingErrorDialog } from "@/components/billing-error-dialog"
import { CreditCelebration } from "@/components/credit-celebration"
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
import { type ChatTab } from '@/components/tab-bar'
import { CaffeinateToggle } from '@/components/caffeinate-toggle'
import {
  type ChatMessage,
  type ChatViewportAnchorState,
  type ChatTabViewState,
  type ConversationItem,
  type ToolCall,
  createEmptyChatTabViewState,
  getToolDisplayName,
  inferRunTitleFromMessage,
  isChatMessage,
  isErrorMessage,
  isToolCall,
  normalizeToolInput,
} from '@/lib/chat-conversation'
import { COMPOSIO_DISPLAY_NAMES as composioDisplayNames } from '@x/shared/src/composio.js'
import { COMMAND_CENTER_CHAT_SENTINEL } from '@x/shared/src/home-threads.js'
import { AgentScheduleConfig } from '@x/shared/dist/agent-schedule.js'
import { AgentScheduleState } from '@x/shared/dist/agent-schedule-state.js'
import { toast } from "sonner"
import { useVoiceMode } from '@/hooks/useVoiceMode'
import { CALL_VOICE_HOLDER, acquireVoice, releaseVoice, useVoiceOwner, voiceOwnerId } from '@/lib/voice-ownership'
import { useVideoMode } from '@/hooks/useVideoMode'
import { useVoiceTTS } from '@/hooks/useVoiceTTS'
import { VideoCallView } from '@/components/video-call-view'
import { PermissionDialog, type PermissionKind } from '@/components/permission-dialog'
import { ProductTour, type TourNavTarget } from '@/components/product-tour'
import { useMeetingTranscription, type CalendarEventMeta } from '@/hooks/useMeetingTranscription'
import { useAnalyticsIdentity } from '@/hooks/useAnalyticsIdentity'
import * as analytics from '@/lib/analytics'
import { playAckCue, playAlertCue, playPopCue } from '@/lib/call-sounds'
import { useTheme } from '@/contexts/theme-context'
import { isMac } from '@/lib/shortcut'

type DirEntry = z.infer<typeof workspace.DirEntry>
type RunEventType = z.infer<typeof RunEvent>

interface TreeNode extends DirEntry {
  children?: TreeNode[]
  loaded?: boolean
}

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

// Push-to-talk gesture timing: a talk-key press shorter than PTT_TAP_MS is
// a tap (toggles hands-free lock); anything longer is a hold (release
// submits). PTT_EDGE_ECHO_MS collapses the same key edge arriving from two
// sources at once (global uiohook hook + in-window DOM listener).
// The key is right ⌘ on macOS, right Ctrl elsewhere — shared/ptt-key.ts.
const PTT_TAP_MS = 350
const PTT_CODE = pttKey.pttEventCode(isMac)
const PTT_KEY_LABEL = pttKey.pttKeyLabel(isMac)
// Mic-ownership token for the Home composer (chat composers use their chatId).
const HOME_VOICE_HOLDER = 'home-composer'
const PTT_EDGE_ECHO_MS = 80
// How long a hover summon waits for the voice/TTS probe to settle before
// deciding voice isn't configured. Long enough for a cold boot (config read
// + oauth state), short enough that a hung probe still gets the user a
// surface (the text card) instead of silence.
const VOICE_PROBE_WAIT_MS = 4000

// Speakable fallback for a call reply that skipped <voice> tags: strip the
// markdown that reads terribly aloud and cap the length — a minute-long
// monologue helps nobody.
function toSpeakableText(markdown: string): string {
  const text = markdown
    .replace(/```[\s\S]*?(```|$)/g, ' — code omitted — ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/\*\*|__|\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= 700) return text
  const cut = text.slice(0, 700)
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  return lastStop > 200 ? cut.slice(0, lastStop + 1) : cut
}

// Everything the middle pane can show, in the precedence order of the old
// view ternary. Section views in KEEP_ALIVE_SECTIONS stay mounted inside an
// <Activity> once visited — hidden ones keep state and DOM (instant switches,
// scroll preserved) while React pauses their effects. The rest (overlays,
// file editors, the full-screen chat) mount and unmount as before.
type MiddleView =
  | 'browser' | 'home' | 'suggested-topics' | 'meetings' | 'code' | 'live-notes'
  | 'bg-tasks' | 'apps' | 'spaces' | 'email' | 'workspace' | 'knowledge'
  | 'chat-history' | 'bases' | 'graph' | 'file' | 'task' | 'chat'

const KEEP_ALIVE_SECTIONS: ReadonlySet<MiddleView> = new Set<MiddleView>([
  'home', 'meetings', 'code', 'bg-tasks', 'apps', 'spaces', 'email', 'workspace', 'knowledge',
])

const MACOS_TRAFFIC_LIGHTS_RESERVED_PX = 16 + 12 * 3 + 8 * 2
const TITLEBAR_TOGGLE_MARGIN_LEFT_PX = 12
// The expanded/collapsed sidebar choice, persisted per machine.
const SIDEBAR_VIEW_STORAGE_KEY = 'x:sidebar-view'
const WORKSPACE_ROOT = 'knowledge/Workspace'
// Sentinel path for the default Bases view (a virtual "file" the bases table
// renders under). The other __rowboat_* sentinel tab paths died with the tab
// strip — sections are plain view state now.
const BASES_DEFAULT_TAB_PATH = '__rowboat_bases_default__'

// Stable empty conversation for unbound sessions (identity-stable for deps).
const EMPTY_CONVERSATION: ConversationItem[] = []

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

const isBaseFilePath = (path: string) => path.endsWith('.base') || path === BASES_DEFAULT_TAB_PATH

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

// The renderer displays our internal (flat) usage shape that arrives over IPC,
// not the AI SDK's restructured LanguageModelUsage (nested token details).
type UsageSummary = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
}

const normalizeUsage = (usage?: UsageSummary | null): UsageSummary | null => {
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
// Where the Home composer's next send goes — set by the list's ＋/reply
// affordances, shown as a destination chip. Null = plain assistant chat.
export type HomeComposeTarget =
  | { kind: 'todo'; prefill?: string }
  | { kind: 'sub'; parentKey: string; parentText: string; prefill?: string }
  | { kind: 'comment'; key: string; itemText: string; quote?: string }
  | { kind: 'chatReply'; sessionId: string; title: string; quote?: string }

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
  | { type: 'spaces'; orgId?: string; spaceId?: string; rail?: RailSelection }

function viewStatesEqual(a: ViewState, b: ViewState): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'chat' && b.type === 'chat') return a.runId === b.runId
  if (a.type === 'file' && b.type === 'file') return a.path === b.path
  if (a.type === 'task' && b.type === 'task') return a.name === b.name
  if (a.type === 'workspace' && b.type === 'workspace') return (a.path ?? '') === (b.path ?? '')
  if (a.type === 'knowledge-view' && b.type === 'knowledge-view') return (a.folderPath ?? '') === (b.folderPath ?? '') && (a.mode ?? '') === (b.mode ?? '')
  if (a.type === 'email' && b.type === 'email') return (a.threadId ?? '') === (b.threadId ?? '') && (a.searchQuery ?? '') === (b.searchQuery ?? '')
  if (a.type === 'spaces' && b.type === 'spaces') return (a.orgId ?? '') === (b.orgId ?? '') && (a.spaceId ?? '') === (b.spaceId ?? '') && railKey(a.rail) === railKey(b.rail)
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
    case 'spaces': {
      const orgId = params.get('orgId')
      const spaceId = params.get('spaceId')
      if (!orgId || !spaceId) return { type: 'spaces' }
      const threadRootId = params.get('threadRootId')
      return { type: 'spaces', orgId, spaceId, ...(threadRootId ? { rail: { kind: 'thread' as const, rootMessageId: threadRootId } } : {}) }
    }
    default:
      return null
  }
}

/** Sidebar toggle (fixed position, top-left) — one persistent control that
    swaps between the expanded panel and the icon rail, in both directions.
    Reports its rendered width so collapsed-mode headers can pad past the
    whole cluster (its contents vary: new chat, caffeinate). */
function FixedSidebarToggle({
  leftInsetPx,
  onNewChat,
  onWidthChange,
}: {
  leftInsetPx: number
  onNewChat?: () => void
  onWidthChange?: (px: number) => void
}) {
  const { toggleSidebar, state } = useSidebar()
  const rootRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = rootRef.current
    if (!el || !onWidthChange) return
    onWidthChange(el.offsetWidth)
    const observer = new ResizeObserver(() => onWidthChange(el.offsetWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [onWidthChange])
  return (
    <div ref={rootRef} className="fixed left-0 top-0 z-50 flex h-10 items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <div aria-hidden="true" className="h-10 shrink-0" style={{ width: leftInsetPx }} />
      <button
        type="button"
        onClick={toggleSidebar}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        style={{ marginLeft: TITLEBAR_TOGGLE_MARGIN_LEFT_PX }}
        aria-label="Toggle sidebar"
        title={state === 'collapsed' ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <PanelLeftIcon className="size-[17px]" strokeWidth={1.5} />
      </button>
      {onNewChat && (
        <button
          type="button"
          onClick={onNewChat}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label="New chat"
          title="New chat"
        >
          <SquarePen className="size-[17px]" strokeWidth={1.5} />
        </button>
      )}
      {/* Caffeinate lives here rather than in a pane header: it is app-wide
          state, and this cluster is the one control group present on every
          view, sidebar expanded or docked. */}
      <CaffeinateToggle />
    </div>
  )
}

/** Main content header. Expanded, the panel absorbs the fixed toggle cluster
    so ordinary padding works; collapsed, the header pads past the cluster's
    measured width (collapsedLeftPaddingPx) so back/forward never sit under it. */
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
  return (
    <header
      className="rowboat-titlebar titlebar-drag-region flex h-10 shrink-0 items-stretch border-b border-border bg-background overflow-hidden"
      style={{
        paddingLeft: state === 'collapsed' ? (collapsedLeftPaddingPx ?? 12) : 12,
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
  // The open deck's selected slide, reported by PptxEditor — the deck-kind
  // sibling of editorContentRef: what the middle pane currently SHOWS, read
  // when building each message's user context. slideNumber is 1-based.
  const deckStateRef = useRef<{ path: string; slideNumber: number; slideCount: number } | null>(null)
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
  const [isSpacesOpen, setIsSpacesOpen] = useState(false)
  // The space open in the Spaces view (org + space); the sidebar highlights it.
  const [spaceSelection, setSpaceSelection] = useState<SpaceSelection>(null)
  // Remember the last space opened (any route in) — the ⌥Tab switcher lands
  // there directly instead of opening the spaces flyout.
  useEffect(() => {
    if (!spaceSelection) return
    try {
      window.localStorage.setItem(LAST_SPACE_STORAGE_KEY, JSON.stringify(spaceSelection))
    } catch { /* ignore */ }
  }, [spaceSelection])
  // What's selected inside the open space (general / topic / file) — part of the history.
  const [railSelection, setRailSelection] = useState<RailSelection>({ kind: 'general' })
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
  const [newPresentationOpen, setNewPresentationOpen] = useState(false)
  const [newPresentationTargetFolder, setNewPresentationTargetFolder] = useState('knowledge')
  const [isChatHistoryOpen, setIsChatHistoryOpen] = useState(false)
  // Default landing view: Home with the chat docked according to appearance settings.
  const [isHomeOpen, setIsHomeOpen] = useState(true)
  // Home surface: the to-do list is the primary tab; the legacy dashboard
  // stays reachable via its Overview toggle.
  const [emailInitialThreadId, setEmailInitialThreadId] = useState<string | null>(null)
  const [emailThreadIdVersion, setEmailThreadIdVersion] = useState(0)
  // Search query pushed into the email view's search box (e.g. the assistant's
  // read-view email query), so threads outside the synced inbox get real rows.
  const [emailInitialSearchQuery, setEmailInitialSearchQuery] = useState<string | null>(null)
  const [emailSearchQueryVersion, setEmailSearchQueryVersion] = useState(0)
  // The view full-screen chat was expanded from, restored on close. A plain
  // ViewState snapshot, so ANY section restores — the old per-flag record
  // silently dropped Home/Code and left the close button doing nothing.
  const [expandedFrom, setExpandedFrom] = useState<ViewState | null>(null)
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
  const [, setActiveShortcutPane] = useState<ShortcutPane>('left')
  // In collapsed mode the fixed toggle cluster (traffic lights + toggle +
  // new chat + caffeinate) overhangs the pane's left edge (the rail gutter
  // is narrower than it), so top bars pad past its MEASURED width — the
  // cluster's contents vary; the expanded panel absorbs it, so ordinary
  // padding there. Initial estimate covers first paint until the observer
  // reports.
  const [titlebarControlsWidthPx, setTitlebarControlsWidthPx] = useState(
    (isMac ? MACOS_TRAFFIC_LIGHTS_RESERVED_PX : 0) + TITLEBAR_TOGGLE_MARGIN_LEFT_PX + 3 * 32,
  )
  const collapsedLeftPaddingPx = Math.max(12, titlebarControlsWidthPx + 8 - DOCK_GUTTER_PX)
  // Expanded panel vs. collapsed dock — the collapse button swaps between
  // them; the choice persists per machine.
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_VIEW_STORAGE_KEY) !== 'dock'
    } catch {
      return true
    }
  })
  const handleSidebarOpenChange = useCallback((open: boolean) => {
    setSidebarOpen(open)
    try {
      window.localStorage.setItem(SIDEBAR_VIEW_STORAGE_KEY, open ? 'panel' : 'dock')
    } catch { /* keep in-memory behavior */ }
  }, [])

  // Keep the latest selected path in a ref (avoids stale async updates when switching rapidly)
  const selectedPathRef = useRef<string | null>(null)
  // The slide editor reporting which slide is on screen. Stamped with the path
  // it belongs to, so a stale report from a deck the user has closed can never
  // be attributed to whatever is open now.
  const handleDeckSlideChange = useCallback((slideNumber: number, slideCount: number) => {
    const path = selectedPathRef.current
    if (!path) return
    deckStateRef.current = { path, slideNumber, slideCount }
  }, [])
  const editorPathRef = useRef<string | null>(null)
  const fileLoadRequestIdRef = useRef(0)
  const initialContentByPathRef = useRef<Map<string, string>>(new Map())
  const documentRevisionByPathRef = useRef<Map<string, number>>(new Map())
  const externalChangeRevisionByPathRef = useRef<Map<string, number>>(new Map())
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
  const handledBillingErrorIdsRef = useRef<Set<string>>(new Set())
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState<string>('')
  const [, setModelUsage] = useState<UsageSummary | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  // New runtime: the active session's chat data + actions. All logic lives in
  // SessionChatStore (tested headlessly); the hook is a thin subscription.
  // runId IS the session id in the sessions runtime.
  const sessionChat = useSessionChat(runId)

  // The companion's OWN conversation binding. The hover bar, the Skipper,
  // and every call talk to THIS session — never to whatever chat the app
  // happens to be showing. Seeded from the chat a call was started on;
  // switched from the companion's chip; untouched by app navigation, so hovering
  // and browsing the app are fully independent.
  const [hoverRunId, setHoverRunId] = useState<string | null>(null)
  const hoverRunIdRef = useRef<string | null>(null)
  hoverRunIdRef.current = hoverRunId
  const hoverChat = useSessionChat(hoverRunId)
  const hoverChatRef = useRef(hoverChat)
  hoverChatRef.current = hoverChat
  // The bar's model/effort picks — scoped to the companion, never overlaid
  // onto the app chat's selection.
  const hoverSelectionRef = useRef<ModelSelection | null>(null)
  const hoverIsProcessing = hoverChat.chatState?.isProcessing ?? false
  const hoverIsReasoning = hoverChat.chatState?.isReasoning ?? false
  const hoverConversation = hoverChat.chatState?.conversation ?? EMPTY_CONVERSATION
  const hoverAssistantMessage = hoverChat.chatState?.currentAssistantMessage ?? ''

  // Watch the conversation that is actually rendered — the sessions-runtime
  // one when loaded, the legacy state otherwise — so billing failures
  // (out of credits, subscription lapsed) always pop the upgrade dialog.
  // Only errors that APPEAR while a conversation is on screen count: when a
  // context first renders (session loaded/switched, app relaunched), errors
  // already in its transcript are history — replaying them would pop the
  // dialog and flip the credit state on every open of that chat.
  const billingWatchedConversation = sessionChat.chatState?.conversation ?? conversation
  const billingContextKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const contextKey = sessionChat.chatState ? `session:${sessionChat.sessionId}` : 'legacy'
    const isNewContext = billingContextKeyRef.current !== contextKey
    billingContextKeyRef.current = contextKey
    if (isNewContext) {
      for (const item of billingWatchedConversation) {
        if (isErrorMessage(item) && matchBillingError(item.message)) {
          handledBillingErrorIdsRef.current.add(item.id)
        }
      }
      return
    }
    for (let i = billingWatchedConversation.length - 1; i >= 0; i--) {
      const item = billingWatchedConversation[i]
      if (!isErrorMessage(item)) continue
      if (handledBillingErrorIdsRef.current.has(item.id)) return
      const match = matchBillingError(item.message)
      if (match) {
        handledBillingErrorIdsRef.current.add(item.id)
        setBillingErrorMatch(match)
        setBillingErrorOpen(true)
        if (match.kind === 'out_of_credits') dispatchCreditExhausted()
      }
      return
    }
  }, [billingWatchedConversation, sessionChat.chatState, sessionChat.sessionId])
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
  // (The in-flight-reply mirrors — pill response panel, fallback speech,
  // quick-ask state — read the HOVER session's store, declared above.)
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
  // Both start false and are filled by an async probe (two IPC round-trips
  // at mount). A hover summon that lands before it resolves must NOT read
  // that `false` as "no voice configured" — that answered the chord with
  // the text card for the first seconds after every app start (the "old
  // quick access comes up instead of hover mode" glitch). Refs + the
  // in-flight promise let the summon WAIT for a real answer; the refs are
  // written inside the probe too, so a waiter sees the result without
  // depending on a React re-render.
  const voiceAvailableRef = useRef(false)
  voiceAvailableRef.current = voiceAvailable
  const ttsAvailableRef = useRef(false)
  ttsAvailableRef.current = ttsAvailable
  const voiceProbeRef = useRef<Promise<void> | null>(null)
  // TTS plays only during calls now (the standing read-aloud toggle was
  // retired; a per-message "read aloud" action may replace it later).
  const ttsEnabledRef = useRef(false)
  // Voice-to-voice latency marks for the current call turn (performance.now):
  // t0 = utterance accepted, submit = message sent, speak = first TTS
  // speak(). Emitted as call_turn_latency when audio actually starts.
  const callTurnMarksRef = useRef<{ t0: number; submit?: number; speak?: number } | null>(null)
  // A summon that CAN'T become a session (voice unconfigured, or the call
  // engine failed to start) is explained by the APP window — the companion
  // has no second surface of its own any more. Late-bound: the toast lives
  // with the settings state far below.
  const notifyVoiceUnavailableRef = useRef<((reason: 'voice' | 'failed') => void) | null>(null)
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

  // Push-to-talk: the mic gate is open while 'held' (key or on-screen button
  // down) or 'locked' (a quick tap toggled hands-free capture). 'idle' means
  // the assistant hears nothing. Declared here (above the segment player)
  // because segment consumption freezes while the gate is open.
  const [pttStatus, setPttStatus] = useState<'idle' | 'held' | 'locked'>('idle')
  const pttStatusRef = useRef<'idle' | 'held' | 'locked'>('idle')
  // Ghostwriter chord (⇧ + the talk key): the NEXT utterance's result gets
  // pasted at the user's cursor. Set on the down edge, consumed by the
  // utterance callback, cleared on cancel.
  const pttPasteIntentRef = useRef(false)
  const setPttState = useCallback((s: 'idle' | 'held' | 'locked') => {
    pttStatusRef.current = s
    setPttStatus(s)
  }, [])

  // Speak newly completed <voice> blocks from the new runtime's live stream.
  // Speech is a COMPANION concern (the hover session's replies), so the
  // segments come from the hover session's store — the app's visible chat
  // never starts talking, whatever it's bound to.
  const spokenVoiceRef = useRef<{ key: string | null; count: number }>({ key: null, count: 0 })
  const voiceSegments = hoverChat.chatState?.voiceSegments
  const voiceSegmentsRef = useRef(voiceSegments)
  voiceSegmentsRef.current = voiceSegments
  // Whether any voice segment of the CURRENT call turn has been spoken —
  // cleared at submit, set by the segment player; the fallback-speech net
  // fires only when this is still false at turn completion.
  const spokeSegmentThisTurnRef = useRef(false)
  // Fallback-speech bookkeeping, armed per call turn at submit (see
  // handlePromptSubmit) and consumed by the effect below the segment player.
  const callTurnVoiceRef = useRef<{ pending: boolean; submitAt: number }>({
    pending: false,
    submitAt: 0,
  })
  useEffect(() => {
    if (!voiceSegments) return
    if (spokenVoiceRef.current.key !== hoverRunId) {
      // Session switch: skip anything already streamed before we arrived.
      spokenVoiceRef.current = { key: hoverRunId, count: voiceSegments.length }
      return
    }
    // The overlay's segment list is PER-TURN: the store resets it to [] on
    // every turn_created (store.ts). A shrink therefore means "new turn" —
    // restart consumption from the top. Without this, the new reply's first
    // segments sat below the stale counter and only the tail was spoken
    // (or nothing at all when the new reply was shorter than the old one).
    if (voiceSegments.length < spokenVoiceRef.current.count) {
      spokenVoiceRef.current.count = 0
    }
    while (spokenVoiceRef.current.count < voiceSegments.length) {
      // The user is mid-capture (PTT held/locked): speaking now would play
      // TTS into their open mic. FREEZE consumption (no skip) — if they
      // release without submitting, the effect re-runs (pttStatus dep) and
      // the reply resumes; a real submit drops the backlog instead.
      if (pttStatusRef.current !== 'idle') break
      const segment = voiceSegments[spokenVoiceRef.current.count]
      spokenVoiceRef.current.count += 1
      if (
        ttsEnabledRef.current &&
        !suppressSpeechTurnRef.current &&
        !speakerMutedRef.current
      ) {
        const marks = callTurnMarksRef.current
        if (marks && marks.speak === undefined) marks.speak = performance.now()
        spokeSegmentThisTurnRef.current = true
        ttsRef.current.speak(segment)
        setAssistantCaption(segment)
      }
    }
  }, [voiceSegments, hoverRunId, pttStatus])

  // Consistency net: 'full' voice output relies on the model wrapping its
  // reply in <voice> tags — when it doesn't, the turn used to end in total
  // silence. If a call turn finishes with no voice segment, read the reply
  // text itself aloud.
  useEffect(() => {
    if (hoverIsProcessing) return
    const turn = callTurnVoiceRef.current
    if (!turn.pending) return
    // Typed turn or speaker muted: no fallback read-aloud.
    if (suppressSpeechTurnRef.current || speakerMutedRef.current) {
      turn.pending = false
      return
    }
    // Speaking this turn at all? (Only a live session speaks.)
    if (!ttsEnabledRef.current) {
      turn.pending = false
      return
    }
    // Mid-capture: stay armed and re-evaluate on release (pttStatus dep) —
    // speaking now would go into the open mic, and the frozen segment
    // backlog may still cover this turn once it drains.
    if (pttStatusRef.current !== 'idle') return
    if (spokeSegmentThisTurnRef.current) {
      // The segment player voiced (part of) this turn — no fallback.
      turn.pending = false
      return
    }
    for (let i = hoverConversation.length - 1; i >= 0; i--) {
      const item = hoverConversation[i]
      if (!isChatMessage(item) || item.role !== 'assistant') continue
      // Only a reply from THIS turn counts — an errored turn would otherwise
      // re-speak the previous answer. An older newest-message means this
      // turn's reply hasn't landed in the conversation yet: stay armed and
      // let the next conversation update resolve it.
      if (item.timestamp >= turn.submitAt) {
        turn.pending = false
        const speakable = toSpeakableText(item.content)
        if (speakable) {
          ttsRef.current.speak(speakable)
          setAssistantCaption(speakable)
        }
      }
      break
    }
  }, [hoverIsProcessing, hoverConversation, pttStatus])

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
  // Which chat (or the call engine) holds the mic — render gating for the
  // per-chat recording UI reads this instead of "is this the active tab".
  const voiceOwner = useVoiceOwner()

  // Calls: one engine (hands-free voice loop + forced read-aloud TTS + frame
  // capture), started via presets that only differ in device defaults. The
  // presentation is DERIVED from devices, never picked: screen sharing →
  // floating popout; camera on → full-screen call; camera off → popout
  // (mascot pill). Handlers live below the voice/submit plumbing they drive.
  const video = useVideoMode()
  // Assistant calls hold the mic — tell main so ambient meeting detection
  // doesn't mistake our own capture for an external meeting.
  useEffect(() => {
    void window.ipc
      .invoke('voice:setCallActive', { active: video.state !== 'idle' })
      .catch(() => { /* detection may be unavailable */ })
  }, [video.state])
  const [inCall, setInCall] = useState(false)
  const inCallRef = useRef(false)
  // User explicitly shrank the full-screen call to the floating pill.
  const [callMinimized, setCallMinimized] = useState(false)
  // A voice session started from the companion (⌥⇧Space summon or the
  // card's tuck handle): its share toggle is STICKY — opted in once, every
  // future summon starts already sharing, until toggled off.
  const companionVoiceRef = useRef(false)
  const companionVoiceStartingRef = useRef(false)
  // Speech follows the QUESTION's modality, not the surface: a spoken
  // question (PTT utterance) gets a spoken reply — even with the Skipper's
  // text panel open — while a typed question renders silently. Stamped
  // per-turn at submit so the choice sticks for the whole reply.
  const suppressSpeechTurnRef = useRef(false)
  // Output mute (the Skipper's speaker pin): no reply audio while set —
  // independent of micMuted (which pauses INPUT).
  const [speakerMuted, setSpeakerMuted] = useState(false)
  const speakerMutedRef = useRef(false)
  speakerMutedRef.current = speakerMuted
  // In-call mute: a full input pause, not just audio — mic audio stops
  // reaching Deepgram AND camera/screen frame capture stops, so nothing said
  // or shown while muted ever reaches the assistant. Output is untouched
  // (in-flight speech keeps playing; the Stop control handles that).
  const [micMuted, setMicMuted] = useState(false)
  const micMutedRef = useRef(false)
  micMutedRef.current = micMuted
  // Practice preset: adds the coaching persona to the system prompt.
  const [practiceMode, setPracticeMode] = useState(false)
  const practiceModeRef = useRef(false)

  const handleToggleMeetingRef = useRef<(() => void) | undefined>(undefined)
  const meetingTranscription = useMeetingTranscription(() => {
    handleToggleMeetingRef.current?.()
  })

  // Keep the tray menu in sync with meeting capture ("Start meeting notes"
  // vs "Stop recording & generate notes").
  useEffect(() => {
    void window.ipc
      .invoke('meeting:setRecordingState', { recording: meetingTranscription.state === 'recording' })
      .catch(() => { /* tray may be unavailable */ })
  }, [meetingTranscription.state])

  // Main detected the meeting app released the mic (call ended) — stop and
  // generate notes, exactly like a manual stop. Listener only exists while
  // recording, so a stale signal can never toggle a new recording ON.
  useEffect(() => {
    if (meetingTranscription.state !== 'recording') return
    return window.ipc.on('meeting:externalCallEnded', () => {
      handleToggleMeetingRef.current?.()
    })
  }, [meetingTranscription.state])

  // Check if voice is available on mount and when OAuth state changes
  const refreshVoiceAvailability = useCallback(() => {
    const probe = Promise.all([
      window.ipc.invoke('voice:getConfig', null),
      window.ipc.invoke('oauth:getState', null),
    ]).then(([config, oauthState]) => {
      const rowboatConnected = oauthState.config?.rowboat?.connected ?? false
      const hasVoice = !!config.deepgram || rowboatConnected
      const hasTts = !!config.elevenlabs || rowboatConnected
      voiceAvailableRef.current = hasVoice
      ttsAvailableRef.current = hasTts
      setVoiceAvailable(hasVoice)
      setTtsAvailable(hasTts)
      // Pre-cache auth details so mic click skips IPC round-trips
      if (hasVoice) {
        voice.warmup()
      }
    }).catch(() => {
      voiceAvailableRef.current = false
      ttsAvailableRef.current = false
      setVoiceAvailable(false)
      setTtsAvailable(false)
    })
    voiceProbeRef.current = probe
    return probe
  }, [voice.warmup])

  /**
   * Wait for a definitive voice/TTS answer before treating "not available"
   * as the truth. Capped: a probe that never settles must not swallow the
   * summon — the caller falls back to the text card instead.
   */
  const awaitVoiceProbe = useCallback(async () => {
    // Start one if nothing has probed yet — a summon must never decide
    // "no voice" off a value nobody has looked up.
    const probe = voiceProbeRef.current ?? refreshVoiceAvailability()
    await Promise.race([
      probe,
      new Promise((resolve) => setTimeout(resolve, VOICE_PROBE_WAIT_MS)),
    ])
  }, [refreshVoiceAvailability])

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

  // Which macOS permission explainer is up, if any (replaces the old silent
  // failures: mic/camera denials did nothing visible).
  const [permissionDialog, setPermissionDialog] = useState<PermissionKind | null>(null)

  // A permission problem must be impossible to miss: chime and bring the app
  // window to the front — the user may be in another app entirely (pill
  // share toggle, global PTT) when the failure fires.
  useEffect(() => {
    if (!permissionDialog) return
    playAlertCue()
    void window.ipc.invoke('app:focusMainWindow', null).catch(() => {})
  }, [permissionDialog])

  // Steal handler for PTT: another holder is taking the mic — drop the
  // in-flight recording without releasing ownership (the thief owns it now).
  const cancelPttForSteal = useCallback(() => {
    voice.cancel()
    setIsRecording(false)
    isRecordingRef.current = false
  }, [voice])

  const handleStartRecording = useCallback((holderId: string) => {
    // A live call owns the mic — ignore push-to-talk while one is running.
    if (inCallRef.current) return
    acquireVoice(holderId, cancelPttForSteal)
    setIsRecording(true)
    isRecordingRef.current = true
    void voice.start().then((result) => {
      if (result === 'mic-denied') {
        setIsRecording(false)
        isRecordingRef.current = false
        releaseVoice(holderId)
        setPermissionDialog('microphone')
      }
    })
  }, [voice, cancelPttForSteal])

  const handlePromptSubmitRef = useRef<((message: PromptInputMessage, mentions?: FileMention[], stagedAttachments?: StagedAttachment[], searchEnabled?: boolean, codeMode?: 'claude' | 'codex', permissionMode?: PermissionMode) => Promise<void>) | null>(null)
  // Companion sends (bar submits, call utterances) — filled once
  // handleHoverSubmit exists; early callers (startCall's PTT callback) fire
  // at event time, long after render.
  const handleHoverSubmitRef = useRef<((message: PromptInputMessage, mentions?: FileMention[], stagedAttachments?: StagedAttachment[], searchEnabled?: boolean, codeMode?: 'claude' | 'codex', permissionMode?: PermissionMode) => Promise<void>) | null>(null)
  // Late-bound handle to bindChatToRun (declared with the chat plumbing far
  // below) for early-declared effects like quick-ask open-chat.
  const bindChatToRunRef = useRef<((rid: string) => void) | null>(null)
  const loadRunRef = useRef<((id: string) => Promise<void>) | null>(null)
  // A call was started from a FRESH (unbound) chat: when the hover session
  // materializes on the first utterance, bind that chat to it too — the
  // call button means "float THIS chat", so both surfaces must end up on
  // the same conversation instead of hover minting an orphan chat. Chat
  // identity is captured so a user who switched away is never hijacked.
  const bindAppChatOnHoverCreateRef = useRef<{ tabId: string; chatId: string } | null>(null)
  // The Home composer's submit (routes to a to-do target or a fresh chat);
  // dictation started from the Home composer flows through it, so a spoken
  // to-do lands on the list, not in some chat.
  const handleHomeComposerSubmitRef = useRef<((message: PromptInputMessage) => void) | null>(null)
  const pendingVoiceInputRef = useRef(false)

  // The (single) mounted markdown editor's imperative handle, and the pending
  // palette payload queued across the new-chat state flush before submit fires.
  const markdownEditorRef = useRef<MarkdownEditorHandle | null>(null)
  const [pendingPaletteSubmit, setPendingPaletteSubmit] = useState<{ text: string; mention: CommandPaletteMention | null } | null>(null)

  const handleSubmitRecording = useCallback(async () => {
    if (!isRecordingRef.current) return
    const text = await voice.submit()
    setIsRecording(false)
    isRecordingRef.current = false
    const holder = voiceOwnerId()
    if (holder && holder !== CALL_VOICE_HOLDER) releaseVoice(holder)
    if (text) {
      pendingVoiceInputRef.current = true
      // Route by mic owner: the transcript belongs to the composer that
      // started the recording, not blindly to the active chat.
      if (holder === HOME_VOICE_HOLDER) {
        handleHomeComposerSubmitRef.current?.({ text, files: [] })
      } else {
        handlePromptSubmitRef.current?.({ text, files: [] })
      }
    }
  }, [voice])

  const handleCancelRecording = useCallback(() => {
    voice.cancel()
    setIsRecording(false)
    isRecordingRef.current = false
    const holder = voiceOwnerId()
    if (holder && holder !== CALL_VOICE_HOLDER) releaseVoice(holder)
  }, [voice])

  // Start a call. Presets only differ in device defaults — the engine
  // (continuous listening, auto-submitted utterances, forced read-aloud TTS,
  // frame capture) is identical for all of them. The default entry ('share',
  // the call button's main click) is "work together": screen shared, camera
  // off, floating pill — the user keeps working while the assistant watches
  // along. 'video'/'practice' open face-to-face full screen instead.
  const callStartedAtMsRef = useRef<number | null>(null)
  // Epoch twin of the perf-clock mark above — gates which conversation
  // messages belong to THIS call (the pill's response mirror).
  const callStartedEpochRef = useRef(0)

  const startCall = useCallback(async (preset: CallPreset) => {
    if (inCallRef.current) return
    // The call engine owns the mic for the call's whole duration; any live
    // push-to-talk recording is stolen (cancelled cleanly) here. Nothing
    // steals FROM a call — handleStartRecording defers while in-call — so
    // the call's own onStolen is defensively a no-op.
    acquireVoice(CALL_VOICE_HOLDER, () => {})
    const camera = preset === 'video' || preset === 'practice'
    const ok = await video.start({ camera })
    if (!ok) {
      // Camera denied/unavailable — stay out of the call, and say why.
      releaseVoice(CALL_VOICE_HOLDER)
      if (camera) setPermissionDialog('camera')
      return
    }
    if (preset === 'share') {
      // If screen capture fails (usually the macOS Screen Recording
      // permission), continue as a voice call — sharing is one tap away on
      // the pill once permission is granted. The dialog explains the grant +
      // relaunch dance instead of failing silently.
      const shared = await video.startScreenShare()
      if (!shared) setPermissionDialog('screen-recording')
    } else {
      // Presets that don't share at start still settle the Screen Recording
      // permission NOW — triggering the macOS prompt (first use) and the
      // audible in-app dialog when the grant isn't effective — so by the
      // time the user reaches for the share button it just works, instead
      // of the permission dance ambushing them mid-call.
      void window.ipc
        .invoke('meeting:checkScreenPermission', null)
        .then(({ granted }) => {
          if (!granted) setPermissionDialog('screen-recording')
        })
        .catch(() => {})
    }

    // A manual push-to-talk recording can't coexist with the call's mic.
    if (isRecordingRef.current) {
      voiceRef.current.cancel()
      setIsRecording(false)
      isRecordingRef.current = false
    }
    ttsEnabledRef.current = true
    ttsModeRef.current = 'full'
    // Push-to-talk: the mic + Deepgram socket stay warm for the whole call,
    // but nothing is heard until the user opens the gate (hold the talk key, or
    // tap it to lock hands-free capture). The key release is the endpoint —
    // no silence detection, no misfires.
    void voiceRef.current
      .startPtt((text) => {
        // Instant "heard you" feedback + start of the latency clock.
        playAckCue()
        callTurnMarksRef.current = { t0: performance.now() }
        pendingVoiceInputRef.current = true
        // Ghostwriter chord: the marker rides the message itself — durable
        // in the transcript ("why did it paste?" answers itself), cache-safe
        // (no per-turn composition churn). It carries the chord's TWO modes:
        // dictation (the utterance IS the content — paste the user's words)
        // vs. ghostwriting (the utterance instructs — compose). Ties break
        // toward verbatim: pasting the user's own words when they meant
        // "compose" is a cheap delete; composing when they were dictating
        // puts words in their mouth.
        const paste = pttPasteIntentRef.current
        pttPasteIntentRef.current = false
        const message = paste
          ? `${text}\n\n[⇧⌘ chord — paste at my cursor. If I'm dictating content, paste MY words verbatim (fix punctuation, drop fillers, change nothing else) and reply "Done." at most — I watch the text land; never narrate it. Compose only when I'm clearly instructing you to write something. Unsure → verbatim.]`
          : text
        // Calls talk to the companion's session — the app window can browse
        // any chat mid-call without retargeting the conversation.
        handleHoverSubmitRef.current?.({ text: message, files: [] })
      })
      .then((result) => {
        if (result === 'mic-denied') setPermissionDialog('microphone')
      })

    setPttState('idle')
    setPracticeMode(preset === 'practice')
    practiceModeRef.current = preset === 'practice'
    setMicMuted(false)
    setSpeakerMuted(false)
    // Every preset starts in the floating pill (video included — the camera
    // preview lives in the pill) except practice, where the coaching session
    // is a deliberate face-to-face full screen.
    setCallMinimized(preset !== 'practice')
    inCallRef.current = true
    setInCall(true)
    callStartedAtMsRef.current = performance.now()
    callStartedEpochRef.current = Date.now()
    analytics.callStarted(preset)
  }, [video, setPttState])

  const endCall = useCallback(() => {
    if (!inCallRef.current) return
    const startedAt = callStartedAtMsRef.current
    callStartedAtMsRef.current = null
    analytics.callEnded(startedAt != null ? (performance.now() - startedAt) / 1000 : 0)
    voiceRef.current.cancel()
    ttsEnabledRef.current = false
    ttsModeRef.current = 'summary'
    ttsRef.current.cancel()
    callTurnMarksRef.current = null
    video.stop()
    setPracticeMode(false)
    practiceModeRef.current = false
    setMicMuted(false)
    setPttState('idle')
    setCallMinimized(false)
    inCallRef.current = false
    setInCall(false)
    companionVoiceRef.current = false
    releaseVoice(CALL_VOICE_HOLDER)
    // A call seeded from the app's own chat was just a mirror of it — release
    // the companion binding so its second store unsubscribes instead of
    // double-processing that conversation forever. ⌥⇧Space-born conversations
    // (hover ≠ app chat) keep continuity for the next summon.
    if (hoverRunIdRef.current && hoverRunIdRef.current === runIdRef.current) {
      hoverRunIdRef.current = null
      setHoverRunId(null)
    }
  }, [video, setPttState])

  // ONE hover mode: the ⌥⇧Space relay (chord, tray item, the card's tuck
  // handle), the composer's call button, the Home Skipper, and the
  // discoverability toast all start THIS — a companion voice session on the
  // Skipper surface. Sticky screen share replays the user's standing choice
  // (`share` forces it on for this summon); without voice configured it
  // falls back to the text card — and so does a session that fails to
  // start, so a summon is never a silent no-op.
  const startHoverCall = useCallback(async (opts: { share?: boolean } = {}) => {
    // Tell main the relay landed and a session is coming — stops its
    // watchdog from re-sending the relay while devices are still starting
    // up (acquisition can take seconds).
    void window.ipc.invoke('quickAsk:tuckAck', null).catch(() => {})
    if (inCallRef.current) {
      // Already on a call — just make sure the floating surface is up
      // (re-assert even when callSurface didn't change, so a destroyed or
      // desynced companion window self-heals).
      setCallMinimized(true)
      void window.ipc.invoke('video:setPopout', { show: true }).catch(() => {})
      return
    }
    // A start is already in flight — its pin is coming.
    if (companionVoiceStartingRef.current) return
    // Guard covers the probe wait too, so a second chord can't start a
    // parallel session while we're deciding.
    companionVoiceStartingRef.current = true
    try {
      if (!(voiceAvailableRef.current && ttsAvailableRef.current)) {
        // Not "no voice" — just "not known yet" right after an app start.
        await awaitVoiceProbe()
      }
      if (inCallRef.current) {
        // Another entry point started a call while we waited — just make
        // sure its floating surface is up.
        setCallMinimized(true)
        void window.ipc.invoke('video:setPopout', { show: true }).catch(() => {})
        return
      }
      if (!(voiceAvailableRef.current && ttsAvailableRef.current)) {
        // Genuinely no voice configured — say so in the app window.
        notifyVoiceUnavailableRef.current?.('voice')
        return
      }
      companionVoiceRef.current = true
      await startCall('voice')
    } finally {
      // Released the moment the call engine settles — NOT held across the
      // screen share below: a share that stalls on the Screen Recording
      // permission (getDisplayMedia can hang for seconds) used to leave
      // this latched, and every later summon died silently against it.
      companionVoiceStartingRef.current = false
    }
    if (!inCallRef.current) {
      // The session didn't start (device denied/unavailable — startCall
      // already raised the permission dialog). Bring the app forward so the
      // user actually sees that explanation.
      companionVoiceRef.current = false
      notifyVoiceUnavailableRef.current?.('failed')
      return
    }
    // Sticky screen share: opted in once from the mascot's share pin →
    // every summon starts already sharing, until toggled off. Fire-and-
    // forget: the Skipper is already up, the share badge lights when the
    // capture is really live.
    if (opts.share || localStorage.getItem('companion-share-sticky') === '1') {
      void video.startScreenShare().then((shared) => {
        if (!shared) setPermissionDialog('screen-recording')
      })
    }
  }, [awaitVoiceProbe, startCall, video])
  // Stable handle for the tuck-relay listener below — registered once,
  // always calling the latest closure.
  const startHoverCallRef = useRef(startHoverCall)
  startHoverCallRef.current = startHoverCall

  // Composer call buttons: the call button on a chat always means "float
  // THIS chat". No call yet → start the hover session bound to it; call
  // already live on another chat → re-point the live call at it (same
  // devices, same Skipper — only the conversation switches); a fresh
  // (unbound) chat defer-binds, so the first utterance creates ONE session
  // both surfaces share. ⌥⇧Space summons keep the companion's previous
  // conversation instead (no composer context to seed from).
  const handleStartCall = useCallback((preset: CallPreset) => {
    const activeTab = chatTabsRef.current.find((t) => t.id === activeChatTabIdRef.current)
    const seedRunId = activeTab?.runId ?? null
    if (seedRunId) {
      hoverRunIdRef.current = seedRunId
      setHoverRunId(seedRunId)
      bindAppChatOnHoverCreateRef.current = null
    } else if (activeTab) {
      hoverRunIdRef.current = null
      setHoverRunId(null)
      bindAppChatOnHoverCreateRef.current = { tabId: activeTab.id, chatId: activeTab.chatId }
    }
    if (inCallRef.current) {
      // Live-call retarget: silence whatever of the OLD conversation's reply
      // was still playing, and make sure the floating surface is up. The
      // segment player re-keys itself off the new hover binding.
      ttsRef.current.cancel()
      void window.ipc.invoke('video:setPopout', { show: true }).catch(() => {})
      return
    }
    if (preset === 'voice' || preset === 'share') {
      // Both are the hover companion — 'share' is the same summon with the
      // screen shared from the start (the menu's "Share screen").
      void startHoverCall({ share: preset === 'share' })
    } else {
      void startCall(preset)
    }
  }, [startHoverCall, startCall])

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
      const shared = await video.startScreenShare()
      if (!shared) setPermissionDialog('screen-recording')
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
    const shared = await video.startScreenShare()
    if (!shared) setPermissionDialog('screen-recording')
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
    // An interrupted turn must not fallback-speak its (aborted) reply.
    callTurnVoiceRef.current.pending = false
    // Speech comes from the COMPANION's session — stop THAT turn, not
    // whatever chat the app window happens to be showing.
    if (hoverChatRef.current.chatState?.isProcessing) {
      void hoverChatRef.current.stop().catch(() => {})
    }
  }, [voiceSegments])

  // --- Push-to-talk state machine ---
  // One edge-triggered machine fed by every source: the global key hook
  // (uiohook in main), the in-window DOM fallback, and the on-screen talk
  // buttons (full-screen call + popout). Sources overlap while the app is
  // focused, so identical edges arriving within the echo window collapse
  // into one.
  const pttDownAtRef = useRef(0)
  // The assistant was audibly speaking (or about to) when this press began:
  // a quick TAP then means "stop talking" — full interrupt, mic stays shut —
  // not "lock hands-free capture". A HOLD still barges in (silence + talk)
  // in one gesture, and the next tap after a stop behaves normally.
  const pttSpokeAtDownRef = useRef(false)
  const pttLastEdgeRef = useRef<{ type: 'down' | 'up'; at: number } | null>(null)
  // The talk key was used as a modifier (⌘C / Ctrl+C etc.) during this
  // press — the matching release must not commit/lock.
  const pttChordedRef = useRef(false)

  const pttEdgeIsEcho = useCallback((type: 'down' | 'up') => {
    const now = performance.now()
    const last = pttLastEdgeRef.current
    pttLastEdgeRef.current = { type, at: now }
    return !!last && last.type === type && now - last.at < PTT_EDGE_ECHO_MS
  }, [])

  const handlePttDown = useCallback((paste?: boolean) => {
    if (!inCallRef.current || micMutedRef.current) return
    if (pttEdgeIsEcho('down')) return
    pttChordedRef.current = false
    pttDownAtRef.current = performance.now()
    if (pttStatusRef.current === 'idle') {
      // Ghostwriter chord: this capture's utterance wants its result pasted
      // at the cursor — consumed by the utterance callback in startCall.
      pttPasteIntentRef.current = !!paste
      // Captured BEFORE the cancel below wipes it — the release edge needs
      // to know whether this press interrupted speech.
      pttSpokeAtDownRef.current = ttsRef.current.state !== 'idle'
      // Silence the assistant's AUDIO the moment the user starts talking —
      // but do NOT abort the run or discard its reply: an accidental or
      // empty press must never cost the answer. The run is stopped only
      // when a real utterance actually submits (handlePromptSubmit), or by
      // a deliberate stop-tap (see handlePttUp).
      ttsRef.current.cancel()
      setAssistantCaption('')
      voiceRef.current.pttBegin()
      setPttState('held')
    }
    // 'locked': the mic is already open — the release decides what happens.
  }, [pttEdgeIsEcho, setPttState])

  const handlePttUp = useCallback(() => {
    if (pttStatusRef.current === 'idle') return
    if (pttEdgeIsEcho('up')) return
    if (pttChordedRef.current) {
      pttChordedRef.current = false
      return
    }
    const heldMs = performance.now() - pttDownAtRef.current
    if (pttStatusRef.current === 'held' && heldMs < PTT_TAP_MS) {
      if (pttSpokeAtDownRef.current) {
        // Tap while the assistant was talking = "stop": full interrupt
        // (silence + drop the queued reply + stop generation, so it can't
        // resume a beat later) with the mic left CLOSED — never a hot mic
        // the user didn't ask for. The next tap lists as usual.
        pttSpokeAtDownRef.current = false
        voiceRef.current.pttCancel()
        setPttState('idle')
        handleInterruptAssistant()
        return
      }
      // Quick tap in silence: lock hands-free capture until the next press.
      setPttState('locked')
      return
    }
    if (pttStatusRef.current === 'held') {
      // First couple of real holds: teach the hands-free tap.
      const shown = Number(localStorage.getItem('ptt-hold-tip-shown') ?? '0')
      if (shown < 2) {
        localStorage.setItem('ptt-hold-tip-shown', String(shown + 1))
        toast('No need to keep holding', {
          description: `For longer turns, quick-tap ${PTT_KEY_LABEL} instead — talk hands-free, then tap again to send.`,
          duration: 6000,
        })
      }
    }
    // Releasing a hold (or pressing again while locked) submits.
    setPttState('idle')
    void voiceRef.current.pttEnd()
  }, [pttEdgeIsEcho, setPttState, handleInterruptAssistant])

  const handlePttCancel = useCallback(() => {
    if (pttStatusRef.current === 'idle') return
    pttPasteIntentRef.current = false
    voiceRef.current.pttCancel()
    setPttState('idle')
  }, [setPttState])

  const handlePttChord = useCallback(() => {
    // The press was a keyboard shortcut, not a talk gesture.
    if (pttStatusRef.current === 'held') {
      voiceRef.current.pttCancel()
      setPttState('idle')
    } else if (pttStatusRef.current === 'locked') {
      pttChordedRef.current = true
    }
  }, [setPttState])

  // PTT key sources: the global hook (works over any app) plus in-window DOM
  // listeners — the fallback that keeps PTT working while the app is focused
  // even when macOS Input Monitoring hasn't been granted.
  useEffect(() => {
    if (!inCall) return
    const offKey = window.ipc.on('voice:ptt-key', ({ type, paste }) => {
      if (type === 'down') handlePttDown(paste)
      else if (type === 'up') handlePttUp()
      else handlePttChord()
    })
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === PTT_CODE) {
        if (!e.repeat) handlePttDown(e.shiftKey)
        return
      }
      if (e.key === 'Escape' && pttStatusRef.current !== 'idle') {
        e.preventDefault()
        handlePttCancel()
        return
      }
      if (pttStatusRef.current === 'held') handlePttChord()
      else if (pttStatusRef.current === 'locked' && pttKey.pttModifierHeld(e, isMac)) handlePttChord()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === PTT_CODE) handlePttUp()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    return () => {
      offKey()
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
    }
  }, [inCall, handlePttDown, handlePttUp, handlePttChord, handlePttCancel])

  // Muting mid-capture discards the capture — nothing said while muted may
  // reach the assistant.
  useEffect(() => {
    if (micMuted) handlePttCancel()
  }, [micMuted, handlePttCancel])

  // Global-PTT onboarding: shortly into a call, if the key hook is running
  // but has seen zero input events, macOS Input Monitoring hasn't taken
  // effect — explain it instead of letting the talk key silently do nothing
  // from other apps. At most once per app session: once-ever proved too little
  // (dismiss without granting and global PTT stayed silently broken), every
  // call would nag. (In-window PTT works regardless.)
  const inputMonitoringPromptedRef = useRef(false)
  useEffect(() => {
    if (!inCall) return
    // macOS-only: Input Monitoring is a TCC grant with no Windows or Linux
    // equivalent, so a dead hook there means something else entirely and
    // this dialog would send the user looking for a switch that isn't there.
    if (!isMac) return
    if (inputMonitoringPromptedRef.current) return
    const timer = setTimeout(async () => {
      try {
        const status = await window.ipc.invoke('ptt:getStatus', null)
        if (status.supported && status.running && !status.eventsSeen) {
          inputMonitoringPromptedRef.current = true
          setPermissionDialog('input-monitoring')
        }
      } catch {
        // Hook unavailable — the DOM fallback still covers in-app PTT.
      }
    }, 4000)
    return () => clearTimeout(timer)
  }, [inCall])

  // Current phase of the call (null when not in one). An open mic gate reads
  // as listening no matter what the assistant is doing — the user is talking.
  const videoCallStatus: 'idle' | 'listening' | 'thinking' | 'speaking' | null =
    inCall
      ? pttStatus !== 'idle'
        ? 'listening'
        : tts.state === 'speaking'
          ? 'speaking'
          : tts.state === 'synthesizing' || hoverIsProcessing
            ? 'thinking'
            : 'idle'
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

  // Latest assistant reply of this call — mirrored into the pill so a typed
  // question can be READ there without switching back to the app (replies
  // are spoken too; this is the visual half). Streaming text while the turn
  // generates, the final message once it lands. Only replies from after the
  // call started count.
  let callResponseText: string | null = null
  let callQuestionText: string | null = null
  if (inCall) {
    // The question the reply answers — shown above it in the panel. All of
    // this reads the HOVER session: the call's conversation, regardless of
    // what the app window is showing.
    let questionAt = 0
    for (let i = hoverConversation.length - 1; i >= 0; i--) {
      const item = hoverConversation[i]
      if (isChatMessage(item) && item.role === 'user') {
        if (item.timestamp >= callStartedEpochRef.current) {
          callQuestionText = item.content
          questionAt = item.timestamp
        }
        break
      }
    }
    callResponseText = hoverAssistantMessage || null
    if (!callResponseText) {
      for (let i = hoverConversation.length - 1; i >= 0; i--) {
        const item = hoverConversation[i]
        if (isChatMessage(item) && item.role === 'assistant') {
          // Only a reply to the CURRENT question counts — right after a
          // submit the newest assistant message is still the previous
          // answer, which must not linger under the new question.
          if (item.timestamp >= callStartedEpochRef.current && item.timestamp >= questionAt) {
            callResponseText = item.content
          }
          break
        }
      }
    }
  }

  // What's happening right now, at tool-NAME level ("Searching the web…",
  // "Reasoning…" — never arguments): the most recent activity wins — a
  // running tool by display name, else reasoning, else plain thinking.
  // Feeds the Skipper's status chip and text panel, so
  // it reads the HOVER session's turn.
  const hoverActivityText = useMemo(() => {
    if (!hoverIsProcessing) return null
    let label = hoverIsReasoning ? 'Reasoning…' : 'Thinking…'
    for (let i = hoverConversation.length - 1; i >= 0; i--) {
      const item = hoverConversation[i]
      if (isToolCall(item)) {
        if (item.status === 'pending' || item.status === 'running') {
          label = `${getToolDisplayName(item)}…`
        }
        break
      }
      if (isChatMessage(item)) break
    }
    return label
  }, [hoverIsProcessing, hoverIsReasoning, hoverConversation])

  // Keep the popout's mascot/status/devices/caption mirror of the call fresh.
  // The main process caches the latest state and replays it when the popout
  // loads.
  useEffect(() => {
    if (!inCall) {
      // Call over (or not started): push an explicit idle state so main's
      // cache can't carry a stale cameraOn/status into the next summon —
      // main keeps the cache across fullscreen ⇄ popout flaps of a LIVE
      // call (camera on must come back as the pill), so only this end
      // marker clears it.
      void window.ipc
        .invoke('video:popoutState', {
          ttsState: 'idle',
          status: null,
          cameraOn: false,
          micMuted: false,
          screenSharing: false,
          speakerMuted: false,
          activityText: null,
          interimText: null,
          pttLocked: false,
          responseText: null,
          questionText: null,
        })
        .catch(() => {})
      return
    }
    void window.ipc
      .invoke('video:popoutState', {
        ttsState: tts.state,
        status: videoCallStatus,
        cameraOn: video.cameraOn,
        micMuted,
        screenSharing: video.screenState === 'live',
        speakerMuted,
        activityText: hoverActivityText,
        interimText: voice.interimText || null,
        pttLocked: pttStatus === 'locked',
        responseText: callResponseText,
        questionText: callQuestionText,
      })
      .catch(() => {})
  }, [inCall, tts.state, videoCallStatus, video.cameraOn, micMuted, video.screenState, speakerMuted, hoverActivityText, voice.interimText, pttStatus, callResponseText, callQuestionText])

  // Screen-pointer gate: tell main whether a share is live (call OR
  // quick-ask — this window owns the capture either way). While true the
  // assistant's screen-pointer tool may draw on the shared display; flipping
  // false tears the pointer overlay down instantly.
  useEffect(() => {
    try {
      void window.ipc
        .invoke('screenPointer:setShareActive', { active: video.screenState === 'live' })
        .catch((err) => console.warn('[screen-pointer] setShareActive failed:', err))
    } catch (err) {
      // A stale preload (app not restarted since the channel was added)
      // throws synchronously from schema validation — must not break the app.
      console.warn('[screen-pointer] setShareActive failed:', err)
    }
  }, [video.screenState])

  // Execute popout control-bar actions (the popout window has no access to
  // the call's mic/camera/capture — they live here). 'expand' goes full
  // screen, which by the exclusivity rule stops any running share; the main
  // process already refocused the app window.
  useEffect(() => {
    return window.ipc.on('video:popout-action', ({ action }) => {
      if (action === 'toggle-mic') handleToggleMic()
      else if (action === 'toggle-camera') handleToggleCamera()
      else if (action === 'toggle-share') {
        // Companion voice sessions remember the choice: sharing becomes the
        // default for future summons until turned off.
        if (companionVoiceRef.current) {
          localStorage.setItem('companion-share-sticky', video.screenState !== 'live' ? '1' : '0')
        }
        void handleToggleScreenShare()
      }
      else if (action === 'toggle-speaker') {
        setSpeakerMuted((muted) => {
          const next = !muted
          if (next) {
            // Muting hushes NOW: silence in-flight speech and drop the
            // queued backlog (marked as voiced so the fallback net doesn't
            // read the reply aloud after an unmute).
            ttsRef.current.cancel()
            if (voiceSegmentsRef.current) {
              spokenVoiceRef.current.count = voiceSegmentsRef.current.length
            }
            spokeSegmentThisTurnRef.current = true
          }
          return next
        })
      }
      else if (action === 'stop-speaking') handleInterruptAssistant()
      else if (action === 'ptt-down') handlePttDown()
      else if (action === 'ptt-up') handlePttUp()
      else if (action === 'end-call') endCall()
      else if (action === 'expand') {
        if (video.screenState === 'live') video.stopScreenShare()
        setCallMinimized(false)
      }
    })
  }, [handleToggleMic, handleToggleCamera, handleToggleScreenShare, handleInterruptAssistant, handlePttDown, handlePttUp, endCall, video])

  // Discoverability: nothing else in the UI reveals the global quick-ask
  // shortcut. One toast, once per install, shortly after launch. The chord
  // is fetched at fire time — it's customizable (Settings → Shortcuts).
  useEffect(() => {
    if (localStorage.getItem('quick-ask-tip-shown')) return
    const timer = setTimeout(async () => {
      localStorage.setItem('quick-ask-tip-shown', '1')
      const accelerator = await window.ipc
        .invoke('quickAsk:getShortcut', null)
        .then((s) => s.accelerator)
        .catch(() => quickAskShortcut.DEFAULT_QUICK_ASK_SHORTCUT)
      playPopCue()
      toast('Ask Rowboat from anywhere', {
        description: `Press ${quickAskShortcut.formatShortcut(accelerator, isMac)} in any app to summon your Skipper — talk or type, the answer shows up right there.`,
        duration: 12000,
        closeButton: true,
        // Lift the card off the page, and move sonner's close button (which
        // defaults to the top-LEFT corner) to the top right.
        className:
          'shadow-xl shadow-black/25 [&_[data-close-button]]:!left-auto [&_[data-close-button]]:!right-0 [&_[data-close-button]]:!translate-x-[15%] [&_[data-close-button]]:!-translate-y-[15%]',
        action: {
          label: 'Try it',
          // The SAME summon the chord performs — through main's relay, so
          // the Skipper lands focused exactly as it does for the shortcut
          // (text card only as its own voice-unavailable fallback).
          onClick: () => void window.ipc.invoke('quickAsk:tuck', null).catch(() => {}),
        },
      })
    }, 3000)
    return () => clearTimeout(timer)
  }, [])

  // Quick-ask "Open in Rowboat": the ONE deliberate bridge between the
  // companion and the app — bind the app's chat to the companion's
  // conversation and land on it full-view. (Everything else keeps the two
  // bindings independent.)
  useEffect(() => {
    return window.ipc.on('quick-ask:open-chat', () => {
      const hoverId = hoverRunIdRef.current
      if (hoverId) bindChatToRunRef.current?.(hoverId)
      // Side pane, not the maximized full view — the user keeps whatever
      // they were working on in the middle.
      setIsChatSidebarOpen(true)
      setIsRightPaneMaximized(false)
    })
  }, [])

  // A screen share ended since the last message: the NEXT message tells the
  // model its earlier frames are stale (history keeps frames inline forever,
  // so without this it answers "what's on my screen" from the past).
  const screenShareEndedRef = useRef(false)
  const lastScreenStateForNoticeRef = useRef(video.screenState)
  useEffect(() => {
    if (lastScreenStateForNoticeRef.current === 'live' && video.screenState !== 'live') {
      screenShareEndedRef.current = true
    }
    // Sharing again supersedes the notice — fresh frames arrive with the
    // next message anyway.
    if (video.screenState === 'live') screenShareEndedRef.current = false
    lastScreenStateForNoticeRef.current = video.screenState
  }, [video.screenState])

  // (The companion's old standalone toggles — speak-the-answer and
  // share-without-a-call — went with the retired ask bar. Sharing is a
  // session control now: the Skipper's bow-light pin, on a live session.)

  // Send into the COMPANION's session. The lean twin of handlePromptSubmit:
  // same per-turn config (voice flags, frames, search/code, permissions,
  // fast-thinking default) but no middle-pane context and none of the
  // visible-chat bookkeeping — the app window's conversation is not
  // involved, whatever it's currently bound to.
  const handleHoverSubmit = useCallback(async (
    message: PromptInputMessage,
    mentions?: FileMention[],
    stagedAttachments: StagedAttachment[] = [],
    searchEnabled?: boolean,
    codeMode?: 'claude' | 'codex',
    permissionMode?: PermissionMode,
  ) => {
    const userMessage = message.text.trim()
    const hasAttachments = stagedAttachments.length > 0
    if (!userMessage && !hasAttachments) return

    if (hoverChatRef.current.chatState?.isProcessing) {
      // In-call and quick-ask input arrives at arbitrary moments — finish
      // the previous turn's stop and proceed instead of dropping the message.
      await hoverChatRef.current.stop().catch(() => {})
    }

    const marks = callTurnMarksRef.current
    if (inCallRef.current && marks && marks.submit === undefined) {
      marks.submit = performance.now()
    }
    // Speech follows the QUESTION's modality: a TYPED question renders its
    // reply silently; a SPOKEN one (PTT utterance) is read aloud.
    suppressSpeechTurnRef.current = inCallRef.current && !pendingVoiceInputRef.current
    if (inCallRef.current) {
      // A new question supersedes whatever of the previous reply was still
      // unspoken — silence it and drop the frozen backlog.
      ttsRef.current.cancel()
      if (voiceSegmentsRef.current) {
        spokenVoiceRef.current.count = voiceSegmentsRef.current.length
      }
      spokeSegmentThisTurnRef.current = false
      callTurnVoiceRef.current = { pending: true, submitAt: Date.now() }
    }

    // Frames ride along whenever capture is live — calls, and quick-ask
    // questions with the share toggle on.
    const videoFrames =
      inCallRef.current || video.screenState === 'live' ? video.collectFrames() : []

    try {
      let sessionId = hoverRunIdRef.current
      if (!sessionId) {
        const created = await window.ipc.invoke('sessions:create', {})
        sessionId = created.sessionId
        hoverRunIdRef.current = sessionId
        setHoverRunId(sessionId)
        analytics.chatSessionCreated(sessionId)
        // The call was started from a fresh chat: bind that chat to the
        // session we just created — both surfaces show ONE conversation.
        // Only if the user hasn't switched or reset that chat since (its
        // chat identity still matches) and it's still unbound.
        const pending = bindAppChatOnHoverCreateRef.current
        if (pending) {
          bindAppChatOnHoverCreateRef.current = null
          const activeTab = chatTabsRef.current.find((t) => t.id === pending.tabId)
          if (activeTab && activeTab.chatId === pending.chatId && !activeTab.runId) {
            const boundSessionId = sessionId
            setChatTabs((prev) => prev.map((t) => (
              // Keep the chatId: same conversation identity getting its
              // session, exactly like a first composer send — no remount.
              t.id === pending.tabId ? { ...t, runId: boundSessionId } : t
            )))
            void loadRunRef.current?.(boundSessionId)
          }
        }
      }

      const selected = hoverSelectionRef.current
      // Hover turns default to FAST thinking when there's no explicit pick —
      // voice-to-first-word is the experience, and a long reasoning phase is
      // dead air.
      const reasoningEffort =
        selected?.effort ??
        (inCallRef.current && companionVoiceRef.current ? ('low' as const) : undefined)
      const chatMaxModelCalls = await window.ipc
        .invoke('turnLimits:getSettings', null)
        .then((settings) => settings.chatMaxModelCalls)
        .catch(() => undefined)
      const sendConfig = {
        agent: {
          agentId: 'copilot',
          overrides: {
            ...(selected ? { model: { provider: selected.provider, model: selected.model } } : {}),
            composition: {
              workDirId: sessionId,
              ...(pendingVoiceInputRef.current ? { voiceInput: true } : {}),
              ...(ttsEnabledRef.current ? { voiceOutput: ttsModeRef.current } : {}),
              ...(searchEnabled ? { searchEnabled: true } : {}),
              ...(codeMode ? { codeMode } : {}),
              ...((inCallRef.current && video.cameraOn) || video.screenState === 'live'
                ? { videoMode: true }
                : {}),
              ...(practiceModeRef.current ? { coachMode: true } : {}),
            },
          },
        },
        autoPermission: (permissionMode ?? 'auto') === 'auto',
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(chatMaxModelCalls !== undefined ? { maxModelCalls: chatMaxModelCalls } : {}),
      }
      const userMessageContext = {
        currentDateTime: `${new Date().toLocaleString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        })} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
        middlePane: { kind: 'empty' as const },
      }

      type HoverContentPart =
        | { type: 'text'; text: string }
        | { type: 'attachment'; path: string; filename: string; mimeType: string; size?: number; lineNumber?: number }
        | { type: 'image'; data: string; mediaType: string; source: 'camera' | 'screen'; capturedAt: string }
      const hasMentions = (mentions?.length ?? 0) > 0
      const content: string | HoverContentPart[] = hasAttachments || hasMentions || videoFrames.length > 0
        ? [
            ...(mentions ?? []).map((mention): HoverContentPart => ({
              type: 'attachment',
              path: mention.path,
              filename: mention.displayName || mention.path.split('/').pop() || mention.path,
              mimeType: 'text/markdown',
              ...(mention.lineNumber !== undefined ? { lineNumber: mention.lineNumber } : {}),
            })),
            ...stagedAttachments.map((attachment): HoverContentPart => ({
              type: 'attachment',
              path: attachment.path,
              filename: attachment.filename,
              mimeType: attachment.mimeType,
              size: attachment.size,
            })),
            ...(userMessage ? [{ type: 'text', text: userMessage } satisfies HoverContentPart] : []),
            ...videoFrames.map((frame): HoverContentPart => ({
              type: 'image',
              data: frame.data,
              mediaType: frame.mediaType,
              source: frame.source,
              capturedAt: frame.capturedAt,
            })),
          ]
        : userMessage

      // One retry: an in-call submit can land while the previous turn's
      // abort hasn't fully settled in the runtime.
      const payload = {
        sessionId,
        input: { role: 'user' as const, content, userMessageContext },
        config: sendConfig,
      }
      try {
        await window.ipc.invoke('sessions:sendMessage', payload)
      } catch (err) {
        console.error('[hover] sendMessage failed, retrying once:', err)
        await new Promise((resolve) => setTimeout(resolve, 600))
        await window.ipc.invoke('sessions:sendMessage', payload)
      }
      analytics.chatMessageSent({
        voiceInput: pendingVoiceInputRef.current || undefined,
        voiceOutput: ttsEnabledRef.current ? ttsModeRef.current : undefined,
        searchEnabled: searchEnabled || undefined,
      })
    } catch (err) {
      console.error('[hover] submit failed:', err)
    } finally {
      pendingVoiceInputRef.current = false
    }
  }, [video])
  handleHoverSubmitRef.current = handleHoverSubmit

  useEffect(() => {
    return window.ipc.on('quick-ask:submit', (payload) => {
      const trimmed = payload.text.trim()
      if (!trimmed && !payload.attachments?.length) return
      if (payload.model) {
        hoverSelectionRef.current = {
          provider: payload.model.provider,
          model: payload.model.model,
          ...(payload.reasoningEffort
            ? { effort: payload.reasoningEffort }
            : hoverSelectionRef.current?.effort
              ? { effort: hoverSelectionRef.current.effort }
              : {}),
        }
      } else if (payload.reasoningEffort && hoverSelectionRef.current) {
        hoverSelectionRef.current = { ...hoverSelectionRef.current, effort: payload.reasoningEffort }
      }
      void handleHoverSubmitRef.current?.(
        { text: trimmed, files: [] },
        payload.mentions,
        payload.attachments ?? [],
        payload.searchEnabled,
        payload.codeMode,
        payload.permissionMode,
      )
    })
  }, [])

  // (The old surface-based text-mode hush is gone: speech now follows each
  // question's modality, plus the explicit speaker mute below.)

  // Tuck relay (⌥⇧Space, the tray item, the card's tuck handle): the ONE
  // hover flow. Registered once (via the ref), then main is told this
  // window can take relays — a summon that arrived while this window was
  // still loading (or didn't exist yet: the user had closed it and the
  // shortcut recreated it hidden) is delivered on that handshake.
  useEffect(() => {
    const off = window.ipc.on('quick-ask:tuck', () => {
      void startHoverCallRef.current()
    })
    void window.ipc.invoke('quickAsk:appReady', null).catch(() => {})
    return off
  }, [])

  // (No answer mirror any more: a typed question on the Skipper rides the
  // SAME call mirror as a spoken one — video:popoutState — because there is
  // always a live session behind the companion now.)

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

  // Helper to cancel recording from any navigation handler. Releases the mic
  // ownership token too — a cancelled dictation must not leave its composer
  // marked as the owner (that pinned the recording UI to a dead chat id).
  const cancelRecordingIfActive = useCallback(() => {
    if (isRecordingRef.current) {
      voiceRef.current.cancel()
      setIsRecording(false)
      isRecordingRef.current = false
      const holder = voiceOwnerId()
      if (holder && holder !== CALL_VOICE_HOLDER) releaseVoice(holder)
    }
  }, [])

  // Runs history state
  type RunListItem = { id: string; title?: string; createdAt: string; modifiedAt: string; agentId: string; useCase?: string }
  const [runs, setRuns] = useState<RunListItem[]>([])

  // Chat tab state
  const [chatTabs, setChatTabs] = useState<ChatTab[]>(() => [{ id: 'default-chat-tab', runId: null, chatId: crypto.randomUUID() }])
  const chatTabsRef = useRef(chatTabs)
  chatTabsRef.current = chatTabs
  // A tab's current chat identity (see ChatTab.chatId). Session-scoped maps
  // below are keyed by chatId, not tab id, so rebinding a tab to another
  // session can never leak the previous chat's draft/model/effort into it.
  const chatIdForTab = useCallback((tabId: string) => (
    chatTabsRef.current.find((t) => t.id === tabId)?.chatId ?? tabId
  ), [])
  const [activeChatTabId] = useState('default-chat-tab')
  const [chatViewStateByTab, setChatViewStateByTab] = useState<Record<string, ChatTabViewState>>({
    'default-chat-tab': createEmptyChatTabViewState(),
  })
  const chatViewStateByTabRef = useRef(chatViewStateByTab)
  const chatDraftsRef = useRef(new Map<string, string>())
  // Per-tab selection (model + effort as ONE value) — the composer reports
  // every change (settings seed included) and reads it back on remount, so
  // a tab's selection survives tab switches for the life of the app.
  const selectionByTabRef = useRef(new Map<string, { provider: string; model: string; effort?: 'low' | 'medium' | 'high' }>())
  // Work directory is per-chat. Keyed by tab id; null/absent means none set.
  const [workDirByTab, setWorkDirByTab] = useState<Record<string, string | null>>({})
  const workDirByTabRef = useRef(workDirByTab)
  workDirByTabRef.current = workDirByTab
  const [toolOpenByTab, setToolOpenByTab] = useState<Record<string, Record<string, boolean>>>({})
  const [chatViewportAnchorByTab, setChatViewportAnchorByTab] = useState<Record<string, ChatViewportAnchorState>>({})
  const activeChatTabIdRef = useRef(activeChatTabId)
  activeChatTabIdRef.current = activeChatTabId
  const setChatDraftForTab = useCallback((tabId: string, text: string) => {
    const chatId = chatIdForTab(tabId)
    if (text) {
      chatDraftsRef.current.set(chatId, text)
    } else {
      chatDraftsRef.current.delete(chatId)
    }
  }, [chatIdForTab])
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
  // `undefined` = no explicit user choice — TurnConversation then applies the
  // per-tool default (coding-run cards open, everything else closed).
  const isToolOpenForTab = useCallback((tabId: string, toolId: string): boolean | undefined => {
    return toolOpenByTab[tabId]?.[toolId]
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
  const getChatTabTitle = useCallback((tab: ChatTab) => {
    if (!tab.runId) return 'New chat'
    return runs.find(r => r.id === tab.runId)?.title || '(Untitled chat)'
  }, [runs])


  // The Code section is a plain section boolean like every other section. (It
  // used to be derived from a sentinel entry in an editor-style tab strip,
  // which made it the ONE section bulk section-clears couldn't close — the
  // root of a whole family of stuck/inert-UI navigation bugs.)
  const [isCodeOpen, setIsCodeOpen] = useState(false)
  // The code session that owns the right-hand chat pane: selecting a session
  // binds the assistant chat to it (a code session IS a chat session).
  const [activeCodeSession, setActiveCodeSession] = useState<ActiveCodeSession | null>(null)
  // Deep-link into the Code section (a Home Deck strip's door): select this
  // session when the view opens, then clear.
  const [codeFocusSessionId, setCodeFocusSessionId] = useState<string | null>(null)
  // The code rail's width (drag-resizable, persisted by its SecondaryRail
  // shell) — the middle pane hugs it while a session's chat is the main
  // surface. The rail reports before first paint, so the default never shows.
  const [codeRailWidth, setCodeRailWidth] = useState(280)
  // A file the code chat asked to review — consumed by the workspace drawer.
  const [codeDiffPath, setCodeDiffPath] = useState<string | null>(null)
  // Which workspace panel (changes / files / terminal) is open beside the
  // code chat, if any. The chat is the main surface; these are a button away.
  const [codePanel, setCodePanel] = useState<CodePanel | null>(null)
  // Working-tree status of the selected code session — the chat header shows
  // the changed-file count even while the drawer is closed.
  const codeGit = useCodeGitStatus(activeCodeSession?.session.id ?? null, activeCodeSession?.status ?? 'idle')
  // Composer locks for runs that are code sessions: the session's cwd + agent
  // are frozen in the chat input (the backend pins them server-side anyway).
  // Kept after the Code view unmounts — the chat stays bound to the session.
  const [codeSessionLocks, setCodeSessionLocks] = useState<Record<string, { cwd: string; agent: 'claude' | 'codex' }>>({})
  const codeSessionLocksRef = useRef(codeSessionLocks)
  codeSessionLocksRef.current = codeSessionLocks
  // Undo/redo handlers of the (single) mounted markdown editor.
  const fileHistoryHandlersRef = useRef<MarkdownHistoryHandlers | null>(null)
  // Bumped when a file's content is reloaded from disk behind the editor's
  // back — remounts the editor session (clears undo history) for that path.
  const [editorSessionByPath, setEditorSessionByPath] = useState<Record<string, number>>({})

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
      // The legacy mirrors this snapshot is built from never carried usage,
      // so inactive tabs showed zero tokens; take it from the live session
      // store instead.
      sessionUsage: sessionChat.chatState?.sessionUsage ?? {},
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
    sessionChat.chatState,
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

  const bumpDocumentRevisionForPath = useCallback((path: string) => {
    const revisions = documentRevisionByPathRef.current
    revisions.set(path, (revisions.get(path) ?? 0) + 1)
  }, [])

  const setInitialContentForPath = useCallback((path: string, content: string) => {
    initialContentByPathRef.current.set(path, content)
    bumpDocumentRevisionForPath(path)
  }, [bumpDocumentRevisionForPath])

  const deleteInitialContentForPath = useCallback((path: string) => {
    initialContentByPathRef.current.delete(path)
    bumpDocumentRevisionForPath(path)
  }, [bumpDocumentRevisionForPath])

  const removeEditorCacheForPath = useCallback((path: string) => {
    editorContentByPathRef.current.delete(path)
    setEditorContentByPath((prev) => {
      if (!(path in prev)) return prev
      const next = { ...prev }
      delete next[path]
      return next
    })
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
    setInitialContentForPath(path, body)
    initialContentRef.current = body
    setLastSaved(new Date())
    setEditorSessionByPath((prev) => ({ ...prev, [path]: (prev[path] ?? 0) + 1 }))
  }, [setEditorCacheForPath, setInitialContentForPath])

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
    try {
      await window.ipc.invoke('google-docs:refreshSnapshot', { path })
      await reloadMarkdownFileIntoEditor(path)
      toast.success('Pulled latest Google Doc')
    } catch (err) {
      console.error('Failed to sync Google Doc down:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to pull Google Doc')
    } finally {
      setGoogleDocSyncDirection(null)
    }
  }, [reloadMarkdownFileIntoEditor])

  const syncGoogleDocUp = useCallback(async (targetPath?: string) => {
    const path = targetPath ?? selectedPathRef.current
    if (!path || !path.startsWith('knowledge/') || !path.endsWith('.md')) return

    const body = editorContentByPathRef.current.get(path) ?? editorContentRef.current
    const markdown = joinFrontmatter(frontmatterByPathRef.current.get(path) ?? null, body)
    setGoogleDocSyncDirection('up')
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
      await reloadMarkdownFileIntoEditor(path)
      toast.success('Pushed changes to Google Doc')
    } catch (err) {
      console.error('Failed to sync Google Doc up:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to push Google Doc')
    } finally {
      setGoogleDocSyncDirection(null)
    }
  }, [reloadMarkdownFileIntoEditor])
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

      // Initial hydration owns its read until editorPath/baseline are ready.
      // Record every Markdown event so that loader can detect an in-flight
      // stale snapshot and repeat the read instead of losing this notification.
      for (const path of new Set(eventPaths)) {
        if (!path.endsWith('.md')) continue
        const revisions = externalChangeRevisionByPathRef.current
        revisions.set(path, (revisions.get(path) ?? 0) + 1)
      }

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
        deleteInitialContentForPath(path)
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
        await reloadCleanActiveMarkdownAfterExternalChange({
          path: pathToReload,
          getSelectedPath: () => selectedPathRef.current,
          getEditorPath: () => editorPathRef.current,
          getEditorContent: () => editorContentRef.current,
          getBaseline: () => initialContentByPathRef.current.get(pathToReload),
          getDocumentRevision: () => documentRevisionByPathRef.current.get(pathToReload) ?? 0,
          invalidateCache: () => {
            removeEditorCacheForPath(pathToReload)
          },
          beginRequest: () => (fileLoadRequestIdRef.current += 1),
          isCurrentRequest: (requestId) => fileLoadRequestIdRef.current === requestId,
          readFile: () => window.ipc.invoke('workspace:readFile', { path: pathToReload }),
          getDiskEditorContent: (data) => splitFrontmatter(data).body,
          applyReload: (data) => {
            setFileContent(data)
            const { raw: fm, body } = splitFrontmatter(data)
            frontmatterByPathRef.current.set(pathToReload, fm)
            setEditorContent(body)
            setEditorCacheForPath(pathToReload, body)
            editorContentRef.current = body
            editorPathRef.current = pathToReload
            setInitialContentForPath(pathToReload, body)
            initialContentRef.current = body
          },
          applyUnchangedReload: (data) => {
            setFileContent(data)
            const { raw: fm, body } = splitFrontmatter(data)
            frontmatterByPathRef.current.set(pathToReload, fm)
            setEditorCacheForPath(pathToReload, body)
            setInitialContentForPath(pathToReload, body)
            initialContentRef.current = body
          },
          onReadError: (error) => console.error('Failed to reload externally changed file:', error),
        })
      }
    })
    return cleanup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteInitialContentForPath, loadDirectory, removeEditorCacheForPath, setEditorCacheForPath, setInitialContentForPath])

  // Load file content when selected
  useEffect(() => {
    const requestId = (fileLoadRequestIdRef.current += 1)
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
        const result = await readFileAfterExternalChangesSettle({
          getExternalRevision: () => externalChangeRevisionByPathRef.current.get(pathToLoad) ?? 0,
          isCurrent: () => (
            !cancelled
            && fileLoadRequestIdRef.current === requestId
            && selectedPathRef.current === pathToLoad
          ),
          readFile: () => window.ipc.invoke('workspace:readFile', { path: pathToLoad }),
        })
        if (!result) return
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
          setInitialContentForPath(pathToLoad, body)
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
  }, [selectedPath, setEditorCacheForPath, setInitialContentForPath])

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
                // Migrate frontmatter entry
                const fmEntry = frontmatterByPathRef.current.get(pathAtStart)
                frontmatterByPathRef.current.delete(pathAtStart)
                frontmatterByPathRef.current.set(targetPath, fmEntry ?? null)
                deleteInitialContentForPath(pathAtStart)
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
        analytics.noteEdited(pathToSave)
        // Store body-only baseline (matches what debouncedContent compares against)
        setInitialContentForPath(pathToSave, splitFrontmatter(contentToSave).body)

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
  }, [debouncedContent, deleteInitialContentForPath, setHistory, setInitialContentForPath])

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
        // Re-sort: chat-header slices the top of this list without sorting,
        // so it must stay newest-first like sessions:list.
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
      // Restore the session's per-chat work directory into the tab BOUND to
      // this run when one exists — targeting the active tab is racy under
      // fast switching (the guard below narrows but can't close the gap).
      const tabId = chatTabsRef.current.find((t) => t.runId === id)?.id
        ?? activeChatTabIdRef.current
      const wd = await loadRunWorkDir(id)
      if (loadRunRequestIdRef.current !== requestId) return
      setWorkDirByTab((prev) => ({ ...prev, [tabId]: wd }))
    } catch (err) {
      console.error('Failed to load session work dir:', err)
    }
  }, [loadRunWorkDir])
  loadRunRef.current = loadRun

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

          // Coding-run cards stay expanded after the run settles — the card is
          // the primary output surface (the assistant only confirms in a line).
          if (event.toolCallId && event.toolName !== 'code_agent_run') {
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
    | { kind: 'deck'; path: string; slideNumber: number; slideCount: number }
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

    const path = selectedPathRef.current
    if (!path) return undefined

    // Deck case: a .pptx open in the slide editor. The predicate matches the
    // one that mounts PptxEditor, so the context and the editor can't drift.
    // No content — a deck's content is what deck-review reads.
    if (getViewerType(path) === 'pptx') {
      const deck = deckStateRef.current
      if (!deck || deck.path !== path) return undefined
      return {
        kind: 'deck',
        path,
        slideNumber: deck.slideNumber,
        slideCount: deck.slideCount,
      }
    }

    // Note case: only markdown files are meaningfully readable as context.
    if (!path.endsWith('.md')) return undefined
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
    if (activeIsProcessing && inCallRef.current) {
      // In-call input arrives at arbitrary moments — a hard
      // drop here silently ate utterances submitted while the previous turn
      // was still stopping (the PTT interrupt is async). Finish the stop and
      // proceed with this message instead. Ordinary typed sends proceed while
      // busy: sessions:sendOrQueueMessage queues them to steer the live turn.
      await stopRunRef.current?.()
    }

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

    // Modality decides speech on calls: a TYPED question (composer, Skipper
    // panel, popout input) renders its reply silently; a SPOKEN one (PTT
    // utterance — pendingVoiceInputRef is set just before submit) is spoken
    // even with the text panel open. Stamped per-turn so tucking or typing
    // mid-reply never flips an in-flight answer.
    suppressSpeechTurnRef.current = inCallRef.current && !pendingVoiceInputRef.current

    if (inCallRef.current) {
      // A new question supersedes whatever of the previous reply was still
      // unspoken — silence it and drop the frozen backlog so it never plays
      // over the new turn. (The overlay resets its segment list when the
      // new turn starts; the segment player detects that shrink and
      // restarts from the top.)
      ttsRef.current.cancel()
      if (voiceSegmentsRef.current) {
        spokenVoiceRef.current.count = voiceSegmentsRef.current.length
      }
      // Bookkeeping for the fallback-speech net: if this call turn ends with
      // no <voice> segment spoken, the reply text itself gets read aloud.
      spokeSegmentThisTurnRef.current = false
      callTurnVoiceRef.current = {
        pending: true,
        submitAt: Date.now(),
      }
    }

    // Frames ride along whenever screen capture is live — during calls, and
    // for quick-ask questions with the share toggle on.
    const videoFrames =
      inCallRef.current || video.screenState === 'live' ? video.collectFrames() : []

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
      const selected = selectionByTabRef.current.get(chatIdForTab(submitTabId))
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
      // Effort rides the ModelSelection. Hover-mode turns (companion voice
      // sessions) default to FAST thinking when there's no explicit pick —
      // voice-to-first-word is the experience, and a long reasoning phase
      // is dead air.
      const reasoningEffort =
        selected?.effort ??
        (inCallRef.current && companionVoiceRef.current ? ('low' as const) : undefined)
      // The runtime defaults omitted maxModelCalls to the global limit; the
      // chat-specific override is the UI's job to pass explicitly. A failed
      // settings read just falls back to the global limit.
      const chatMaxModelCalls = await window.ipc
        .invoke('turnLimits:getSettings', null)
        .then((settings) => settings.chatMaxModelCalls)
        .catch(() => undefined)
      // A to-do item's session keeps its own agent on continuation — typing
      // in that chat steers the item's work, it doesn't summon the copilot.
      const sessionAgentId = runs.find((r) => r.id === currentRunId)?.agentId
      const effectiveAgentId = sessionAgentId === 'todo-item-agent' ? sessionAgentId : agentId
      const sendConfig = {
        agent: {
          agentId: effectiveAgentId,
          overrides: {
            ...(selected ? { model: { provider: selected.provider, model: selected.model } } : {}),
            composition: {
              workDirId: currentRunId,
              ...(pendingVoiceInputRef.current ? { voiceInput: true } : {}),
              ...(ttsEnabledRef.current ? { voiceOutput: ttsModeRef.current } : {}),
              ...(searchEnabled ? { searchEnabled: true } : {}),
              // Code-session pins: a bound chat always carries the session's
              // agent + cwd, so voice/quick-ask submits (which don't thread
              // the composer chip) still assemble the code-mode prompt. The
              // backend pins these server-side regardless.
              ...(currentRunId && codeSessionLocksRef.current[currentRunId]
                ? {
                    codeMode: codeMode ?? codeSessionLocksRef.current[currentRunId].agent,
                    codeCwd: codeSessionLocksRef.current[currentRunId].cwd,
                  }
                : (codeMode ? { codeMode } : {})),
              ...((inCallRef.current && video.cameraOn) || video.screenState === 'live'
                ? { videoMode: true }
                : {}),
              ...(practiceModeRef.current ? { coachMode: true } : {}),
            },
          },
        },
        // Default matches the composer toggle's default (auto): submissions
        // that don't thread a mode — voice/PTT utterances, quick-ask, popout
        // text — must not silently fall back to manual, which skipped the
        // auto-permission classifier and carded EVERY gated tool mid-call.
        autoPermission: (permissionMode ?? 'auto') === 'auto',
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(chatMaxModelCalls !== undefined ? { maxModelCalls: chatMaxModelCalls } : {}),
      }
      const userMessageContextFor = (middlePane: Awaited<ReturnType<typeof buildMiddlePaneContext>>) => {
        // One-shot: the stale-frames notice rides on exactly one message.
        const screenShareEnded = screenShareEndedRef.current
        screenShareEndedRef.current = false
        return {
          // Local wall-clock with explicit timezone, never toISOString: the model
          // adopts this as its time frame, so a UTC "now" makes it quote email
          // timestamps (which carry their own offsets) in UTC instead of local.
          currentDateTime: `${new Date().toLocaleString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZoneName: 'short',
          })} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
          middlePane: middlePane ?? { kind: 'empty' as const },
          ...(screenShareEnded ? { screenShareEnded: true } : {}),
        }
      }

      // Deliver-ASAP: a busy session queues the message (it steers the live
      // turn at the next model-call boundary or starts the next turn), so a
      // mid-turn send is never rejected or dropped.
      const sendSessionMessage = (payload: Parameters<typeof window.ipc.invoke<'sessions:sendOrQueueMessage'>>[1]) =>
        window.ipc.invoke('sessions:sendOrQueueMessage', payload)

      let sendResult: Awaited<ReturnType<typeof sendSessionMessage>>
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
          const mentionMimeTypes: Record<string, string> = {
            xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            xls: 'application/vnd.ms-excel',
            csv: 'text/csv',
            tsv: 'text/tab-separated-values',
          }
          for (const mention of mentions) {
            const ext = mention.path.split('.').pop()?.toLowerCase() ?? ''
            contentParts.push({
              type: 'attachment',
              path: mention.path,
              filename: mention.displayName || mention.path.split('/').pop() || mention.path,
              mimeType: mentionMimeTypes[ext] ?? 'text/markdown',
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
        sendResult = await sendSessionMessage({
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
        sendResult = await sendSessionMessage({
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

      // Queued (the latest turn was still running): there is no turn for
      // this message yet — the pending chip above the composer represents it,
      // and the real bubble arrives via turn events when it is delivered.
      // Retract the optimistic bubble so it can't double-render.
      if (sendResult.queued) {
        setConversation((prev) => prev.filter((item) => item.id !== userMessageId))
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
      // Stop drains the pending queue (queued messages must not auto-start
      // after an explicit stop) — restore their text into the composer so
      // nothing the user typed is lost.
      const dequeued = await sessionChat.stop()
      const drainedText = dequeued
        .map((entry) => queuedMessageText(entry.message))
        .filter(Boolean)
        .join('\n\n')
      if (drainedText) {
        const draft = chatDraftsRef.current
          .get(chatIdForTab(activeChatTabIdRef.current))
          ?.trim()
        setPresetMessage(draft ? `${draft}\n\n${drainedText}` : drainedText)
      }
    } catch (error) {
      console.error('Failed to stop turn:', error)
    }
  }, [runId, sessionChat, chatIdForTab])
  stopRunRef.current = handleStop

  // Pending-queue chips (messages sent while the turn was running): ✕
  // discards the message; clicking the chip body pulls it back out of the
  // queue and into the composer for editing.
  const handleRemoveQueued = useCallback((queueId: string) => {
    sessionChat.removeQueued(queueId).catch((error) => {
      console.error('Failed to remove queued message:', error)
    })
  }, [sessionChat])

  const handlePullQueued = useCallback(async (queueId: string) => {
    try {
      const removed = await sessionChat.removeQueued(queueId)
      const text = removed ? queuedMessageText(removed.message) : ''
      if (text) setPresetMessage(text)
    } catch (error) {
      console.error('Failed to pull back queued message:', error)
    }
  }, [sessionChat])

  const handlePermissionResponse = useCallback(async (
    toolCallId: string,
    subflow: string[],
    response: 'approve' | 'deny',
  ) => {
    if (!runId) return

    void subflow // subflows retired with the runs runtime
    try {
      await sessionChat.respondToPermission(
        toolCallId,
        response === 'approve' ? 'allow' : 'deny',
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
    // A brand-new chat starts with no work directory and restarts its
    // selection from the settings pair (the composer re-seeds when its
    // runId prop drops to null; clearing here keeps the map in lockstep).
    setWorkDirByTab(prev => ({ ...prev, [activeChatTabIdRef.current]: null }))
    selectionByTabRef.current.delete(chatIdForTab(activeChatTabIdRef.current))
  }, [setChatViewportAnchor])

  // Bind the single chat surface to a session. THE one way any part of the
  // app points the chat at a conversation (recents, history, Home threads,
  // code sessions, quick-ask). No-ops when already bound; otherwise rebinds
  // with a fresh chat identity (remounts pane + composer, drops drafts).
  const bindChatToRun = useCallback((rid: string) => {
    const active = chatTabsRef.current.find((t) => t.id === activeChatTabIdRef.current)
    if (active?.runId === rid) return
    // Cancel any active dictation — its transcript belongs to the old chat.
    cancelRecordingIfActive()
    setChatTabs((prev) => prev.map((t) => (
      // Rebinding to a different session = a different chat identity — but a
      // DETERMINISTIC one (the session id), so switching A→B→A restores A's
      // draft/selection instead of silently dropping half-typed input.
      t.id === activeChatTabIdRef.current ? { ...t, runId: rid, chatId: rid } : t
    )))
    void loadRun(rid)
  }, [cancelRecordingIfActive, loadRun])
  bindChatToRunRef.current = bindChatToRun

  // A code session was selected in the Code view: bind the chat to it — the
  // conversation IS the assistant chat, no separate chat surface. No local
  // "already bound" guard here: bindChatToRun dedupes on the live binding,
  // and a stale guard is exactly how re-selecting a session after opening
  // another chat used to do nothing (the stuck-binding family).
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
    const sessionId = active?.session.id ?? null
    if (!sessionId) return
    bindChatToRun(sessionId)
    // The conversation lives in the dock — selecting a session must show it.
    setIsChatSidebarOpen(true)
  }, [bindChatToRun])

  // Chat-header doors to the workspace drawer: clicking the open one closes it.
  const toggleCodePanel = useCallback((panel: CodePanel) => {
    setCodePanel((prev) => (prev === panel ? null : panel))
  }, [])
  // A changed file clicked inside a coding run: open the drawer on its diff.
  const openCodeDiff = useCallback((path: string) => {
    setCodeDiffPath(path)
    setCodePanel('changes')
  }, [])
  const handleCodeDiffOpened = useCallback(() => setCodeDiffPath(null), [])

  // Reading-position persistence across pane remounts (view toggles,
  // dock/full-screen switches, run rebinds) lives inside the conversation
  // scroll controller now — see lib/chat-scroll.ts (keyed by tab.chatId).

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
    if (isSpacesOpen) return spaceSelection ? { type: 'spaces', orgId: spaceSelection.orgId, spaceId: spaceSelection.spaceId, rail: railSelection } : { type: 'spaces' }
    if (selectedPath) return { type: 'file', path: selectedPath }
    if (isGraphOpen) return { type: 'graph' }
    return { type: 'chat', runId }
  }, [selectedBackgroundTask, isEmailOpen, isMeetingsOpen, isLiveNotesOpen, isBgTasksOpen, isAppsOpen, isSpacesOpen, spaceSelection, railSelection, isSuggestedTopicsOpen, selectedPath, isGraphOpen, isWorkspaceOpen, isKnowledgeViewOpen, knowledgeViewFolderPath, knowledgeViewMode, isChatHistoryOpen, isHomeOpen, isCodeOpen, workspaceInitialPath, runId])

  // Navigation handlers can be invoked from closures frozen in older renders
  // (Spaces' MessageRow memoizes by data and ignores handler identity), so
  // dedupe/history logic must read the view state through this render-filled
  // ref — a captured `currentViewState` can be stale, making "already there"
  // checks eat real navigations.
  const currentViewStateRef = useRef(currentViewState)
  currentViewStateRef.current = currentViewState

  // applyViewState is declared further down (it needs the chat-binding
  // helpers); handlers above it reach it through this render-filled ref.
  const applyViewStateRef = useRef<((view: ViewState) => Promise<void>) | null>(null)

  // Header title for the current view (the tab strip is gone — the header
  // names where you are instead).
  const { orgs: spacesOrgs } = useSpacesOrgs()
  const currentViewTitle = React.useMemo(() => {
    switch (currentViewState.type) {
      case 'home': return 'Home'
      case 'chat': return 'Chat'
      case 'chat-history': return 'Chat history'
      case 'code': return 'Code'
      case 'email': return 'Email'
      case 'meetings': return 'Meetings'
      case 'live-notes': return 'Live notes'
      case 'bg-tasks': return 'Background tasks'
      case 'apps': return 'Apps'
      case 'spaces': {
        const org = spacesOrgs.find((o) => o.id === currentViewState.orgId)
        return org?.spaces.find((sp) => sp.id === currentViewState.spaceId)?.name ?? 'Spaces'
      }
      case 'workspace': return 'Workspace'
      case 'knowledge-view': return 'Brain'
      case 'graph': return 'Graph View'
      case 'suggested-topics': return 'Suggested Topics'
      case 'task': return currentViewState.name
      case 'file': {
        const path = currentViewState.path
        if (path === BASES_DEFAULT_TAB_PATH) return 'Bases'
        if (path.endsWith('.base')) return path.split('/').pop()?.replace(/\.base$/i, '') || 'Base'
        return path.split('/').pop()?.replace(/\.md$/i, '') || path
      }
    }
  }, [currentViewState, spacesOrgs])

  // Close every section flag — THE single place a section switch resets the
  // rest of the world. Every navigation path funnels through this (via
  // applyViewState or directly), so no switch can leave two sections both
  // claiming the screen, or a section flag stuck on with no way to clear it.
  const closeAllSections = useCallback(() => {
    setSelectedPath(null)
    setIsGraphOpen(false)
    setIsBrowserOpen(false)
    setIsSuggestedTopicsOpen(false)
    setIsMeetingsOpen(false)
    setIsLiveNotesOpen(false)
    setIsBgTasksOpen(false)
    setIsAppsOpen(false)
    setIsSpacesOpen(false)
    setIsEmailOpen(false)
    setIsWorkspaceOpen(false)
    setIsKnowledgeViewOpen(false)
    setIsChatHistoryOpen(false)
    setIsHomeOpen(false)
    setIsCodeOpen(false)
    setSelectedBackgroundTask(null)
    setExpandedFrom(null)
    setIsRightPaneMaximized(false)
  }, [])

  const handleNewChatTab = useCallback(() => {
    // Single-chat model: reset the one conversation in place instead of
    // opening a new tab. Fresh chatId = fresh chat-session instance.
    setChatTabs([{ id: activeChatTabIdRef.current, runId: null, chatId: crypto.randomUUID() }])
    dismissBrowserOverlay()
    handleNewChat()
    // "New chat" opens the full-screen chat; remember where we came from so
    // closing it can restore the section.
    const from = currentViewState.type === 'chat' ? null : currentViewState
    closeAllSections()
    setExpandedFrom(from)
  }, [dismissBrowserOverlay, handleNewChat, closeAllSections, currentViewState])

  // Sidebar variant: reset the chat in place without leaving file/graph context.
  // A caller with a selection already chosen for the fresh chat (the Home
  // composer handoff) passes it here so the map entry exists BEFORE the
  // rebind commit — the remounted composer's initialSelection then shows the
  // same pair the sends will use, instead of racing the settings seed.
  const handleNewChatTabInSidebar = useCallback((initialSelection?: ModelSelection | null) => {
    const chatId = crypto.randomUUID()
    if (initialSelection) selectionByTabRef.current.set(chatId, initialSelection)
    setChatTabs([{ id: activeChatTabIdRef.current, runId: null, chatId }])
    handleNewChat()
  }, [handleNewChat])

  // A chat was deleted (sessions:delete succeeded): drop it from the recents
  // list, and if it was the one on screen, reset the chat surface in place to
  // a fresh conversation so a dead transcript never stays visible.
  const handleRunDeleted = useCallback((rid: string) => {
    setRuns((prev) => prev.filter((r) => r.id !== rid))
    // The companion must not keep pointing at a deleted conversation.
    if (hoverRunIdRef.current === rid) {
      hoverRunIdRef.current = null
      setHoverRunId(null)
    }
    const openTab = chatTabs.find((t) => t.runId === rid)
    if (!openTab) return
    handleNewChatTabInSidebar()
  }, [chatTabs, handleNewChatTabInSidebar])

  // The companion's "+": a fresh COMPANION conversation for its next
  // question. The app window's chat is untouched.
  useEffect(() => {
    return window.ipc.on('quick-ask:new-chat', () => {
      setHoverRunId(null)
    })
  }, [])

  // Companion-bar chat context: which conversation the companion is bound to
  // (shown as the companion's destination chip) plus recents for its switcher.
  // This is the HOVER binding — the app window's chat plays no part in it.
  useEffect(() => {
    void window.ipc
      .invoke('quickAsk:chatContext', {
        activeRunId: hoverRunId,
        activeTitle: hoverRunId
          ? (runs.find((r) => r.id === hoverRunId)?.title || '(Untitled chat)')
          : null,
        recent: runs.slice(0, 10).map((r) => ({ id: r.id, title: r.title || '(Untitled chat)' })),
      })
      .catch(() => {})
  }, [hoverRunId, runs])

  // The bar's chip switcher picked a chat: rebind the COMPANION to it. The
  // app window keeps showing whatever it was showing. The Command Center
  // sentinel resolves to THE standing operator session (created on first
  // use) — its frame rides server-side composition pins, so nothing else
  // here changes.
  useEffect(() => {
    return window.ipc.on('quick-ask:select-chat', ({ runId: rid }) => {
      if (rid === COMMAND_CENTER_CHAT_SENTINEL) {
        void window.ipc.invoke('home:commandCenter', {})
          .then(({ sessionId }) => setHoverRunId(sessionId))
          .catch(() => {})
        return
      }
      setHoverRunId(rid)
    })
  }, [])

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

  // Home composer → a fresh dock chat. Same settle-then-flush dance as the
  // palette: the fresh tab's null runId must be visible to handlePromptSubmit
  // before the message goes out. Model/effort picked on the Home composer are
  // copied onto the fresh tab at flush time.
  // The Home composer's selection (model + effort as one value) — handed to
  // todo:* calls and onto the chat tab a home submit turns into.
  const homeSelectionRef = useRef<ModelSelection | null>(null)
  // Destination chip: when set, the Home composer writes to the to-do list
  // instead of the chat. Entered via the list's ＋ affordances, announced by
  // the chip + tint, cleared on send/Escape/✕.
  const [homeComposeTarget, setHomeComposeTarget] = useState<HomeComposeTarget | null>(null)
  const [homeComposerFocusSignal, setHomeComposerFocusSignal] = useState(0)
  const [homeComposerPreset, setHomeComposerPreset] = useState<string | undefined>(undefined)
  // Code dispatch from Home (the Helm): an optional repo lane for the to-do
  // being composed. Picking a lane makes the item a real code session
  // (worktree by default) before its first turn — see todo:addItem `code`.
  const [homeCodeProjects, setHomeCodeProjects] = useState<{ id: string; name: string; path: string }[]>([])
  const [homeCodeProject, setHomeCodeProject] = useState<{ id: string; name: string; path: string } | null>(null)
  const [homeCodeIsolation, setHomeCodeIsolation] = useState<'worktree' | 'in-repo'>('worktree')
  const homeCodeProjectRef = useRef(homeCodeProject)
  useEffect(() => { homeCodeProjectRef.current = homeCodeProject }, [homeCodeProject])
  const homeCodeIsolationRef = useRef(homeCodeIsolation)
  useEffect(() => { homeCodeIsolationRef.current = homeCodeIsolation }, [homeCodeIsolation])
  const [homeDefaultProjectId, setHomeDefaultProjectId] = useState<string | null>(null)
  useEffect(() => {
    if (homeComposeTarget?.kind !== 'todo') return
    let cancelled = false
    void Promise.all([
      window.ipc.invoke('codeProject:list', null),
      window.ipc.invoke('codeMode:getConfig', null).catch(() => null),
    ]).then(([list, config]) => {
      if (cancelled) return
      const projects = list.projects.map((p) => ({ id: p.project.id, name: p.project.name, path: p.project.path }))
      // The default repo (explicit, or the only one registered) leads the
      // lane row — one click, and it's the same repo voice dispatch uses.
      const defaultId = config?.defaultProjectId ?? (projects.length === 1 ? projects[0].id : null)
      setHomeDefaultProjectId(defaultId)
      setHomeCodeProjects(defaultId
        ? [...projects.filter((p) => p.id === defaultId), ...projects.filter((p) => p.id !== defaultId)]
        : projects)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [homeComposeTarget?.kind])
  useEffect(() => {
    // The lane lives and dies with the destination chip.
    if (!homeComposeTarget) {
      setHomeCodeProject(null)
      setHomeCodeIsolation('worktree')
    }
  }, [homeComposeTarget])
  const composeTodoOnHome = useCallback((target: HomeComposeTarget) => {
    setHomeComposeTarget(target)
    if ((target.kind === 'todo' || target.kind === 'sub') && target.prefill) {
      // Mid-thought handoff from an inline row — carry the typed text along.
      setHomeComposerPreset(target.prefill.endsWith(' ') ? target.prefill : `${target.prefill} `)
    }
    setHomeComposerFocusSignal((n) => n + 1)
  }, [])
  const [pendingHomeSubmit, setPendingHomeSubmit] = useState<{
    message: PromptInputMessage
    mentions?: FileMention[]
    attachments: StagedAttachment[]
    searchEnabled?: boolean
    codeMode?: 'claude' | 'codex'
    permissionMode?: PermissionMode
  } | null>(null)

  const handleHomeComposerSubmit = useCallback((
    message: PromptInputMessage,
    mentions?: FileMention[],
    stagedAttachments: StagedAttachment[] = [],
    searchEnabled?: boolean,
    codeMode?: 'claude' | 'codex',
    permissionMode?: PermissionMode,
  ) => {
    const text = message.text?.trim() ?? ''
    if (!text && stagedAttachments.length === 0) return
    // Destination chip set → this is a to-do (or a step), not a chat. The
    // composer's attachments become links on the line; its model selection
    // rides along for the run when the item is delegated.
    const target = homeComposeTargetRef.current
    if (target) {
      if (!text) return
      const attachments = stagedAttachments.length > 0
        ? stagedAttachments.map((a) => ({ path: a.path, name: a.filename }))
        : undefined
      // The full selection — model plus its paired reasoning effort —
      // rides todo:* into the runner, matching chat.
      const model = homeSelectionRef.current
        ? { provider: homeSelectionRef.current.provider, model: homeSelectionRef.current.model, effort: homeSelectionRef.current.effort }
        : undefined
      if (target.kind === 'comment') {
        void window.ipc.invoke('todo:comment', { key: target.key, message: text, attachments, model, permissionMode })
      } else if (target.kind === 'chatReply') {
        void window.ipc.invoke('todo:chatReply', { sessionId: target.sessionId, message: text, attachments, model, permissionMode })
      } else if (target.kind === 'sub') {
        void window.ipc.invoke('todo:addSubItem', { parentKey: target.parentKey, text, run: /(^|\s)@rowboat\b/i.test(text), attachments, model, permissionMode })
      } else {
        // A picked code lane is delegation intent as explicit as @rowboat —
        // the item runs immediately in its repo.
        const codeProject = homeCodeProjectRef.current
        const code = codeProject
          ? { projectId: codeProject.id, agent: codeMode, isolation: homeCodeIsolationRef.current }
          : undefined
        void window.ipc.invoke('todo:addItem', { text, run: /(^|\s)@rowboat\b/i.test(text) || !!code, attachments, model, permissionMode, code })
      }
      setHomeComposeTarget(null)
      return
    }
    // Chat mode has NO routing rules: mentions here just address the
    // assistant. Tasks are born via the chip, the list, or by asking.
    setIsChatSidebarOpen(true)
    handleNewChatTabInSidebar(homeSelectionRef.current)
    setPendingHomeSubmit({ message, mentions, attachments: stagedAttachments, searchEnabled, codeMode, permissionMode })
  }, [handleNewChatTabInSidebar])
  handleHomeComposerSubmitRef.current = handleHomeComposerSubmit
  const homeComposeTargetRef = useRef(homeComposeTarget)
  useEffect(() => { homeComposeTargetRef.current = homeComposeTarget }, [homeComposeTarget])

  useEffect(() => {
    if (!pendingHomeSubmit) return
    const tabId = activeChatTabIdRef.current
    if (homeSelectionRef.current) selectionByTabRef.current.set(chatIdForTab(tabId), homeSelectionRef.current)
    void handlePromptSubmitRef.current?.(
      pendingHomeSubmit.message,
      pendingHomeSubmit.mentions,
      pendingHomeSubmit.attachments,
      pendingHomeSubmit.searchEnabled,
      pendingHomeSubmit.codeMode,
      pendingHomeSubmit.permissionMode,
    )
    setPendingHomeSubmit(null)
  }, [pendingHomeSubmit])

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
    // Remember where we came from so the close button can return.
    const from = currentViewState.type === 'chat' ? null : currentViewState
    dismissBrowserOverlay()
    closeAllSections()
    setExpandedFrom(from)
  }, [closeAllSections, currentViewState, dismissBrowserOverlay])

  const handleCloseFullScreenChat = useCallback((): boolean => {
    if (!expandedFrom) return false
    const target = expandedFrom
    setExpandedFrom(null)
    void applyViewStateRef.current?.(target)
    return true
  }, [expandedFrom])

  // Feature-importance funnel: one event per view the user lands on. Keyed on
  // the view *type* so switching files/threads inside a view doesn't re-fire.
  useEffect(() => {
    analytics.viewOpened(currentViewState.type)
  }, [currentViewState.type])

  // Safety net: Radix modal dialogs set `pointer-events: none` on <body> and
  // restore it on close — but a navigation that unmounts the dialog's owner
  // (deep link, assistant navigation, tour) skips the restore and leaves the
  // whole window inert. Any view change clears the lock.
  useEffect(() => {
    if (document.body.style.pointerEvents === 'none') {
      document.body.style.pointerEvents = ''
    }
    // Keyed on the whole view state (not just .type): file→file navigation
    // must also clear the lock.
  }, [currentViewState])

  const appendUnique = useCallback((stack: ViewState[], entry: ViewState) => {
    const last = stack[stack.length - 1]
    if (last && viewStatesEqual(last, entry)) return stack
    return [...stack, entry]
  }, [])

  // Make a ViewState the world: close every section, then open the one the
  // view names. Because closeAllSections resets everything (including Code,
  // which used to live outside this system as a sentinel tab), applying a
  // view can never strand a stale section on screen.
  const applyViewState = useCallback(async (view: ViewState) => {
    // Whether this navigation ENTERS Spaces (vs a click within it) — read
    // before closeAllSections resets the flag.
    const wasSpacesOpen = isSpacesOpen
    closeAllSections()
    switch (view.type) {
      case 'file':
        setSelectedPath(view.path)
        return
      case 'graph':
        setIsGraphOpen(true)
        return
      case 'task':
        setSelectedBackgroundTask(view.name)
        return
      case 'suggested-topics':
        setIsSuggestedTopicsOpen(true)
        return
      case 'meetings':
        setIsMeetingsOpen(true)
        return
      case 'live-notes':
        setIsLiveNotesOpen(true)
        return
      case 'email':
        setIsEmailOpen(true)
        // Deep links (e.g. a new-email notification) carry the thread to open;
        // bump the version so EmailView re-selects it even if email is already open.
        if (view.threadId) {
          setEmailInitialThreadId(view.threadId)
          setEmailThreadIdVersion((v) => v + 1)
        }
        if (view.searchQuery) {
          setEmailInitialSearchQuery(view.searchQuery)
          setEmailSearchQueryVersion((v) => v + 1)
        } else {
          // Otherwise a past assistant-driven search would be re-applied on
          // every re-entry, even after the user cleared the search box.
          setEmailInitialSearchQuery(null)
        }
        return
      case 'workspace':
        setIsWorkspaceOpen(true)
        setWorkspaceInitialPath(view.path ?? null)
        return
      case 'knowledge-view':
        setIsKnowledgeViewOpen(true)
        setKnowledgeViewMode(view.mode ?? (view.folderPath ? 'files' : 'graph'))
        setKnowledgeViewFolderPath(view.folderPath ?? null)
        return
      case 'chat-history':
        setIsChatHistoryOpen(true)
        return
      case 'home':
        setIsHomeOpen(true)
        return
      case 'code':
        setIsCodeOpen(true)
        return
      case 'bg-tasks':
        setIsBgTasksOpen(true)
        return
      case 'apps':
        setIsAppsOpen(true)
        return
      case 'spaces':
        // Feature-flag gate: every route into Spaces (sidebar, palette, deep
        // links, notification clicks, history, relaunch restore) funnels
        // through here. With the flag off, closeAllSections has already run,
        // so the app lands on the default full-screen chat.
        if (!SPACES_ENABLED) return
        if (view.orgId && view.spaceId) setSpaceSelection({ orgId: view.orgId, spaceId: view.spaceId })
        setRailSelection(view.rail ?? { kind: 'general' })
        // Spaces carries its own conversation surface, so entering it
        // collapses the assistant chat pane by default; in-space navigation
        // (topics, files, history within Spaces) leaves it as the user set it.
        if (!wasSpacesOpen) setIsChatSidebarOpen(false)
        setIsSpacesOpen(true)
        return
      case 'chat':
        if (view.runId) {
          bindChatToRun(view.runId)
        } else {
          handleNewChat()
        }
        return
    }
  }, [closeAllSections, bindChatToRun, handleNewChat, isSpacesOpen])
  applyViewStateRef.current = applyViewState

  const navigateToView = useCallback(async (nextView: ViewState) => {
    const current = currentViewStateRef.current
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
  }, [appendUnique, applyViewState, cancelRecordingIfActive, setHistory, isBrowserOpen, dismissBrowserOverlay])

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

  // Section entry points (sidebar items, deep links, the tour). Thin wrappers
  // over navigateToView so every entry records history — the old direct
  // state-twiddling versions didn't, which made Back skip whole sections.
  const openEmailView = useCallback((threadId?: string) => {
    void navigateToView({ type: 'email', ...(threadId ? { threadId } : {}) })
  }, [navigateToView])

  const openBgTasksView = useCallback(() => {
    void navigateToView({ type: 'bg-tasks' })
  }, [navigateToView])

  const openAppsView = useCallback(() => {
    void navigateToView({ type: 'apps' })
  }, [navigateToView])

  // navigateToView early-returns when the apps view is already showing, so
  // `openAppsView` alone is a no-op while an app is open — the sidebar "Apps"
  // item did nothing. Bumping the version with a null folder tells AppsView to
  // drop its selection (mirrors onOpenBgTasks).
  const openAppsGrid = useCallback(() => {
    setAppInitialId(null)
    setAppIdVersion((v) => v + 1)
    openAppsView()
  }, [openAppsView])

  const openSpace = useCallback((orgId: string, spaceId: string) => {
    void navigateToView({ type: 'spaces', orgId, spaceId })
  }, [navigateToView])

  const openMeetingsView = useCallback(() => {
    void navigateToView({ type: 'meetings' })
  }, [navigateToView])

  const openCodeView = useCallback(() => {
    void navigateToView({ type: 'code' })
  }, [navigateToView])

  const navigateBack = useCallback(async () => {
    const current = currentViewStateRef.current
    const { back, forward } = historyRef.current
    if (back.length === 0) return

    let i = back.length - 1
    while (i >= 0 && viewStatesEqual(back[i], current)) i -= 1
    if (i < 0) {
      setHistory({ back: [], forward })
      return
    }

    const target = back[i]
    const nextHistory = {
      back: back.slice(0, i),
      forward: appendUnique(forward, current),
    }
    setHistory(nextHistory)
    await applyViewState(target)
  }, [appendUnique, applyViewState, setHistory])

  const navigateForward = useCallback(async () => {
    const current = currentViewStateRef.current
    const { back, forward } = historyRef.current
    if (forward.length === 0) return

    let i = forward.length - 1
    while (i >= 0 && viewStatesEqual(forward[i], current)) i -= 1
    if (i < 0) {
      setHistory({ back, forward: [] })
      return
    }

    const target = forward[i]
    const nextHistory = {
      back: appendUnique(back, current),
      forward: forward.slice(0, i),
    }
    setHistory(nextHistory)
    await applyViewState(target)
  }, [appendUnique, applyViewState, setHistory])

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

  // Stable across navigations (EmailView's memoized rows compare prop
  // identity) — the email view's people-note chips navigate through the ref.
  const openNoteFromEmail = useCallback((path: string) => {
    void navigateToViewRef.current({ type: 'file', path })
  }, [])

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

  // "Updated to vX.Y.Z" card on the first launch after an update. Main
  // compares its persisted version stamp against the running version and
  // hands out `updatedFrom` exactly once, so reloads don't re-show this.
  useEffect(() => {
    void window.ipc.invoke('app:consumeUpdateInfo', null).then(({ version, updatedFrom }) => {
      if (!updatedFrom) return
      toast(`Updated to v${version}`, {
        description: `Rowboat was updated from v${updatedFrom}.`,
        action: {
          label: "What's new",
          onClick: () => window.open(`https://github.com/rowboatlabs/rowboat/releases/tag/v${version}`, '_blank'),
        },
        duration: 10000,
        closeButton: true,
      })
    })
  }, [])

  // One-time storage-retention notice: a modal on the first launch with
  // retention enabled; the actual sweep starts on the NEXT launch so months
  // of history are never deleted before the user has seen this.
  const [retentionNotice, setRetentionNotice] = useState<{ chatDays: number | null } | null>(null)
  const [retentionSettingsOpen, setRetentionSettingsOpen] = useState(false)
  useEffect(() => {
    void window.ipc.invoke('retention:consumeFirstRunNotice', null).then(({ show, chatDays }) => {
      if (show) setRetentionNotice({ chatDays })
    }).catch(() => { /* settings unavailable — try again next launch */ })
  }, [])

  // The quick-ask chord failed to register at boot — another app owns it.
  // Say so (once per launch) with a path to fix it, instead of quick-ask
  // being silently dead. Deliberately no automatic rebinding: a shortcut
  // that moves on its own is worse than one that's honestly broken.
  const [shortcutSettingsOpen, setShortcutSettingsOpen] = useState(false)
  // Voice-setup nudge for a summon that can't start a session (see
  // notifyVoiceUnavailableRef). The user is in another app when they press
  // the chord, so the app window has to come forward to be seen.
  const [voiceSetupOpen, setVoiceSetupOpen] = useState(false)
  const notifyVoiceUnavailable = useCallback((reason: 'voice' | 'failed') => {
    void window.ipc.invoke('app:focusMainWindow', null).catch(() => {})
    // 'failed' already raised its own permission dialog — don't double up.
    if (reason === 'failed') return
    toast('Hover mode needs voice', {
      description:
        'Sign in to Rowboat — or add your own Deepgram and ElevenLabs keys — to talk to your Skipper.',
      duration: 8000,
      action: { label: 'Open settings', onClick: () => setVoiceSetupOpen(true) },
    })
  }, [])
  notifyVoiceUnavailableRef.current = notifyVoiceUnavailable
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const s = await window.ipc.invoke('quickAsk:getShortcut', null)
        if (s.registered) return
        const isMacHere = navigator.platform.toLowerCase().includes('mac')
        toast.warning('Hover shortcut unavailable', {
          description: `${quickAskShortcut.formatShortcut(s.accelerator, isMacHere)} is in use by another app, so your Skipper can't be summoned right now. Pick a different shortcut in Settings.`,
          duration: 15000,
          closeButton: true,
          action: {
            label: 'Change shortcut',
            onClick: () => setShortcutSettingsOpen(true),
          },
        })
      } catch { /* stale preload — channel not there yet */ }
    }, 2000)
    return () => clearTimeout(timer)
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

  // Tray menu "Start/Stop meeting notes": same toggle as the Meetings header
  // button. Also drains a toggle parked while the window was closed/loading
  // (mirrors the pending deep-link pull above).
  useEffect(() => {
    void window.ipc.invoke('app:consumePendingTrayCommand', null).then(({ toggleMeetingNotes }) => {
      if (toggleMeetingNotes) handleToggleMeetingRef.current?.()
    })
    return window.ipc.on('app:toggleMeetingNotes', () => {
      handleToggleMeetingRef.current?.()
    })
  }, [])

  // Triggered by main when the user clicks a calendar-meeting notification.
  // Reuses the same flow as the in-app "Join meeting & take notes" button.
  // When `openMeeting` is true, also opens the meeting URL in the system browser.
  useEffect(() => {
    return window.ipc.on('app:takeMeetingNotes', ({ event, openMeeting, source }) => {
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
        source: source ?? 'calendar-sync',
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
        case 'apps': openAppsGrid(); break
        case 'spaces': void navigateToView({ type: 'spaces' }); break
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
  }, [navigateToFile, navigateToView, openAppsGrid, selectedPath])

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

  // Deck auto-open / refresh: when the assistant writes a .pptx inside the
  // workspace, open the editor on a brand-new deck (deck-create) and tell an
  // already-open editor the file changed underneath it. Same seeding semantics
  // as app-navigation above: transcript entries present on session switch are
  // marked processed without replaying.
  const processedDeckToolsRef = useRef<{ key: string | null; ids: Set<string> }>({ key: null, ids: new Set() })
  useEffect(() => {
    const conversation = sessionChat.chatState?.conversation
    if (!conversation) return
    const completed = conversation.filter(
      (item): item is ToolCall =>
        isToolCall(item) &&
        (item.name === 'deck-create' ||
          item.name === 'deck-add-slide' ||
          item.name === 'deck-edit-slide' ||
          item.name === 'deck-restructure' ||
          item.name === 'deck-restyle') &&
        item.status === 'completed'
    )
    if (processedDeckToolsRef.current.key !== runId) {
      processedDeckToolsRef.current = { key: runId, ids: new Set(completed.map((t) => t.id)) }
      return
    }
    for (const tool of completed) {
      if (processedDeckToolsRef.current.ids.has(tool.id)) continue
      processedDeckToolsRef.current.ids.add(tool.id)
      const result = tool.result as Record<string, unknown> | undefined
      if (result && result.success && typeof result.workspaceRelPath === 'string') {
        // Only a brand-new deck steals the view; edits to an existing one
        // must not yank the user away from what they are doing.
        if (tool.name === 'deck-create') {
          void navigateToView({ type: 'file', path: result.workspaceRelPath })
        }
        // If the editor is already open on this file the navigation is a
        // no-op, and the workspace watcher only covers allowlisted roots —
        // so tell the editor directly that the file changed.
        window.dispatchEvent(new CustomEvent('rowboat:deck-touched', { detail: { path: result.workspaceRelPath } }))
      }
    }
  }, [sessionChat.chatState?.conversation, runId, navigateToView])

  // Spreadsheet auto-open / refresh: when the assistant writes a spreadsheet
  // inside the workspace, open the viewer on a brand-new file
  // (spreadsheet-create) and tell an already-open viewer the file changed
  // underneath it. Same seeding semantics as app-navigation above: transcript
  // entries present on session switch are marked processed without replaying.
  const processedSpreadsheetToolsRef = useRef<{ key: string | null; ids: Set<string> }>({ key: null, ids: new Set() })
  useEffect(() => {
    const conversation = sessionChat.chatState?.conversation
    if (!conversation) return
    const completed = conversation.filter(
      (item): item is ToolCall =>
        isToolCall(item) &&
        (item.name === 'spreadsheet-create' || item.name === 'spreadsheet-edit') &&
        item.status === 'completed'
    )
    if (processedSpreadsheetToolsRef.current.key !== runId) {
      processedSpreadsheetToolsRef.current = { key: runId, ids: new Set(completed.map((t) => t.id)) }
      return
    }
    for (const tool of completed) {
      if (processedSpreadsheetToolsRef.current.ids.has(tool.id)) continue
      processedSpreadsheetToolsRef.current.ids.add(tool.id)
      const result = tool.result as Record<string, unknown> | undefined
      if (result && result.success && typeof result.workspaceRelPath === 'string') {
        // Only a brand-new spreadsheet steals the view; edits to an existing
        // one must not yank the user away from what they are doing.
        if (tool.name === 'spreadsheet-create') {
          void navigateToView({ type: 'file', path: result.workspaceRelPath })
        }
        // If the viewer is already open on this file the navigation is a
        // no-op, and the workspace watcher only covers allowlisted roots —
        // so tell the viewer directly that the file changed.
        window.dispatchEvent(new CustomEvent('rowboat:spreadsheet-touched', { detail: { path: result.workspaceRelPath } }))
      }
    }
  }, [sessionChat.chatState?.conversation, runId, navigateToView])

  const navigateToFullScreenChat = useCallback(() => {
    const current = currentViewStateRef.current
    // Only treat this as navigation when coming from another view
    if (current.type !== 'chat') {
      const nextHistory = {
        back: appendUnique(historyRef.current.back, current),
        forward: [] as ViewState[],
      }
      setHistory(nextHistory)
    }
    handleOpenFullScreenChat()
  }, [appendUnique, handleOpenFullScreenChat, setHistory])

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
  // The call button on a chat means "float THIS chat": it reads as End call
  // only on the chat the live call is actually bound to; on any other chat
  // it stays a call button that re-points the live call (see handleStartCall).
  const callOnActiveChat = inCall
    && hoverRunId != null
    && chatTabs.find((t) => t.id === activeChatTabId)?.runId === hoverRunId

  const isFullScreenChat = !selectedPath && !isGraphOpen && !isSuggestedTopicsOpen && !isMeetingsOpen && !isLiveNotesOpen && !isBgTasksOpen && !isAppsOpen && !isSpacesOpen && !isEmailOpen && !isWorkspaceOpen && !isKnowledgeViewOpen && !isChatHistoryOpen && !isHomeOpen && !isCodeOpen && !selectedBackgroundTask && !isBrowserOpen
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

  // Route undo/redo to the open markdown editor (prevents browser undo).
  useEffect(() => {
    const handleHistoryKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.altKey) return

      const key = e.key.toLowerCase()
      const wantsUndo = key === 'z' && !e.shiftKey
      const wantsRedo = (key === 'z' && e.shiftKey) || (!isMac && key === 'y')
      if (!wantsUndo && !wantsRedo) return

      if (!selectedPath || !selectedPath.endsWith('.md')) return

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

      const handlers = fileHistoryHandlersRef.current
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
    // isMac is a module constant now (lib/shortcut), not a component value.
  }, [selectedPath])

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
      if (isFullScreenChat) {
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
  // Chat @-mention candidates: notes plus spreadsheets (the assistant reads
  // workbooks via its spreadsheet/parse tools). Wiki links and the graph stay
  // markdown-only via knowledgeFiles above.
  const mentionableFiles = React.useMemo(() => {
    const files = collectFilePaths(tree).filter(
      (path) => path.endsWith('.md') || getViewerType(path) === 'spreadsheet',
    )
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

    for (const file of mentionableFiles) {
      const fullPath = toKnowledgePath(file)
      if (fullPath && isPathVisible(fullPath)) {
        visible.push(file)
      }
    }
    return visible
  }, [mentionableFiles, expandedPaths])

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
    analytics.onboardingCompleted()
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
        analytics.noteCreated()
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
    createPresentation: (parentPath: string = 'knowledge') => {
      setNewPresentationTargetFolder(parentPath)
      setNewPresentationOpen(true)
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
      if (isFullScreenChat) {
        setIsChatSidebarOpen(false)
        setIsRightPaneMaximized(false)
      }
      void navigateToView({ type: 'graph' })
    },
    openBases: () => {
      if (isFullScreenChat) {
        setIsChatSidebarOpen(false)
        setIsRightPaneMaximized(false)
      }
      void navigateToView({ type: 'file', path: BASES_DEFAULT_TAB_PATH })
    },
    openWorkspaceAt: (path?: string) => {
      if (isFullScreenChat) {
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
          deleteInitialContentForPath(oldPath)
          setInitialContentForPath(newPath, rewriteForRename(baseline))
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
          deleteInitialContentForPath(path)
          untitledRenameReadyPathsRef.current.delete(path)
          frontmatterByPathRef.current.delete(path)
        }
        // If the deleted file is on screen, clear it (falls back to chat).
        if (selectedPath === path) {
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
  }), [deleteInitialContentForPath, setInitialContentForPath, tree, selectedPath, isGraphOpen, selectedBackgroundTask, workspaceRoot, navigateToFile, navigateToView, removeEditorCacheForPath])

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
        openAppsGrid()
        break
      case 'workspaces':
        knowledgeActions.openWorkspaceAt()
        break
    }
  }, [navigateToView, openEmailView, openMeetingsView, openCodeView, knowledgeActions, openBgTasksView, openAppsGrid])

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

    // If the note is already on screen (e.g. second call after transcription),
    // force a content reload instead of re-navigating.
    if (selectedPathRef.current === notePath) {
      try {
        await reloadMarkdownFileIntoEditor(notePath)
      } catch {
        // File read failed — ignore
      }
      return
    }

    // First call — open the file
    navigateToFile(notePath)
  }, [loadDirectory, navigateToFile, reloadMarkdownFileIntoEditor])

  const meetingNotePathRef = useRef<string | null>(null)
  const meetingRecordingStartedAtMsRef = useRef<number | null>(null)
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
      meetingRecordingStartedAtMsRef.current = performance.now()
      analytics.meetingRecordingStarted(Boolean(calEvent))
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
      const recordingStartedAt = meetingRecordingStartedAtMsRef.current
      meetingRecordingStartedAtMsRef.current = null
      analytics.meetingRecordingStopped(recordingStartedAt != null ? (performance.now() - recordingStartedAt) / 1000 : 0)
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
              // Notes are done — bring Rowboat to the foreground on the
              // finished note (the post-call "redirect"). The notification
              // below is background-only, so it only fires if the focus
              // grab didn't take.
              void window.ipc.invoke('app:focusMainWindow', null).catch(() => {})
              void window.ipc
                .invoke('meeting:notifyNotesReady', { notePath, title: noteTitle })
                .catch(() => { /* notification is best-effort */ })
            }
          }
        } catch (err) {
          analytics.meetingSummarizeFailed()
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
  const isRightPaneContext = Boolean(selectedPath || isGraphOpen || isSuggestedTopicsOpen || isMeetingsOpen || isLiveNotesOpen || isBgTasksOpen || isAppsOpen || isSpacesOpen || isEmailOpen || isWorkspaceOpen || isKnowledgeViewOpen || isChatHistoryOpen || isHomeOpen || isCodeOpen || isBrowserOpen)
  // Code mode with a session selected: the chat is the main surface — the
  // middle pane is just the session rail and the chat fills the rest, with
  // the workspace drawer at its edge. Before a session is picked the empty
  // state owns the pane and the chat stays out of the way.
  const codeChatMain = isCodeOpen && activeCodeSession !== null
  const chatPaneOpen = isCodeOpen ? codeChatMain : isChatSidebarOpen
  const isRightPaneOnlyMode = isRightPaneContext && chatPaneOpen && isRightPaneMaximized
  const shouldCollapseLeftPane = isRightPaneOnlyMode
  const nonChatPaneStyle = React.useMemo<React.CSSProperties>(() => {
    const style: React.CSSProperties = { maxWidth: insetMaxWidth }
    if (!isRightPaneContext || !chatPaneOpen || isRightPaneMaximized) return style
    if (codeChatMain) {
      return { ...style, width: codeRailWidth, flex: '0 0 auto' }
    }
    if (chatPaneSize === 'chat-equal') {
      return { ...style, width: 0, flex: '1 1 0' }
    }
    if (chatPaneSize === 'chat-bigger') {
      return { ...style, width: DEFAULT_CHAT_PANE_WIDTH, flex: '0 0 auto' }
    }
    return style
  }, [chatPaneSize, codeChatMain, codeRailWidth, chatPaneOpen, insetMaxWidth, isRightPaneContext, isRightPaneMaximized])
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
  // What the middle pane shows right now — same precedence the old view
  // ternary had. Keep-alive sections stay mounted (hidden) once visited.
  const activeMiddle: MiddleView =
    isBrowserOpen ? 'browser'
    : isHomeOpen ? 'home'
    : isSuggestedTopicsOpen ? 'suggested-topics'
    : isMeetingsOpen ? 'meetings'
    : isCodeOpen ? 'code'
    : isLiveNotesOpen ? 'live-notes'
    : isBgTasksOpen ? 'bg-tasks'
    : isAppsOpen ? 'apps'
    : isSpacesOpen ? 'spaces'
    : isEmailOpen ? 'email'
    : isWorkspaceOpen ? 'workspace'
    : isKnowledgeViewOpen ? 'knowledge'
    : isChatHistoryOpen ? 'chat-history'
    : selectedPath && isBaseFilePath(selectedPath) ? 'bases'
    : isGraphOpen ? 'graph'
    : selectedPath ? 'file'
    : selectedTask ? 'task'
    : 'chat'
  const [visitedSections, setVisitedSections] = useState<ReadonlySet<MiddleView>>(() => new Set())
  useEffect(() => {
    if (!KEEP_ALIVE_SECTIONS.has(activeMiddle)) return
    setVisitedSections((prev) => {
      if (prev.has(activeMiddle)) return prev
      const next = new Set(prev)
      next.add(activeMiddle)
      return next
    })
  }, [activeMiddle])
  /** Mounted = visited at least once (or showing now); visible = showing now. */
  const sectionMounted = (key: MiddleView) => activeMiddle === key || visitedSections.has(key)

  // Everything the left navigation needs, shared by its two forms: the
  // expanded panel sidebar and the collapsed floating dock.
  const sidebarNavProps = {
    tree,
    knowledgeActions,
    bgTaskSummaries,
    activeNav: (
      // The browser overlay covers whatever section is open underneath — while
      // it's up, only the Browser tile should read as active (its own
      // browserOpen dot), not the hidden section.
      isBrowserOpen ? null
      : isHomeOpen ? 'home'
      : isEmailOpen ? 'email'
      : isMeetingsOpen ? 'meetings'
      : isCodeOpen ? 'code'
      : (isKnowledgeViewOpen || isGraphOpen || (selectedPath != null && selectedPath.startsWith('knowledge/'))) ? 'knowledge'
      : isBgTasksOpen ? 'agents'
      : isAppsOpen ? 'apps'
      : isSpacesOpen ? 'spaces'
      : isWorkspaceOpen ? 'workspaces'
      // Full-screen chat (no section, file, or task open) is the Assistant's
      // own surface — it carries the dock dot and the switcher's MRU rank.
      : isFullScreenChat ? 'assistant'
      : null
    ) as 'assistant' | 'home' | 'email' | 'meetings' | 'code' | 'knowledge' | 'agents' | 'apps' | 'spaces' | 'workspaces' | null,
    onOpenMeetings: openMeetingsView,
    onOpenCode: openCodeView,
    onOpenBgTasks: () => { setBgTaskInitialSlug(null); setBgTaskSlugVersion((v) => v + 1); openBgTasksView() },
    onOpenApps: openAppsGrid,
    onOpenApp: (folder: string) => { setAppInitialId(folder); setAppIdVersion((v) => v + 1); openAppsView() },
    onOpenSpace: openSpace,
    activeSpace: isSpacesOpen ? spaceSelection : null,
    recentRuns: runs,
    onOpenRun: (rid: string) => void navigateToView({ type: 'chat', runId: rid }),
    onRenameRun: (rid: string, title: string) => {
      void window.ipc.invoke('sessions:setTitle', { sessionId: rid, title })
        .then(() => setRuns((prev) => prev.map((r) => (r.id === rid ? { ...r, title } : r))))
        .catch((err) => console.error('Failed to rename chat:', err))
    },
    onDeleteRun: (rid: string) => {
      void window.ipc.invoke('sessions:delete', { sessionId: rid })
        .then(() => handleRunDeleted(rid))
        .catch((err) => console.error('Failed to delete chat:', err))
    },
    onOpenChatHistory: () => void navigateToView({ type: 'chat-history' }),
    onOpenEmail: (threadId?: string) => openEmailView(threadId),
    onOpenHome: () => void navigateToView({ type: 'home' }),
    onNewChat: handleNewChatTab,
    onToggleBrowser: handleToggleBrowser,
    onStartTour: () => setTourActive(true),
    meetingRecordingState: meetingTranscription.state,
    recordingMeetingSource,
    onToggleMeetingRecording: () => { void handleToggleMeeting() },
  }
  return (
    <TooltipProvider delayDuration={0}>
      <SidebarSectionProvider defaultSection="tasks" onSectionChange={(section) => {
        if (section === 'knowledge' && isFullScreenChat) {
          void navigateToView({ type: 'file', path: BASES_DEFAULT_TAB_PATH })
        }
      }}>
        <div className="rowboat-shell flex h-svh w-full overflow-hidden">
          {/* Left navigation, two forms: expanded = the panel sidebar,
              collapsed = the slim icon rail. The collapse button (fixed
              top-left) swaps between them; the gutter padding clears the
              rail when it's showing. */}
          <SidebarProvider
            open={sidebarOpen}
            onOpenChange={handleSidebarOpenChange}
            style={{
              paddingLeft: sidebarOpen ? 0 : DOCK_GUTTER_PX,
              transition: 'padding-left 200ms linear',
            }}
          >
            <SidebarContentPanel
              {...sidebarNavProps}
              onSelectFile={toggleExpand}
              onOpenAgent={(slug) => { setBgTaskInitialSlug(slug); setBgTaskSlugVersion((v) => v + 1); openBgTasksView() }}
              onVoiceNoteCreated={handleVoiceNoteCreated}
            />
            {/* Always mounted: renders the tray when collapsed, and only the
                ⌥/⌃+Tab switcher while the panel is expanded (so the MRU order
                survives toggling between the two). */}
            <DockSidebar
              {...sidebarNavProps}
              browserOpen={isBrowserOpen}
              switcherOnly={sidebarOpen}
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
              {/* Header - also serves as titlebar drag region */}
              <ContentHeader
                onNavigateBack={() => { void navigateBack() }}
                onNavigateForward={() => { void navigateForward() }}
                canNavigateBack={canNavigateBack}
                canNavigateForward={canNavigateForward}
                collapsedLeftPaddingPx={collapsedLeftPaddingPx}
              >
                {isFullScreenChat ? (
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
                  // No tabs: the header names the section (or open file). It is
                  // part of the titlebar drag region — static text drags fine.
                  <div className="flex min-w-0 flex-1 items-center self-center">
                    <span className="truncate text-sm font-medium text-foreground/80">
                      {currentViewTitle}
                    </span>
                  </div>
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
                {isHomeOpen && !isBrowserOpen && (
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
                {/* Trailing layout control. Always mounted (just toggled invisible
                    when inactive) so its -webkit-app-region:no-drag rect is stable —
                    a freshly-mounted no-drag button inside the drag-region header
                    otherwise has its first click swallowed by the window drag. */}
                {(() => {
                  // Any section view (including Code — it was omitted here
                  // once, which left the dock unreopenable from Code).
                  const viewOpen = !isFullScreenChat
                  const action = isFullScreenChat
                    ? { onClick: pushChatToSidePane, icon: <ArrowRight className="size-5" />, label: 'Dock chat to side pane' }
                    : (viewOpen && !chatPaneOpen && !isCodeOpen)
                      ? { onClick: openChatSidePane, icon: <MessageSquare className="size-5" />, label: 'Open chat' }
                      // In Code mode the chat IS the section — nothing to expand into.
                      : (viewOpen && chatPaneOpen && !isRightPaneMaximized && !codeChatMain)
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

{/* Middle pane. Section views wrapped in <Activity> stay
                  mounted once visited — hidden = state+DOM kept, effects
                  paused — so section switches are instant. The other branches
                  mount/unmount exactly as before. */}
              {activeMiddle === 'browser' && (
                <BrowserPane
                  onClose={handleCloseBrowser}
                  forceHidden={isSearchOpen || showMeetingPermissions}
                />
              )}
              {sectionMounted('home') && (
                <Activity mode={activeMiddle === 'home' ? 'visible' : 'hidden'}>
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    <TodoView
                      composer={
                        <div className="flex flex-col gap-1.5">
                          {homeComposeTarget?.kind === 'todo' && homeCodeProjects.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 px-1">
                              <span className="text-[11px] font-medium text-muted-foreground">Code lane:</span>
                              {homeCodeProjects.slice(0, 6).map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  title={p.path}
                                  onClick={() => setHomeCodeProject((cur) => (cur?.id === p.id ? null : p))}
                                  className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                                    homeCodeProject?.id === p.id
                                      ? 'border-primary bg-primary text-primary-foreground'
                                      : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                                  }`}
                                >
                                  {p.name}
                                  {/* Same-named repos elsewhere on disk — show where this one lives. */}
                                  {homeCodeProjects.some((o) => o.id !== p.id && o.name === p.name) && (
                                    <span className="ml-1 opacity-60">{compactPath(parentPath(p.path), 20)}</span>
                                  )}
                                  {p.id === homeDefaultProjectId && <span className="ml-1 opacity-60">· default</span>}
                                </button>
                              ))}
                              {homeCodeProject && (
                                <button
                                  type="button"
                                  onClick={() => setHomeCodeIsolation((v) => (v === 'worktree' ? 'in-repo' : 'worktree'))}
                                  title="Where the agent works: an isolated worktree branch (parallel-safe, reviewed before merge), or directly in the repo"
                                  className="rounded-md border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                                >
                                  {homeCodeIsolation}
                                </button>
                              )}
                            </div>
                          )}
                          <ChatInputWithMentions
                          knowledgeFiles={mentionableFiles}
                          recentFiles={recentWikiFiles}
                          visibleFiles={visibleKnowledgeFiles}
                          onSubmit={handleHomeComposerSubmit}
                          isProcessing={false}
                          runId={null}
                          presetMessage={homeComposerPreset}
                          onPresetMessageConsumed={() => setHomeComposerPreset(undefined)}
                          onSelectionChange={(selection) => { homeSelectionRef.current = selection }}
                          workDir={null}
                          focusSignal={homeComposerFocusSignal}
                          contextChip={homeComposeTarget ? {
                            label: homeComposeTarget.kind === 'sub'
                              ? `Step of: ${homeComposeTarget.parentText.slice(0, 40)}`
                              : homeComposeTarget.kind === 'comment'
                                ? `Reply: ${homeComposeTarget.itemText.slice(0, 40)}`
                                : homeComposeTarget.kind === 'chatReply'
                                  ? `Reply: ${homeComposeTarget.title.slice(0, 40)}`
                                  : 'To-do',
                            icon: homeComposeTarget.kind === 'comment' || homeComposeTarget.kind === 'chatReply' ? 'reply' : 'todo',
                            quote: homeComposeTarget.kind === 'comment' || homeComposeTarget.kind === 'chatReply'
                              ? homeComposeTarget.quote
                              : undefined,
                            onDismiss: () => setHomeComposeTarget(null),
                          } : undefined}
                          placeholder={homeComposeTarget
                            ? (homeComposeTarget.kind === 'sub'
                                ? 'Add a step… @rowboat hands it off'
                                : homeComposeTarget.kind === 'comment'
                                  ? 'Tell @rowboat what to change…'
                                  : homeComposeTarget.kind === 'chatReply'
                                    ? 'Reply…'
                                    : 'Add a to-do… @rowboat hands it off')
                            : 'Ask anything — starts a new chat'}
                          isRecording={isRecording && voiceOwner === HOME_VOICE_HOLDER}
                          recordingText={voiceOwner === HOME_VOICE_HOLDER ? voice.interimText : undefined}
                          recordingState={voiceOwner === HOME_VOICE_HOLDER
                            ? (voice.state === 'submitting' ? 'stopping' : voice.state === 'connecting' ? 'connecting' : 'listening')
                            : undefined}
                          audioLevelsRef={voice.audioLevelsRef}
                          onStartRecording={() => handleStartRecording(HOME_VOICE_HOLDER)}
                          onSubmitRecording={handleSubmitRecording}
                          onCancelRecording={handleCancelRecording}
                          voiceAvailable={voiceAvailable}
                          inCall={inCall}
                          callOnThisChat={callOnActiveChat}
                          onStartCall={handleStartCall}
                          onEndCall={endCall}
                          callAvailable={voiceAvailable && ttsAvailable}
                          />
                        </div>
                      }
                      onComposeTodo={composeTodoOnHome}
                      composeTarget={homeComposeTarget}
                      getRunModel={() => homeSelectionRef.current ?? undefined}
                      onFocusComposer={() => setHomeComposerFocusSignal((n) => n + 1)}
                      onOpenNote={(path) => navigateToFile(path)}
                      onOpenInChat={(sessionId) => {
                        // Bind the dock (not the full-screen chat) to the
                        // item's session.
                        bindChatToRun(sessionId)
                        setIsChatSidebarOpen(true)
                      }}
                      onOpenCodeSession={(sessionId) => {
                        // A code strip's door: the Code section (diffs,
                        // terminal, worktree), focused on this session.
                        setCodeFocusSessionId(sessionId)
                        void navigateToView({ type: 'code' })
                      }}
                      attendedSessionId={inCall ? hoverRunId : null}
                    />
                </div>
                </Activity>
              )}
              {activeMiddle === 'suggested-topics' && (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <SuggestedTopicsView
                    onExploreTopic={(topic) => {
                      const prompt = buildSuggestedTopicExplorePrompt(topic)
                      submitFromPalette(prompt, null)
                    }}
                  />
                </div>
              )}
              {sectionMounted('meetings') && (
                <Activity mode={activeMiddle === 'meetings' ? 'visible' : 'hidden'}>
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <MeetingsView
                    onOpenNote={(path) => navigateToFile(path)}
                    onTakeMeetingNotes={() => { void handleToggleMeeting() }}
                    meetingState={meetingTranscription.state}
                    meetingSummarizing={meetingSummarizing}
                  />
                </div>
                </Activity>
              )}
              {sectionMounted('code') && (
                <Activity mode={activeMiddle === 'code' ? 'visible' : 'hidden'}>
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <CodeView
                    onSessionSelected={handleCodeSessionSelected}
                    focusSessionId={codeFocusSessionId}
                    onFocusConsumed={() => setCodeFocusSessionId(null)}
                    onRailWidthChange={setCodeRailWidth}
                  />
                </div>
                </Activity>
              )}
              {activeMiddle === 'live-notes' && (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <LiveNotesView
                    onOpenNote={(path) => navigateToFile(path)}
                    onAddNewLiveNote={() => {
                      submitFromPalette(buildLiveNoteSetupPrompt(), null)
                    }}
                  />
                </div>
              )}
              {sectionMounted('bg-tasks') && (
                <Activity mode={activeMiddle === 'bg-tasks' ? 'visible' : 'hidden'}>
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
                </Activity>
              )}
              {sectionMounted('apps') && (
                <Activity mode={activeMiddle === 'apps' ? 'visible' : 'hidden'}>
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <AppsView
                    initialAppFolder={appInitialId}
                    initialVersion={appIdVersion}
                    onNewApp={() => prefillChat('Build me an app that ')}
                  />
                </div>
                </Activity>
              )}
              {sectionMounted('spaces') && (
                <Activity mode={activeMiddle === 'spaces' ? 'visible' : 'hidden'}>
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <SpacesView
                    active={activeMiddle === 'spaces'}
                    selection={spaceSelection}
                    onSelect={setSpaceSelection}
                    railSelection={railSelection}
                    onRailSelect={(rail) => {
                      // In-space navigation is real navigation: each selection is a history entry,
                      // so the top ‹ › retrace general → topic → file.
                      if (spaceSelection) void navigateToView({ type: 'spaces', orgId: spaceSelection.orgId, spaceId: spaceSelection.spaceId, rail })
                      else setRailSelection(rail)
                    }}
                    onOpenSession={(sessionId) => void navigateToView({ type: 'chat', runId: sessionId })}
                  />
                </div>
                </Activity>
              )}
              {sectionMounted('email') && (
                <Activity mode={activeMiddle === 'email' ? 'visible' : 'hidden'}>
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <EmailView initialThreadId={emailInitialThreadId} threadIdVersion={emailThreadIdVersion} initialSearchQuery={emailInitialSearchQuery} searchQueryVersion={emailSearchQueryVersion} onOpenNote={openNoteFromEmail} />
                </div>
                </Activity>
              )}
              {sectionMounted('workspace') && (
                <Activity mode={activeMiddle === 'workspace' ? 'visible' : 'hidden'}>
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <WorkspaceView
                    tree={tree}
                    initialPath={workspaceInitialPath}
                    actions={{
                      remove: knowledgeActions.remove,
                      copyPath: knowledgeActions.copyPath,
                      revealInFileManager: knowledgeActions.revealInFileManager,
                      createNote: knowledgeActions.createNote,
                      createPresentation: knowledgeActions.createPresentation,
                      addGoogleDoc: knowledgeActions.addGoogleDoc,
                      createFolder: knowledgeActions.createFolder,
                    }}
                    onNavigate={(path) => { void navigateToView({ type: 'workspace', path: path === WORKSPACE_ROOT ? undefined : path }) }}
                    onOpenNote={(path) => navigateToFile(path)}
                    onCreateWorkspace={async (name) => { await knowledgeActions.createWorkspace(name) }}
                    onOpenRun={(rid) => void navigateToView({ type: 'chat', runId: rid })}
                  />
                </div>
                </Activity>
              )}
              {sectionMounted('knowledge') && (
                <Activity mode={activeMiddle === 'knowledge' ? 'visible' : 'hidden'}>
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
                </Activity>
              )}
              {activeMiddle === 'chat-history' && (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <ChatHistoryView
                    runs={runs}
                    currentRunId={runId}
                    processingRunIds={processingRunIds}
                    onSelectRun={(rid) => void navigateToView({ type: 'chat', runId: rid })}
                    onRenameRun={(rid, title) => {
                      void window.ipc.invoke('sessions:setTitle', { sessionId: rid, title })
                        .then(() => setRuns((prev) => prev.map((r) => (r.id === rid ? { ...r, title } : r))))
                        .catch((err) => console.error('Failed to rename chat:', err))
                    }}
                    onDeleteRun={async (rid) => {
                      try {
                        await window.ipc.invoke('sessions:delete', { sessionId: rid })
                        handleRunDeleted(rid)
                        await loadRuns()
                      } catch (err) {
                        console.error('Failed to delete run:', err)
                      }
                    }}
                    onNewChat={handleNewChatTab}
                    onOpenSearch={() => setIsSearchOpen(true)}
                  />
                </div>
              )}
              {activeMiddle === 'bases' && selectedPath && (
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
              )}
              {activeMiddle === 'graph' && (
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
              )}
              {activeMiddle === 'file' && selectedPath && (
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
                      {(() => {
                        const notePath = selectedPath
                        const isViewingHistory = viewingHistoricalVersion && versionHistoryPath === notePath
                        const noteFrontmatter = frontmatterByPathRef.current.get(notePath) ?? null
                        const linkedGoogleDoc = parseLinkedGoogleDocFrontmatter(noteFrontmatter)
                        const noteContent = isViewingHistory
                          ? viewingHistoricalVersion.content
                          : editorContentByPath[notePath]
                            ?? (editorPathRef.current === notePath ? editorContent : '')
                        return (
                          <div
                            // Keyed by path: switching files remounts the
                            // editor with a fresh undo history.
                            key={notePath}
                            className="flex min-h-0 flex-1 flex-col overflow-hidden"
                            data-file-tab-panel={notePath}
                          >
                            <MarkdownEditor
                              ref={(el) => { markdownEditorRef.current = el }}
                              content={noteContent}
                              notePath={notePath}
                              onChange={(markdown) => { if (!isViewingHistory) handleEditorChange(notePath, markdown) }}
                              onPrimaryHeadingCommit={() => {
                                untitledRenameReadyPathsRef.current.add(notePath)
                              }}
                              preserveUntitledTitleHeading={isUntitledPlaceholderName(getBaseName(notePath))}
                              placeholder="Start writing..."
                              wikiLinks={wikiLinkConfig}
                              onImageUpload={handleImageUpload}
                              editorSessionKey={editorSessionByPath[notePath] ?? 0}
                              frontmatter={noteFrontmatter}
                              onFrontmatterChange={(newRaw) => {
                                frontmatterByPathRef.current.set(notePath, newRaw)
                                // Write updated frontmatter to disk immediately
                                const currentBody = editorContentRef.current
                                const fullContent = joinFrontmatter(newRaw, currentBody)
                                setInitialContentForPath(notePath, splitFrontmatter(fullContent).body)
                                initialContentRef.current = splitFrontmatter(fullContent).body
                                void window.ipc.invoke('workspace:writeFile', {
                                  path: notePath,
                                  data: fullContent,
                                  opts: { encoding: 'utf8' },
                                })
                              }}
                              onHistoryHandlersChange={(handlers) => {
                                fileHistoryHandlersRef.current = handlers ?? null
                              }}
                              editable={!isViewingHistory}
                              googleDoc={linkedGoogleDoc && !isViewingHistory ? {
                                title: linkedGoogleDoc.title,
                                isSyncing: googleDocSyncDirection,
                                lastSyncedAt: linkedGoogleDoc.syncedAt,
                                onOpen: () => {
                                  if (linkedGoogleDoc.url) {
                                    window.open(linkedGoogleDoc.url, '_blank')
                                  }
                                },
                                onSyncDown: () => { void syncGoogleDocDown(notePath) },
                                onSyncUp: () => { void syncGoogleDocUp(notePath) },
                              } : undefined}
                              onExport={async (format) => {
                                const markdown = noteContent
                                const title = getBaseName(notePath)
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
                      })()}
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
                ) : selectedPath && getViewerType(selectedPath) === 'spreadsheet' ? (
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <SpreadsheetFileViewer path={selectedPath} />
                  </div>
                ) : selectedPath && getViewerType(selectedPath) === 'pptx' ? (
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <PptxEditor
                      key={selectedPath}
                      path={selectedPath}
                      onSlideChange={handleDeckSlideChange}
                    />
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <UnsupportedFileViewer path={selectedPath} />
                  </div>
                )
                )}
                </>
              )}
              {activeMiddle === 'task' && selectedTask && (
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
              )}
              {activeMiddle === 'chat' && (
              <FileCardProvider onOpenKnowledgeFile={(path) => { navigateToFile(path) }} onOpenFile={(path) => { navigateToFile(path) }}>
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="relative min-h-0 flex-1">
                  {chatTabs.map((tab) => {
                    const isActive = tab.id === activeChatTabId
                    return (
                      <ChatSessionPane
                        // Keyed by CHAT identity: rebinding this tab to a
                        // different session remounts the panel (fresh
                        // scroll/DOM state); first-send runId binding does not.
                        key={tab.chatId}
                        tab={tab}
                        isActive={isActive}
                        tabState={getChatTabStateForRender(tab.id)}
                        viewportAnchor={chatViewportAnchorByTab[tab.id]}
                        onPickPrompt={setPresetMessage}
                        isToolOpenForTab={isToolOpenForTab}
                        setToolOpenForTab={setToolOpenForTab}
                        onPermissionResponse={handlePermissionResponse}
                        onAskHumanResponse={handleAskHumanResponse}
                        onCodePermissionResponse={handleCodePermissionResponse}
                        onComposioConnected={handleComposioConnected}
                        activeIsWorking={activeIsWorking}
                        activeIsProcessing={activeIsProcessing}
                        activeIsReasoning={activeIsReasoning}
                        isCodeSession={!!(tab.runId && codeSessionLocks[tab.runId])}
                      />
                    )
                  })}
                </div>

                <div className="rowboat-composer-dock sticky bottom-0 z-10 bg-background pb-12 pt-2 shadow-lg">
                  <div className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-linear-to-t from-background to-transparent" />
                  <div className="mx-auto w-full max-w-4xl px-4">
                    {chatTabs.map((tab) => {
                      const isActive = tab.id === activeChatTabId
                      return (
                        <ChatSessionComposer
                          // Composer instance per CHAT (see chat panel key
                          // above): a rebound tab gets a fresh composer, so
                          // attachments/toggles/selection can't leak across
                          // sessions; first-send binding keeps the instance.
                          key={tab.chatId}
                          tab={tab}
                          isActive={isActive}
                          tabState={getChatTabStateForRender(tab.id)}
                          knowledgeFiles={mentionableFiles}
                          recentFiles={recentWikiFiles}
                          visibleFiles={visibleKnowledgeFiles}
                          onSubmit={handlePromptSubmit}
                          onStop={handleStop}
                          activeIsProcessing={activeIsProcessing}
                          isStopping={isStopping}
                          // The single session store follows the ACTIVE tab's
                          // run — only that tab's composer shows its queue.
                          queued={
                            isActive && tab.runId && sessionChat.sessionId === tab.runId
                              ? sessionChat.queued
                              : undefined
                          }
                          onRemoveQueued={handleRemoveQueued}
                          onPullQueued={handlePullQueued}
                          presetMessage={presetMessage}
                          onPresetMessageConsumed={() => setPresetMessage(undefined)}
                          codeSessionLocks={codeSessionLocks}
                          initialDraft={chatDraftsRef.current.get(tab.chatId)}
                          onDraftChange={setChatDraftForTab}
                          onSelectionChange={(t, selection) => {
                            if (selection) {
                              selectionByTabRef.current.set(t.chatId, selection)
                            } else {
                              selectionByTabRef.current.delete(t.chatId)
                            }
                          }}
                          initialSelection={selectionByTabRef.current.get(tab.chatId) ?? null}
                          // Last-turn restore: the single session store is
                          // bound to the ACTIVE tab's run, so only that tab
                          // gets a resolved value; others stay undefined
                          // (loading) until activated. lastSelection is null
                          // for a session with no turns (settings seed).
                          restoredSelection={
                            isActive && tab.runId
                              && sessionChat.sessionId === tab.runId
                              && sessionChat.chatState
                              ? sessionChat.chatState.lastSelection
                              : undefined
                          }
                          workDirByTab={workDirByTab}
                          onWorkDirChange={setTabWorkDir}
                          isRecording={isRecording}
                          voiceOwner={voiceOwner}
                          voice={voice}
                          onStartRecording={handleStartRecording}
                          onSubmitRecording={handleSubmitRecording}
                          onCancelRecording={handleCancelRecording}
                          voiceAvailable={voiceAvailable}
                          inCall={inCall}
                          callOnThisChat={callOnActiveChat}
                          onStartCall={handleStartCall}
                          onEndCall={endCall}
                          ttsAvailable={ttsAvailable}
                        />
                      )
                    })}
                  </div>
                </div>
              </div>
              </FileCardProvider>
              )}
            </SidebarInset>

            {/* Chat pane - shown when viewing files/graph/code. Code sessions
                bind this same assistant chat (a code session IS a chat
                session) — there is no separate code chat surface. */}
            {isRightPaneContext && (
              <CodeDiffOpenerProvider onOpenDiff={codeChatMain ? openCodeDiff : null}>
              <ChatSidebar
                placement={chatPanePlacement}
                // Code mode: the chat fills whatever the rail and drawer leave.
                paneSize={codeChatMain ? 'chat-bigger' : chatPaneSize}
                className={isChatPaneInMiddle ? "order-2" : undefined}
                defaultWidth={DEFAULT_CHAT_PANE_WIDTH}
                isOpen={chatPaneOpen}
                isMaximized={isRightPaneMaximized}
                chatTabs={chatTabs}
                activeChatTabId={activeChatTabId}
                getChatTabTitle={getChatTabTitle}
                onNewChatTab={() => handleNewChatTabInSidebar()}
                recentRuns={runs}
                onSelectRun={bindChatToRun}
                onOpenChatHistory={() => void navigateToView({ type: 'chat-history' })}
                onOpenFullScreen={toggleRightPaneMaximize}
                onNavigateBack={() => { void navigateBack() }}
                onNavigateForward={() => { void navigateForward() }}
                canNavigateBack={canNavigateBack}
                canNavigateForward={canNavigateForward}
                conversation={activeChatTabState.conversation}
                currentAssistantMessage={activeChatTabState.currentAssistantMessage}
                currentReasoning={activeChatTabState.currentReasoning}
                sessionUsage={activeChatTabState.sessionUsage}
                chatTabStates={chatTabStatesForRender}
                viewportAnchors={chatViewportAnchorByTab}
                isProcessing={activeIsProcessing}
                isStopping={isStopping}
                onStop={handleStop}
                onSubmit={handlePromptSubmit}
                queuedForActive={
                  runId && sessionChat.sessionId === runId ? sessionChat.queued : undefined
                }
                onRemoveQueued={handleRemoveQueued}
                onPullQueued={handlePullQueued}
                knowledgeFiles={mentionableFiles}
                recentFiles={recentWikiFiles}
                visibleFiles={visibleKnowledgeFiles}
                runId={runId}
                presetMessage={presetMessage}
                onPresetMessageConsumed={() => setPresetMessage(undefined)}
                getInitialDraft={(tabId) => chatDraftsRef.current.get(chatIdForTab(tabId))}
                onDraftChangeForTab={setChatDraftForTab}
                onSelectionChangeForTab={(tabId, selection) => {
                  if (selection) {
                    selectionByTabRef.current.set(chatIdForTab(tabId), selection)
                  } else {
                    selectionByTabRef.current.delete(chatIdForTab(tabId))
                  }
                }}
                getInitialSelection={(tabId) => selectionByTabRef.current.get(chatIdForTab(tabId)) ?? null}
                restoredSelectionForActive={
                  runId && sessionChat.sessionId === runId && sessionChat.chatState
                    ? sessionChat.chatState.lastSelection
                    : undefined
                }
                workDirByTab={workDirByTab}
                onWorkDirChangeForTab={setTabWorkDir}
                codeSessionLocks={codeSessionLocks}
                pinnedToCodeSession={
                  codeChatMain
                    && activeCodeSession
                    // Only while the pane is actually bound to the session — a
                    // palette-initiated fresh chat, for example, unbinds it.
                    && chatTabs.find((t) => t.id === activeChatTabId)?.runId === activeCodeSession.session.id
                    ? {
                        session: activeCodeSession.session,
                        status: activeCodeSession.status,
                        changedCount: codeGit.gitStatus?.isRepo ? codeGit.gitStatus.files.length : null,
                        panel: codePanel,
                        onTogglePanel: toggleCodePanel,
                      }
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
                onCodePermissionResponse={handleCodePermissionResponse}
                isToolOpenForTab={isToolOpenForTab}
                onToolOpenChangeForTab={setToolOpenForTab}
                onOpenKnowledgeFile={(path) => { navigateToFile(path) }}
                onOpenFile={(path) => { navigateToFile(path) }}
                onActivate={() => setActiveShortcutPane('right')}
                collapsedLeftPaddingPx={collapsedLeftPaddingPx}
                // Gated on mic ownership: when another composer (Home, a
                // call) owns the mic, the dock must not mirror the recording.
                isRecording={isRecording && voiceOwner === chatIdForTab(activeChatTabId)}
                recordingText={voiceOwner === chatIdForTab(activeChatTabId) ? voice.interimText : undefined}
                recordingState={voice.state === 'submitting' ? 'stopping' : voice.state === 'connecting' ? 'connecting' : 'listening'}
                audioLevelsRef={voice.audioLevelsRef}
                onStartRecording={() => handleStartRecording(chatIdForTab(activeChatTabIdRef.current))}
                onSubmitRecording={handleSubmitRecording}
                onCancelRecording={handleCancelRecording}
                voiceAvailable={voiceAvailable}
                inCall={inCall}
                callOnThisChat={callOnActiveChat}
                onStartCall={handleStartCall}
                onEndCall={endCall}
                callAvailable={voiceAvailable && ttsAvailable}
                onComposioConnected={handleComposioConnected}
              />
              </CodeDiffOpenerProvider>
            )}
            {/* Workspace drawer beside the code chat: changes, files or a
                terminal — one of the chat header's buttons opens it. */}
            {codeChatMain && activeCodeSession && codePanel && (
              <CodeWorkspaceDrawer
                session={activeCodeSession.session}
                panel={codePanel}
                onPanelChange={setCodePanel}
                onClose={() => setCodePanel(null)}
                gitStatus={codeGit.gitStatus}
                onRefreshGit={() => void codeGit.refresh()}
                openDiffPath={codeDiffPath}
                onDiffOpened={handleCodeDiffOpened}
                onSessionChanged={() => void refreshCodeSessions()}
                placement={chatPanePlacement}
                className={isChatPaneInMiddle ? "order-2" : undefined}
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
                status={videoCallStatus ?? 'idle'}
                pttStatus={pttStatus}
                onPttDown={handlePttDown}
                onPttUp={handlePttUp}
                interimText={voice.interimText}
                assistantCaption={assistantCaption}
                onLeave={endCall}
              />
            )}
            {/* macOS permission explainers (mic / camera / input monitoring) */}
            <PermissionDialog
              kind={permissionDialog}
              onOpenChange={(open) => {
                if (!open) setPermissionDialog(null)
              }}
              onRetry={() => void window.ipc.invoke('ptt:retryHook', null).catch(() => {})}
            />
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
            {/* Top-left gutter strip: continues the titlebar band across the
                icon rail (the traffic lights are wider than the rail, so the
                band must be one uninterrupted surface — the rail itself starts
                below it) and keeps that corner draggable. */}
            {!sidebarOpen && (
              <div
                aria-hidden="true"
                className="titlebar-drag-region fixed left-0 top-0 z-20 h-10 border-b border-border bg-background"
                style={{ width: DOCK_GUTTER_PX }}
              />
            )}
            {/* Sidebar toggle — always present (both directions), rendered
                last so its no-drag region paints over the drag regions. */}
            <FixedSidebarToggle
              leftInsetPx={isMac ? MACOS_TRAFFIC_LIGHTS_RESERVED_PX : 0}
              onNewChat={handleNewChat}
              onWidthChange={setTitlebarControlsWidthPx}
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
      <UpdateCard />
      <CreditCelebration />
      <BillingErrorDialog
        open={billingErrorOpen}
        match={billingErrorMatch}
        onOpenChange={setBillingErrorOpen}
      />
      {/* One-time storage-retention notice (see retention:consumeFirstRunNotice). */}
      <Dialog open={retentionNotice !== null} onOpenChange={(open) => { if (!open) setRetentionNotice(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Old chats are cleaned up automatically</DialogTitle>
            <DialogDescription className="pt-1 leading-relaxed">
              {retentionNotice?.chatDays != null
                ? `To save disk space, Rowboat now deletes chats that have been inactive for ${retentionNotice.chatDays}+ days, along with old background-task transcripts.`
                : 'To save disk space, Rowboat now deletes old background-task transcripts.'}
              {' '}Notes and files created by agents are never touched. Cleanup starts from the next launch, and you can change or turn this off anytime.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRetentionNotice(null)
                setRetentionSettingsOpen(true)
              }}
            >
              Open Settings
            </Button>
            <Button onClick={() => setRetentionNotice(null)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SettingsDialog
        open={retentionSettingsOpen}
        onOpenChange={setRetentionSettingsOpen}
        defaultTab="advanced"
      />
      <SettingsDialog
        open={shortcutSettingsOpen}
        onOpenChange={setShortcutSettingsOpen}
        defaultTab="shortcuts"
      />
      <SettingsDialog
        open={voiceSetupOpen}
        onOpenChange={setVoiceSetupOpen}
        defaultTab="account"
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
      <NewPresentationDialog
        open={newPresentationOpen}
        targetFolder={newPresentationTargetFolder}
        onOpenChange={setNewPresentationOpen}
        onCreated={(path) => {
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
