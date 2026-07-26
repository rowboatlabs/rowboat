/**
 * Which view the user is on: the ViewState union, the synthetic tab paths that
 * stand in for non-file views, and the rowboat:// deep-link parser.
 *
 * Extracted verbatim from App.tsx — pure, no React.
 *
 * ViewState is the single source of truth for the rendered view: App holds one
 * `useState<ViewState>` and derives its `is*Open` flags from it, so no two views
 * can be open at once and none-open is unrepresentable.
 */

import type { KnowledgeViewMode } from '@/components/knowledge-view'

export const GRAPH_TAB_PATH = '__rowboat_graph_view__'
export const SUGGESTED_TOPICS_TAB_PATH = '__rowboat_suggested_topics__'
export const MEETINGS_TAB_PATH = '__rowboat_meetings__'
export const LIVE_NOTES_TAB_PATH = '__rowboat_live_notes__'
export const BG_TASKS_TAB_PATH = '__rowboat_bg_tasks__'
export const APPS_TAB_PATH = '__rowboat_mini_apps__'
export const EMAIL_TAB_PATH = '__rowboat_email__'
export const WORKSPACE_TAB_PATH = '__rowboat_workspace__'
export const WORKSPACE_ROOT = 'knowledge/Workspace'
export const KNOWLEDGE_VIEW_TAB_PATH = '__rowboat_knowledge_view__'
export const CHAT_HISTORY_TAB_PATH = '__rowboat_chat_history__'
export const HOME_TAB_PATH = '__rowboat_home__'
export const BASES_DEFAULT_TAB_PATH = '__rowboat_bases_default__'
export const CODE_TAB_PATH = '__rowboat_code__'

export const isGraphTabPath = (path: string) => path === GRAPH_TAB_PATH
export const isSuggestedTopicsTabPath = (path: string) => path === SUGGESTED_TOPICS_TAB_PATH
export const isMeetingsTabPath = (path: string) => path === MEETINGS_TAB_PATH
export const isLiveNotesTabPath = (path: string) => path === LIVE_NOTES_TAB_PATH
export const isBgTasksTabPath = (path: string) => path === BG_TASKS_TAB_PATH
export const isAppsTabPath = (path: string) => path === APPS_TAB_PATH
export const isEmailTabPath = (path: string) => path === EMAIL_TAB_PATH
export const isWorkspaceTabPath = (path: string) => path === WORKSPACE_TAB_PATH
export const isKnowledgeViewTabPath = (path: string) => path === KNOWLEDGE_VIEW_TAB_PATH
export const isChatHistoryTabPath = (path: string) => path === CHAT_HISTORY_TAB_PATH
export const isHomeTabPath = (path: string) => path === HOME_TAB_PATH
export const isBaseFilePath = (path: string) => path.endsWith('.base') || path === BASES_DEFAULT_TAB_PATH
export const isCodeTabPath = (path: string) => path === CODE_TAB_PATH

/** A snapshot of which view the user is on */
export type ViewState =
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

/**
 * The view a file tab shows. Non-file views ride on sentinel tab paths, so the
 * tab strip and the ViewState union are two spellings of the same thing — this
 * is the one place that translates between them.
 *
 * Payload-carrying variants (workspace path, knowledge-view folder/mode) come
 * back bare: those payloads live outside ViewState in App and survive the switch.
 */
export function viewForTabPath(path: string): ViewState {
  if (isGraphTabPath(path)) return { type: 'graph' }
  if (isSuggestedTopicsTabPath(path)) return { type: 'suggested-topics' }
  if (isMeetingsTabPath(path)) return { type: 'meetings' }
  if (isLiveNotesTabPath(path)) return { type: 'live-notes' }
  if (isBgTasksTabPath(path)) return { type: 'bg-tasks' }
  if (isAppsTabPath(path)) return { type: 'apps' }
  if (isEmailTabPath(path)) return { type: 'email' }
  if (isWorkspaceTabPath(path)) return { type: 'workspace' }
  if (isKnowledgeViewTabPath(path)) return { type: 'knowledge-view' }
  if (isChatHistoryTabPath(path)) return { type: 'chat-history' }
  if (isHomeTabPath(path)) return { type: 'home' }
  if (isCodeTabPath(path)) return { type: 'code' }
  return { type: 'file', path }
}

export function viewStatesEqual(a: ViewState, b: ViewState): boolean {
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
export function parseDeepLink(input: string): ViewState | null {
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
