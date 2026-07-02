import type { KnowledgeViewMode } from '@/components/knowledge-view'

/**
 * Centralized navigation model.
 *
 * The app is a set of singleton sections selected from the sidebar. Exactly
 * one section is active at a time; sections are never tabs. The only tabbed
 * surface is the `files` section (the document editor), whose open documents
 * live in `fileTabs`.
 */
export type Section =
  | { type: 'home' }
  | { type: 'email'; threadId?: string }
  | { type: 'meetings' }
  | { type: 'code' }
  | { type: 'live-notes' }
  | { type: 'suggested-topics' }
  | { type: 'bg-tasks' }
  | { type: 'graph' }
  | { type: 'knowledge'; folderPath?: string; mode?: KnowledgeViewMode }
  | { type: 'workspace'; path?: string }
  | { type: 'chat-history' }
  | { type: 'task'; name: string }
  | { type: 'chat'; runId: string | null }
  | { type: 'files'; path: string }

export type NavFileTab = { id: string; path: string }

export type NavState = {
  section: Section
  fileTabs: NavFileTab[]
  activeFileTabId: string | null
  chatPanel: { open: boolean; maximized: boolean }
  history: { back: Section[]; forward: Section[] }
  /** Last non-chat section — where docking the chat / closing full-screen returns. */
  returnSection: Section | null
  /** Bumped whenever a tab is rebound to a new path, so the editor can reset undo history. */
  lastRebind: { tabId: string; nonce: number } | null
}

export type NavAction =
  | { type: 'navigate'; section: Section }
  | { type: 'replace-section'; section: Section }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'open-file'; path: string; newTab?: boolean }
  | { type: 'switch-file-tab'; tabId: string }
  | { type: 'close-file-tab'; tabId: string }
  | { type: 'replace-file-path'; from: string; to: string }
  | { type: 'set-chat-panel'; open?: boolean; maximized?: boolean }

export const initialNavState: NavState = {
  section: { type: 'home' },
  fileTabs: [],
  activeFileTabId: null,
  chatPanel: { open: true, maximized: false },
  history: { back: [], forward: [] },
  returnSection: null,
  lastRebind: null,
}

export function sectionsEqual(a: Section, b: Section): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'chat' && b.type === 'chat') return a.runId === b.runId
  if (a.type === 'files' && b.type === 'files') return a.path === b.path
  if (a.type === 'task' && b.type === 'task') return a.name === b.name
  if (a.type === 'workspace' && b.type === 'workspace') return (a.path ?? '') === (b.path ?? '')
  if (a.type === 'knowledge' && b.type === 'knowledge') return (a.folderPath ?? '') === (b.folderPath ?? '') && (a.mode ?? '') === (b.mode ?? '')
  if (a.type === 'email' && b.type === 'email') return (a.threadId ?? '') === (b.threadId ?? '')
  return true
}

const appendUnique = (stack: Section[], entry: Section): Section[] => {
  const last = stack[stack.length - 1]
  if (last && sectionsEqual(last, entry)) return stack
  return [...stack, entry]
}

let fileTabIdCounter = 0
const newFileTabId = () => `file-tab-${++fileTabIdCounter}`
let rebindNonce = 0

const isBaseFilePath = (path: string) => path.endsWith('.base')

export type FileOpenPlan =
  | { kind: 'reuse'; tabId: string }
  | { kind: 'rebind'; tabId: string }
  | { kind: 'create' }

/**
 * Decide how opening `path` maps onto the tab strip: focus an existing tab,
 * retarget the active markdown tab in place, or create a new tab.
 */
export function planFileOpen(state: NavState, path: string, newTab?: boolean): FileOpenPlan {
  const existing = state.fileTabs.find((tab) => tab.path === path)
  if (existing) return { kind: 'reuse', tabId: existing.id }
  if (newTab) return { kind: 'create' }
  if (state.section.type === 'files' && state.activeFileTabId) {
    const activeTab = state.fileTabs.find((tab) => tab.id === state.activeFileTabId)
    if (activeTab && !isBaseFilePath(activeTab.path)) {
      return { kind: 'rebind', tabId: activeTab.id }
    }
  }
  return { kind: 'create' }
}

const applyFileOpen = (state: NavState, path: string, newTab?: boolean): NavState => {
  const plan = planFileOpen(state, path, newTab)
  switch (plan.kind) {
    case 'reuse':
      return { ...state, activeFileTabId: plan.tabId }
    case 'rebind':
      return {
        ...state,
        fileTabs: state.fileTabs.map((tab) => (tab.id === plan.tabId ? { ...tab, path } : tab)),
        activeFileTabId: plan.tabId,
        lastRebind: { tabId: plan.tabId, nonce: ++rebindNonce },
      }
    case 'create': {
      const id = newFileTabId()
      return {
        ...state,
        fileTabs: [...state.fileTabs, { id, path }],
        activeFileTabId: id,
      }
    }
  }
}

const applyNavigate = (state: NavState, section: Section, options?: { newTab?: boolean }): NavState => {
  if (sectionsEqual(state.section, section)) return state
  let next: NavState = {
    ...state,
    section,
    history: {
      back: appendUnique(state.history.back, state.section),
      forward: [],
    },
    chatPanel: { ...state.chatPanel, maximized: false },
    returnSection: state.section.type !== 'chat' ? state.section : state.returnSection,
  }
  if (section.type === 'files') {
    next = applyFileOpen(next, section.path, options?.newTab)
  }
  return next
}

/** Restore a section arriving via back/forward (recreates a closed file tab if needed). */
const applyRestore = (state: NavState, section: Section): NavState => {
  let next: NavState = {
    ...state,
    section,
    chatPanel: { ...state.chatPanel, maximized: false },
    returnSection: state.section.type !== 'chat' ? state.section : state.returnSection,
  }
  if (section.type === 'files') {
    next = applyFileOpen(next, section.path)
  }
  return next
}

export function peekBack(state: NavState): Section | null {
  const { back } = state.history
  for (let i = back.length - 1; i >= 0; i--) {
    if (!sectionsEqual(back[i], state.section)) return back[i]
  }
  return null
}

export function peekForward(state: NavState): Section | null {
  const { forward } = state.history
  for (let i = forward.length - 1; i >= 0; i--) {
    if (!sectionsEqual(forward[i], state.section)) return forward[i]
  }
  return null
}

export const canNavigateBack = (state: NavState): boolean => peekBack(state) !== null
export const canNavigateForward = (state: NavState): boolean => peekForward(state) !== null

export function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case 'navigate':
      return applyNavigate(state, action.section)
    case 'replace-section':
      if (sectionsEqual(state.section, action.section)) return state
      return { ...state, section: action.section }
    case 'back': {
      const { back, forward } = state.history
      let i = back.length - 1
      while (i >= 0 && sectionsEqual(back[i], state.section)) i -= 1
      if (i < 0) {
        if (back.length === 0) return state
        return { ...state, history: { back: [], forward } }
      }
      const target = back[i]
      const restored = applyRestore(state, target)
      return {
        ...restored,
        history: {
          back: back.slice(0, i),
          forward: appendUnique(forward, state.section),
        },
      }
    }
    case 'forward': {
      const { back, forward } = state.history
      let i = forward.length - 1
      while (i >= 0 && sectionsEqual(forward[i], state.section)) i -= 1
      if (i < 0) {
        if (forward.length === 0) return state
        return { ...state, history: { back, forward: [] } }
      }
      const target = forward[i]
      const restored = applyRestore(state, target)
      return {
        ...restored,
        history: {
          back: appendUnique(back, state.section),
          forward: forward.slice(0, i),
        },
      }
    }
    case 'open-file':
      return applyNavigate(state, { type: 'files', path: action.path }, { newTab: action.newTab })
    case 'switch-file-tab': {
      const tab = state.fileTabs.find((t) => t.id === action.tabId)
      if (!tab) return state
      if (state.section.type === 'files' && state.activeFileTabId === action.tabId) return state
      // Tab switches are in-place swaps, not navigations — no history entry.
      return {
        ...state,
        activeFileTabId: action.tabId,
        section: { type: 'files', path: tab.path },
        chatPanel: { ...state.chatPanel, maximized: false },
      }
    }
    case 'close-file-tab': {
      const idx = state.fileTabs.findIndex((t) => t.id === action.tabId)
      if (idx < 0) return state
      const fileTabs = state.fileTabs.filter((t) => t.id !== action.tabId)
      const wasActive = state.activeFileTabId === action.tabId
      if (!wasActive) {
        return { ...state, fileTabs }
      }
      if (fileTabs.length > 0) {
        const neighbor = fileTabs[Math.min(idx, fileTabs.length - 1)]
        const inFiles = state.section.type === 'files'
        return {
          ...state,
          fileTabs,
          activeFileTabId: neighbor.id,
          // Switching to the neighbor is an in-place swap, no history entry —
          // matches how tab closes behave today.
          section: inFiles ? { type: 'files', path: neighbor.path } : state.section,
        }
      }
      // Last tab closed: return to the most recent non-files section, else Home.
      const fallback = [...state.history.back].reverse().find((s) => s.type !== 'files') ?? { type: 'home' as const }
      const closed: NavState = { ...state, fileTabs, activeFileTabId: null }
      if (state.section.type !== 'files') return closed
      return applyNavigate(closed, fallback)
    }
    case 'replace-file-path': {
      const replaceIn = (s: Section): Section =>
        s.type === 'files' && s.path === action.from ? { type: 'files', path: action.to } : s
      return {
        ...state,
        section: replaceIn(state.section),
        returnSection: state.returnSection ? replaceIn(state.returnSection) : null,
        fileTabs: state.fileTabs.map((tab) => (tab.path === action.from ? { ...tab, path: action.to } : tab)),
        history: {
          back: state.history.back.map(replaceIn),
          forward: state.history.forward.map(replaceIn),
        },
      }
    }
    case 'set-chat-panel':
      return {
        ...state,
        chatPanel: {
          open: action.open ?? state.chatPanel.open,
          maximized: action.maximized ?? state.chatPanel.maximized,
        },
      }
  }
}

/** Header title for non-files, non-chat sections. */
export function sectionTitle(section: Section): string {
  switch (section.type) {
    case 'home': return 'Home'
    case 'email': return 'Email'
    case 'meetings': return 'Meetings'
    case 'code': return 'Code'
    case 'live-notes': return 'Live notes'
    case 'suggested-topics': return 'Suggested Topics'
    case 'bg-tasks': return 'Background tasks'
    case 'graph': return 'Graph View'
    case 'knowledge': return section.mode === 'basis' ? 'Bases' : 'Brain'
    case 'workspace': return 'Workspace'
    case 'chat-history': return 'Chat history'
    case 'task': return section.name
    case 'chat': return 'Chat'
    case 'files': return section.path.split('/').pop()?.replace(/\.md$/i, '') || section.path
  }
}

export type ActiveNav = 'home' | 'email' | 'meetings' | 'code' | 'knowledge' | 'agents' | 'workspaces' | null

/** Which sidebar item to highlight for a given section. */
export function sectionToActiveNav(section: Section): ActiveNav {
  switch (section.type) {
    case 'home': return 'home'
    case 'email': return 'email'
    case 'meetings': return 'meetings'
    case 'code': return 'code'
    case 'knowledge':
    case 'graph': return 'knowledge'
    case 'bg-tasks':
    case 'task': return 'agents'
    case 'workspace': return 'workspaces'
    case 'files': return section.path.startsWith('knowledge/') ? 'knowledge' : null
    default: return null
  }
}

/**
 * Parse a rowboat:// deep link into a Section. Returns null if the URL is
 * malformed or names an unknown target.
 *
 * Shape: rowboat://open?type=<file|chat|graph|task|suggested-topics|meetings|live-notes|email|...>&...
 */
export function parseDeepLink(input: string): Section | null {
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
      return path ? { type: 'files', path } : null
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
        type: 'knowledge',
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
    default:
      return null
  }
}
