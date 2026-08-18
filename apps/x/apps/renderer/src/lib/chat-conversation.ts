import type { ToolUIPart } from 'ai'
import z from 'zod'
import { AskHumanRequestEvent, ToolPermissionAutoDecisionEvent, ToolPermissionRequestEvent } from '@x/shared/src/runs.js'
import { COMPOSIO_DISPLAY_NAMES } from '@x/shared/src/composio.js'
import type { CodeRunEvent, PermissionAsk } from '@x/shared/src/code-mode.js'

export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
}

export interface MessageAttachment {
  path: string
  filename: string
  mimeType: string
  size?: number
  thumbnailUrl?: string
  /** Live webcam frame from video chat mode — rendered as a compact filmstrip.
   *  Carries no path; thumbnailUrl holds the frame as a data: URL. */
  isVideoFrame?: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachments?: MessageAttachment[]
  timestamp: number
}

export interface ToolCall {
  id: string
  name: string
  input: ToolUIPart['input']
  result?: ToolUIPart['output']
  streamingOutput?: string
  status: 'pending' | 'running' | 'completed' | 'error'
  timestamp: number
  // code_agent_run only: structured ACP stream items + the in-flight permission ask.
  codeRunEvents?: CodeRunEvent[]
  pendingCodePermission?: { requestId: string; ask: PermissionAsk } | null
  // spawn-agent only: the durable parent→child link recorded as tool progress.
  subAgent?: { childTurnId: string; agentName: string; task: string }
}

export interface ErrorMessage {
  id: string
  kind: 'error'
  message: string
  timestamp: number
}

// The model's thought process for one model call, shown as a collapsible
// block above the text/tools it produced. Providers that only emit
// encrypted reasoning yield no item (there is no text to show).
export interface ReasoningMessage {
  id: string
  kind: 'reasoning'
  content: string
  timestamp: number
}

export type ReasoningEffortLevel = 'low' | 'medium' | 'high'

// User-facing names for the canonical effort ladder ("auto" = absent).
export const REASONING_EFFORT_LABELS: Record<ReasoningEffortLevel, string> = {
  low: 'Fast',
  medium: 'Balanced',
  high: 'Thorough',
}

export interface TurnUsageMessage {
  id: string
  kind: 'turn-usage'
  usage: TokenUsage
  modelCallCount: number
  // The turn's reasoning effort (from turn_created.config); absent = auto.
  reasoningEffort?: ReasoningEffortLevel
  timestamp: number
}

export type ConversationItem = ChatMessage | ToolCall | ErrorMessage | ReasoningMessage | TurnUsageMessage
export type PermissionResponse = 'approve' | 'deny'

export type ChatTabViewState = {
  runId: string | null
  conversation: ConversationItem[]
  currentAssistantMessage: string
  // Reasoning text streaming for the in-flight model call; superseded by the
  // durable reasoning item once the call completes. Optional because the
  // legacy pre-load fallback path never carries it.
  currentReasoning?: string
  sessionUsage: TokenUsage
  pendingAskHumanRequests: Map<string, z.infer<typeof AskHumanRequestEvent>>
  allPermissionRequests: Map<string, z.infer<typeof ToolPermissionRequestEvent>>
  permissionResponses: Map<string, PermissionResponse>
  autoPermissionDecisions: Map<string, z.infer<typeof ToolPermissionAutoDecisionEvent>>
}

export type ChatViewportAnchorState = {
  messageId: string | null
  requestKey: number
}

export const createEmptyChatTabViewState = (): ChatTabViewState => ({
  runId: null,
  conversation: [],
  currentAssistantMessage: '',
  currentReasoning: '',
  sessionUsage: {},
  pendingAskHumanRequests: new Map(),
  allPermissionRequests: new Map(),
  permissionResponses: new Map(),
  autoPermissionDecisions: new Map(),
})

export type ToolState = 'input-streaming' | 'input-available' | 'output-available' | 'output-error'

export const isChatMessage = (item: ConversationItem): item is ChatMessage => 'role' in item
export const isToolCall = (item: ConversationItem): item is ToolCall => 'name' in item
export const isErrorMessage = (item: ConversationItem): item is ErrorMessage =>
  'kind' in item && item.kind === 'error'
export const isReasoningMessage = (item: ConversationItem): item is ReasoningMessage =>
  'kind' in item && item.kind === 'reasoning'
export const isTurnUsageMessage = (item: ConversationItem): item is TurnUsageMessage =>
  'kind' in item && item.kind === 'turn-usage'

export const toToolState = (status: ToolCall['status']): ToolState => {
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

export const normalizeToolInput = (
  input: ToolCall['input'] | string | undefined
): ToolCall['input'] => {
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

export const normalizeToolOutput = (
  output: ToolCall['result'] | undefined,
  status: ToolCall['status']
) => {
  if (output === undefined || output === null) {
    return status === 'completed' ? 'No output returned.' : null
  }
  if (output === '') return '(empty output)'
  if (typeof output === 'boolean' || typeof output === 'number') return String(output)
  return output
}

export const getToolErrorText = (tool: ToolCall): string | undefined => {
  if (tool.status !== 'error') return undefined
  if (typeof tool.result === 'string' && tool.result.trim()) return tool.result
  if (tool.result !== undefined) {
    try {
      return JSON.stringify(tool.result, null, 2)
    } catch {
      // Fall through to the generic label for non-serializable legacy values.
    }
  }
  return 'Tool error'
}

/**
 * Sentinel answer the ask-human card sends when the user skips the question.
 * Phrased as an instruction so the model proceeds on its own; the settled
 * transcript row matches on it to render "Skipped".
 */
export const ASK_HUMAN_SKIP_ANSWER =
  'User skipped the question. Use your best judgment and proceed.'

export type AskHumanCardData = {
  question: string
  /** The user's answer (or a runtime/cancel message). Null while pending. */
  answer: string | null
  skipped: boolean
}

export const getAskHumanCardData = (tool: ToolCall): AskHumanCardData | null => {
  if (tool.name !== 'ask-human') return null
  const input = normalizeToolInput(tool.input) as Record<string, unknown> | undefined
  const question = typeof input?.question === 'string' ? input.question : ''
  const answer = typeof tool.result === 'string' && tool.result.trim() ? tool.result : null
  return { question, answer, skipped: answer === ASK_HUMAN_SKIP_ANSWER }
}

export type WebSearchCardResult = { title: string; url: string; description: string }

export type WebSearchCardData = {
  query: string
  results: WebSearchCardResult[]
  title?: string
}

export const getWebSearchCardData = (tool: ToolCall): WebSearchCardData | null => {
  if (tool.name === 'web-search') {
    const input = normalizeToolInput(tool.input) as Record<string, unknown> | undefined
    const result = tool.result as Record<string, unknown> | undefined
    const rawResults = (result?.results as Array<{
      title: string
      url: string
      description?: string
      highlights?: string[]
      text?: string
    }>) || []
    const mapped = rawResults.map((entry) => ({
      title: entry.title,
      url: entry.url,
      description: entry.description || entry.highlights?.[0] || (entry.text ? entry.text.slice(0, 200) : ''),
    }))
    const category = input?.category as string | undefined
    return {
      query: (input?.query as string) || '',
      results: mapped,
      title: (!category || category === 'general')
        ? 'Web search'
        : `${category.charAt(0).toUpperCase() + category.slice(1)} search`,
    }
  }

  return null
}

// App navigation action card data
export type AppActionCardData = {
  action: string
  label: string
  details?: Record<string, unknown>
}

const summarizeFilterUpdates = (updates: Record<string, unknown>): string => {
  const filters = updates.filters as Record<string, unknown> | undefined
  const parts: string[] = []

  if (filters) {
    if (filters.clear) parts.push('Cleared filters')
    const set = filters.set as Array<{ category: string; value: string }> | undefined
    if (set?.length) parts.push(`Set ${set.length} filter${set.length !== 1 ? 's' : ''}: ${set.map(f => `${f.category}=${f.value}`).join(', ')}`)
    const add = filters.add as Array<{ category: string; value: string }> | undefined
    if (add?.length) parts.push(`Added ${add.length} filter${add.length !== 1 ? 's' : ''}`)
    const remove = filters.remove as Array<{ category: string; value: string }> | undefined
    if (remove?.length) parts.push(`Removed ${remove.length} filter${remove.length !== 1 ? 's' : ''}`)
  }

  if (updates.sort) {
    const sort = updates.sort as { field: string; dir: string }
    parts.push(`Sorted by ${sort.field} ${sort.dir}`)
  }

  if (updates.search !== undefined) {
    parts.push(updates.search ? `Searching "${updates.search}"` : 'Cleared search')
  }

  const columns = updates.columns as Record<string, unknown> | undefined
  if (columns) {
    const set = columns.set as string[] | undefined
    if (set) parts.push(`Set ${set.length} column${set.length !== 1 ? 's' : ''}`)
    const add = columns.add as string[] | undefined
    if (add?.length) parts.push(`Added ${add.length} column${add.length !== 1 ? 's' : ''}`)
    const remove = columns.remove as string[] | undefined
    if (remove?.length) parts.push(`Removed ${remove.length} column${remove.length !== 1 ? 's' : ''}`)
  }

  return parts.length > 0 ? parts.join(', ') : 'Updated view'
}

const APP_VIEW_LABELS: Record<string, string> = {
  home: 'home',
  email: 'email',
  meetings: 'meetings',
  'live-notes': 'live notes',
  'bg-tasks': 'background agents',
  'chat-history': 'chat history',
  knowledge: 'knowledge',
  workspace: 'workspace',
  code: 'code',
  bases: 'bases',
  graph: 'graph',
}

const appViewLabel = (view: unknown): string => APP_VIEW_LABELS[view as string] ?? String(view ?? 'view')

export const getAppActionCardData = (tool: ToolCall): AppActionCardData | null => {
  if (tool.name !== 'app-navigation') return null
  const result = tool.result as Record<string, unknown> | undefined

  // While pending/running, derive label from input
  if (!result || !result.success) {
    const input = normalizeToolInput(tool.input) as Record<string, unknown> | undefined
    if (!input) return null
    const action = input.action as string
    switch (action) {
      case 'open-note': return { action, label: `Opening ${(input.path as string || '').split('/').pop()?.replace(/\.md$/, '') || 'note'}...` }
      case 'open-view': return { action, label: `Opening ${appViewLabel(input.view)}...` }
      case 'open-app': return { action, label: `Opening ${input.appId || 'app'}...` }
      case 'read-view': return { action, label: `Reading ${appViewLabel(input.view)}...` }
      case 'open-item': return { action, label: 'Opening...' }
      case 'update-base-view': return { action, label: 'Updating view...' }
      case 'create-base': return { action, label: `Creating "${input.name}"...` }
      case 'get-base-state': return null // renders as normal tool block
      default: return null
    }
  }

  switch (result.action) {
    case 'open-note': {
      const filePath = result.path as string || ''
      const name = filePath.split('/').pop()?.replace(/\.md$/, '') || 'note'
      return { action: 'open-note', label: `Opened ${name}` }
    }
    case 'open-view':
      return { action: 'open-view', label: `Opened ${appViewLabel(result.view)}` }
    case 'open-app':
      return { action: 'open-app', label: `Opened ${result.appName || result.appId || 'app'}` }
    case 'read-view': {
      const counted =
        (result.threads as unknown[] | undefined)?.length ??
        (result.agents as unknown[] | undefined)?.length ??
        (result.sessions as unknown[] | undefined)?.length
      return {
        action: 'read-view',
        label: counted !== undefined
          ? `Read ${appViewLabel(result.view)} (${counted} item${counted === 1 ? '' : 's'})`
          : `Read ${appViewLabel(result.view)}`,
      }
    }
    case 'open-item': {
      switch (result.kind) {
        case 'email-thread': return { action: 'open-item', label: 'Opened email thread' }
        case 'note': {
          const name = (result.path as string || '').split('/').pop()?.replace(/\.md$/, '') || 'note'
          return { action: 'open-item', label: `Opened ${name}` }
        }
        case 'bg-task': return { action: 'open-item', label: `Opened agent "${result.taskName}"` }
        case 'session': return { action: 'open-item', label: 'Opened chat' }
        default: return { action: 'open-item', label: 'Opened item' }
      }
    }
    case 'update-base-view':
      return {
        action: 'update-base-view',
        label: summarizeFilterUpdates(result.updates as Record<string, unknown> || {}),
        details: result.updates as Record<string, unknown>,
      }
    case 'create-base':
      return { action: 'create-base', label: `Created base "${result.name}"` }
    default:
      return null // get-base-state renders as normal tool block
  }
}

const BROWSER_PENDING_LABELS: Record<string, string> = {
  open: 'Opening browser...',
  'get-state': 'Reading browser state...',
  'new-tab': 'Opening new browser tab...',
  'switch-tab': 'Switching browser tab...',
  'close-tab': 'Closing browser tab...',
  navigate: 'Navigating browser...',
  back: 'Going back...',
  forward: 'Going forward...',
  reload: 'Reloading page...',
  'read-page': 'Reading page...',
  click: 'Clicking page element...',
  type: 'Typing into page...',
  press: 'Sending key press...',
  scroll: 'Scrolling page...',
  wait: 'Waiting for page...',
}

const truncateLabel = (value: string, max = 72): string => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, Math.max(0, max - 3)).trim()}...`
}

const safeBrowserString = (value: unknown): string | null => {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const parseBrowserUrl = (value: string | null): URL | null => {
  if (!value) return null
  try {
    return new URL(value)
  } catch {
    return null
  }
}

const getGoogleSearchQuery = (value: string | null): string | null => {
  const parsed = parseBrowserUrl(value)
  if (!parsed) return null
  const hostname = parsed.hostname.replace(/^www\./, '')
  if (hostname !== 'google.com' && !hostname.endsWith('.google.com')) return null
  if (parsed.pathname !== '/search') return null
  const query = parsed.searchParams.get('q')?.trim()
  return query ? truncateLabel(query, 56) : null
}

const formatBrowserTarget = (value: string | null): string | null => {
  const parsed = parseBrowserUrl(value)
  if (!parsed) {
    return value ? truncateLabel(value, 56) : null
  }

  const hostname = parsed.hostname.replace(/^www\./, '')
  const path = parsed.pathname === '/' ? '' : parsed.pathname
  const suffix = parsed.search ? `${path}${parsed.search}` : path
  return truncateLabel(`${hostname}${suffix}`, 56)
}

const sanitizeBrowserDescription = (value: string | null): string | null => {
  if (!value) return null

  let text = value
    .replace(/^(clicked|typed into|pressed)\s+/i, '')
    .replace(/\.$/, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!text) return null

  const looksLikeCssNoise =
    /(^|[\s"])(body|html)\b/i.test(text)
    || /display:|position:|background-color|align-items|justify-content|z-index|var\(--|left:|top:/i.test(text)
    || /\.[A-Za-z0-9_-]+\{/.test(text)

  if (looksLikeCssNoise || text.length > 88) {
    const quoted = Array.from(text.matchAll(/"([^"]+)"/g))
      .map((match) => match[1]?.trim())
      .find((candidate) => candidate && !/display:|position:|background-color|var\(--/i.test(candidate))

    if (!quoted) return null
    text = `"${truncateLabel(quoted, 44)}"`
  }

  if (/^(body|html)\b/i.test(text)) return null
  return truncateLabel(text, 64)
}

const getBrowserSuccessLabel = (
  action: string,
  input: Record<string, unknown> | undefined,
  result: Record<string, unknown> | undefined,
): string | null => {
  const page = result?.page as Record<string, unknown> | undefined
  const pageUrl = safeBrowserString(page?.url)
  const resultMessage = safeBrowserString(result?.message)

  switch (action) {
    case 'open':
      return 'Opened browser'
    case 'get-state':
      return 'Read browser state'
    case 'new-tab': {
      const query = getGoogleSearchQuery(pageUrl)
      if (query) return `Opened search for "${query}"`
      const target = formatBrowserTarget(pageUrl) || safeBrowserString(input?.target)
      return target ? `Opened ${target}` : 'Opened new tab'
    }
    case 'switch-tab':
      return 'Switched browser tab'
    case 'close-tab':
      return 'Closed browser tab'
    case 'navigate': {
      const query = getGoogleSearchQuery(pageUrl)
      if (query) return `Searched Google for "${query}"`
      const target = formatBrowserTarget(pageUrl) || formatBrowserTarget(safeBrowserString(input?.target))
      return target ? `Opened ${target}` : 'Navigated browser'
    }
    case 'back':
      return 'Went back'
    case 'forward':
      return 'Went forward'
    case 'reload':
      return 'Reloaded page'
    case 'read-page': {
      const title = safeBrowserString(page?.title)
      return title ? `Read ${truncateLabel(title, 52)}` : 'Read page'
    }
    case 'click': {
      const detail = sanitizeBrowserDescription(resultMessage)
      if (detail) return `Clicked ${detail}`
      if (typeof input?.index === 'number') return `Clicked element ${input.index}`
      return 'Clicked page element'
    }
    case 'type': {
      const detail = sanitizeBrowserDescription(resultMessage)
      if (detail) return `Typed into ${detail}`
      if (typeof input?.index === 'number') return `Typed into element ${input.index}`
      return 'Typed into page'
    }
    case 'press': {
      const key = safeBrowserString(input?.key)
      return key ? `Pressed ${truncateLabel(key, 20)}` : 'Sent key press'
    }
    case 'scroll':
      return `Scrolled ${input?.direction === 'up' ? 'up' : 'down'}`
    case 'wait': {
      const ms = typeof input?.ms === 'number' ? input.ms : 1000
      return `Waited ${ms}ms`
    }
    default:
      return resultMessage ? truncateLabel(resultMessage, 72) : 'Controlled browser'
  }
}

export const getBrowserControlLabel = (tool: ToolCall): string | null => {
  if (tool.name !== 'browser-control') return null

  const input = normalizeToolInput(tool.input) as Record<string, unknown> | undefined
  const result = tool.result as Record<string, unknown> | undefined
  const action = (input?.action as string | undefined) || (result?.action as string | undefined) || 'browser'

  if (tool.status !== 'completed') {
    if (action === 'click' && typeof input?.index === 'number') {
      return `Clicking element ${input.index}...`
    }
    if (action === 'type' && typeof input?.index === 'number') {
      return `Typing into element ${input.index}...`
    }
    if (action === 'navigate' && typeof input?.target === 'string') {
      return `Navigating to ${input.target}...`
    }
    return BROWSER_PENDING_LABELS[action] || 'Controlling browser...'
  }

  if (result?.success === false) {
    const error = safeBrowserString(result.error)
    return error ? `Browser error: ${truncateLabel(error, 84)}` : 'Browser action failed'
  }

  const label = getBrowserSuccessLabel(action, input, result)
  if (label) {
    return label
  }

  return 'Controlled browser'
}

// Parse attached files from message content and return clean message + file paths.
export const parseAttachedFiles = (content: string): { message: string; files: string[] } => {
  const attachedFilesRegex = /<attached-files>\s*([\s\S]*?)\s*<\/attached-files>/
  const match = content.match(attachedFilesRegex)

  if (!match) {
    return { message: content, files: [] }
  }

  const filesXml = match[1]
  const filePathRegex = /<file path="([^"]+)">/g
  const files: string[] = []
  let fileMatch
  while ((fileMatch = filePathRegex.exec(filesXml)) !== null) {
    files.push(fileMatch[1])
  }

  let cleanMessage = content.replace(attachedFilesRegex, '').trim()
  for (const filePath of files) {
    const fileName = filePath.split('/').pop()?.replace(/\.md$/i, '') || ''
    if (!fileName) continue
    const mentionRegex = new RegExp(`@${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'gi')
    cleanMessage = cleanMessage.replace(mentionRegex, '')
  }

  return { message: cleanMessage.trim(), files }
}

// Composio connect card data
export type ComposioConnectCardData = {
  toolkitSlug: string
  toolkitDisplayName: string
  alreadyConnected: boolean
  /** When true, the connect card should not be rendered (toolkit was already connected). */
  hidden: boolean
}


export const getComposioConnectCardData = (tool: ToolCall): ComposioConnectCardData | null => {
  if (tool.name !== 'composio-connect-toolkit') return null

  const input = normalizeToolInput(tool.input) as Record<string, unknown> | undefined
  const result = tool.result as Record<string, unknown> | undefined

  const toolkitSlug = (input?.toolkitSlug as string) || ''
  const alreadyConnected = result?.alreadyConnected === true

  return {
    toolkitSlug,
    toolkitDisplayName: COMPOSIO_DISPLAY_NAMES[toolkitSlug] || toolkitSlug,
    alreadyConnected,
    // Don't render a connect card if the toolkit was already connected —
    // the original card from the first connect call already shows the "Connected" state.
    hidden: alreadyConnected,
  }
}

// Human-friendly display names for builtin tools
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  'file-readText': 'Reading file',
  'file-writeText': 'Writing file',
  'file-editText': 'Editing file',
  'file-list': 'Reading directory',
  'file-exists': 'Checking path',
  'file-stat': 'Getting file info',
  'file-glob': 'Finding files',
  'file-grep': 'Searching files',
  'file-mkdir': 'Creating directory',
  'file-rename': 'Renaming',
  'file-copy': 'Copying file',
  'file-remove': 'Removing',
  'file-getRoot': 'Getting file root',
  'loadSkill': 'Loading skill',
  'parseFile': 'Parsing file',
  'LLMParse': 'Extracting content',
  'analyzeAgent': 'Analyzing agent',
  'executeCommand': 'Running command',
  'addMcpServer': 'Adding MCP server',
  'listMcpServers': 'Listing MCP servers',
  'listMcpTools': 'Listing MCP tools',
  'executeMcpTool': 'Running MCP tool',
  'web-search': 'Searching the web',
  'save-to-memory': 'Saving to memory',
  'app-navigation': 'Navigating app',
  'browser-control': 'Controlling browser',
  'composio-list-toolkits': 'Listing integrations',
  'composio-search-tools': 'Searching tools',
  'composio-execute-tool': 'Running tool',
  'composio-connect-toolkit': 'Connecting service',
}

/**
 * Get a human-friendly display name for a tool call.
 * For Composio tools, returns a contextual label (e.g., "Found 3 tools for 'send email' in Gmail").
 * For builtin tools, returns a static friendly name (e.g., "Reading file").
 * Falls back to the raw tool name if no mapping exists.
 */
export const getToolDisplayName = (tool: ToolCall): string => {
  const browserLabel = getBrowserControlLabel(tool)
  if (browserLabel) return browserLabel
  const composioData = getComposioActionCardData(tool)
  if (composioData) return composioData.label
  return TOOL_DISPLAY_NAMES[tool.name] || tool.name
}

/* ── Quiet tool-row summaries ─────────────────────────────────────────
 * Structured collapsed label for the one-line tool row: a medium-weight
 * verb, a muted detail (path/pattern/query, optionally with a dimmed
 * parent-path prefix), and a faint trailing stat ("9 matches", "exit 0").
 * Derived from tool.input and tool.result — unlike TOOL_DISPLAY_NAMES,
 * which is name-keyed only and kept for group summaries / status lines.
 */
export type ToolRowSummary = {
  verb: string
  /** Render the verb in the mono face (shell commands). */
  verbMono?: boolean
  /** Dimmed prefix rendered just before `detail` (parent directory). */
  dimPrefix?: string
  detail?: string
  detailMono?: boolean
  stat?: string
  /** Line-diff stat for edits, rendered as colored +N -M. */
  diff?: { added: number; removed: number }
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

/** "a/b/c/d.ts" → { dimPrefix: "b/c/", base: "d.ts" } (last 2 parent segments). */
const splitDisplayPath = (p: string): { dimPrefix?: string; base: string } => {
  const segments = p.replace(/\/+$/, '').split('/').filter(Boolean)
  if (segments.length <= 1) return { base: p }
  const base = segments[segments.length - 1]
  const parents = segments.slice(Math.max(0, segments.length - 3), segments.length - 1)
  return { dimPrefix: `${parents.join('/')}/`, base }
}

const plural = (count: number, unit: string): string =>
  `${count} ${unit}${count === 1 ? '' : 's'}`

// Cheap line diff for the edit stat: trim common prefix/suffix lines, count
// what's left. Not a real LCS, but right for the focused edits models make.
export const countLineDiff = (
  oldStr: string,
  newStr: string,
): { added: number; removed: number } => {
  const a = oldStr.split('\n')
  const b = newStr.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  return { removed: endA - start, added: endB - start }
}

const fileRowSummary = (verb: string, rawPath: unknown, stat?: string): ToolRowSummary => {
  const path = asString(rawPath)
  if (!path) return { verb, stat }
  const { dimPrefix, base } = splitDisplayPath(path)
  return { verb, dimPrefix, detail: base, stat }
}

export const getToolRowSummary = (tool: ToolCall): ToolRowSummary => {
  const input = asRecord(normalizeToolInput(tool.input))
  const result = tool.status === 'completed' ? asRecord(tool.result) : undefined
  const done = tool.status === 'completed'

  switch (tool.name) {
    case 'file-readText': {
      const totalLines = asNumber(result?.totalLines)
      return fileRowSummary('Read', input?.path, totalLines !== undefined ? plural(totalLines, 'line') : undefined)
    }
    case 'file-writeText': {
      const content = asString(input?.content)
      const stat = done && content ? plural(content.split('\n').length, 'line') : undefined
      return fileRowSummary('Write', input?.path, stat)
    }
    case 'file-editText': {
      const summary = fileRowSummary('Edit', input?.path)
      const oldString = asString(input?.oldString)
      const newString = typeof input?.newString === 'string' ? input.newString : undefined
      if (done && oldString !== undefined && newString !== undefined) {
        const diff = countLineDiff(oldString, newString)
        const replacements = asNumber(result?.replacements)
        const times = replacements && replacements > 1 ? replacements : 1
        summary.diff = { added: diff.added * times, removed: diff.removed * times }
      }
      return summary
    }
    case 'file-list': {
      const count =
        (Array.isArray(result?.entries) ? result.entries.length : undefined) ??
        (Array.isArray(result?.files) ? result.files.length : undefined)
      return {
        verb: 'List',
        detail: asString(input?.path) ?? '.',
        stat: count !== undefined ? plural(count, 'item') : undefined,
      }
    }
    case 'file-exists':
      return fileRowSummary('Check', input?.path, done ? (result?.exists ? 'exists' : 'not found') : undefined)
    case 'file-stat':
      return fileRowSummary('Inspect', input?.path)
    case 'file-glob': {
      const count = asNumber(result?.count)
      return {
        verb: 'Find',
        detail: asString(input?.pattern) ? `"${input!.pattern}"` : undefined,
        detailMono: true,
        stat: count !== undefined ? plural(count, 'file') : undefined,
      }
    }
    case 'file-grep': {
      const count = asNumber(result?.count)
      return {
        verb: 'Search',
        detail: asString(input?.pattern) ? `"${input!.pattern}"` : undefined,
        detailMono: true,
        stat: count !== undefined ? plural(count, 'match') : undefined,
      }
    }
    case 'file-mkdir':
      return fileRowSummary('Create folder', input?.path)
    case 'file-rename': {
      const from = asString(input?.from)
      const to = asString(input?.to)
      return {
        verb: 'Rename',
        detail: from && to ? `${splitDisplayPath(from).base} → ${splitDisplayPath(to).base}` : from,
      }
    }
    case 'file-copy':
      return fileRowSummary('Copy', input?.from ?? input?.path)
    case 'file-remove':
      return fileRowSummary('Delete', input?.path)
    case 'file-getRoot':
      return { verb: 'Locate workspace' }
    case 'executeCommand': {
      const command = asString(input?.command)
      const exitCode = asNumber(result?.exitCode)
      return {
        verb: '$',
        verbMono: true,
        detail: command ? command.split('\n')[0] : undefined,
        detailMono: true,
        stat: exitCode !== undefined ? `exit ${exitCode}` : done ? undefined : tool.status === 'running' ? 'running…' : undefined,
      }
    }
    case 'loadSkill': {
      // Input is `skillName` (id or catalog path); the result echoes the
      // resolved id and names any tools the skill attached.
      const requested = asString(input?.skillName)
      const name =
        asString(result?.skillName) ??
        (requested ? splitDisplayPath(requested.replace(/\/skill\.ts$/, '')).base : undefined)
      const failed = done && asRecord(tool.result)?.success === false
      const attached = Array.isArray(result?.attachedTools) ? result.attachedTools.length : undefined
      return {
        verb: 'Load skill',
        detail: name,
        stat: failed ? 'not found' : attached !== undefined ? `${plural(attached, 'tool')} attached` : undefined,
      }
    }
    case 'parseFile':
      return fileRowSummary('Parse', input?.path)
    case 'LLMParse':
      return fileRowSummary('Extract', input?.path)
    case 'analyzeAgent':
      return { verb: 'Analyze agent' }
    case 'addMcpServer':
      return { verb: 'Add MCP server', detail: asString(input?.name) ?? asString(input?.url) }
    case 'listMcpServers':
      return { verb: 'List MCP servers' }
    case 'listMcpTools':
      return { verb: 'List MCP tools', detail: asString(input?.serverName) ?? asString(input?.server) }
    case 'executeMcpTool': {
      const server = asString(input?.serverName) ?? asString(input?.server)
      const toolName = asString(input?.toolName) ?? asString(input?.tool)
      return { verb: server ?? 'MCP', detail: toolName, detailMono: true }
    }
    case 'web-search': {
      const results = Array.isArray(asRecord(tool.result)?.results)
        ? (asRecord(tool.result)!.results as unknown[]).length
        : undefined
      return {
        verb: 'Web search',
        detail: asString(input?.query) ? `"${input!.query}"` : undefined,
        stat: done && results !== undefined ? plural(results, 'result') : undefined,
      }
    }
    case 'save-to-memory':
      return { verb: 'Memory', detail: asString(input?.title) ?? asString(input?.content)?.slice(0, 64) }
    case 'composio-execute-tool': {
      const toolkitSlug = asString(input?.toolkitSlug) ?? ''
      const toolkit = COMPOSIO_DISPLAY_NAMES[toolkitSlug] || toolkitSlug
      const readable = (asString(input?.toolSlug) ?? '')
        .replace(/^[A-Z0-9]+_/, '')
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/^\w/, (c) => c.toUpperCase())
      const failed = done && asRecord(tool.result)?.successful === false
      return {
        verb: toolkit || 'Integration',
        detail: readable || undefined,
        stat: failed ? 'failed' : undefined,
      }
    }
    default: {
      // Sentence-style dynamic labels (browser, app-navigation, composio
      // search/list) become the whole row title.
      const dynamicLabel =
        getBrowserControlLabel(tool) ??
        getAppActionCardData(tool)?.label ??
        getComposioActionCardData(tool)?.label
      if (dynamicLabel) return { verb: dynamicLabel }
      const named = TOOL_DISPLAY_NAMES[tool.name]
      if (named) return { verb: named }
      // Unknown/MCP-style tools: tool name + first meaningful primitive arg.
      const primary = input
        ? asString(input.description) ?? asString(input.query) ?? asString(input.url) ??
          asString(input.filePath) ?? asString(input.path) ?? asString(input.pattern) ?? asString(input.name)
        : undefined
      return { verb: tool.name, detail: primary }
    }
  }
}

// Composio action card data (for search, execute, list tools)
export type ComposioActionCardData = {
  actionType: 'search' | 'execute' | 'list'
  label: string
}

export const getComposioActionCardData = (tool: ToolCall): ComposioActionCardData | null => {
  const input = normalizeToolInput(tool.input) as Record<string, unknown> | undefined
  const result = tool.result as Record<string, unknown> | undefined

  if (tool.name === 'composio-search-tools') {
    const query = (input?.query as string) || 'tools'
    const toolkitSlug = input?.toolkitSlug as string | undefined
    const toolkit = toolkitSlug ? COMPOSIO_DISPLAY_NAMES[toolkitSlug] || toolkitSlug : null
    const count = (result?.resultCount as number) ?? null

    let label = `Searching for "${query}"`
    if (toolkit) label += ` in ${toolkit}`
    if (count !== null && tool.status === 'completed') {
      label = count > 0 ? `Found ${count} tool${count !== 1 ? 's' : ''} for "${query}"` : `No tools found for "${query}"`
      if (toolkit) label += ` in ${toolkit}`
    }
    return { actionType: 'search', label }
  }

  if (tool.name === 'composio-execute-tool') {
    const toolSlug = (input?.toolSlug as string) || ''
    const toolkitSlug = (input?.toolkitSlug as string) || ''
    const toolkit = COMPOSIO_DISPLAY_NAMES[toolkitSlug] || toolkitSlug
    const successful = result?.successful as boolean | undefined

    // Make the tool slug human-readable: GITHUB_ISSUES_LIST_FOR_REPO → "Issues list for repo"
    const readableName = toolSlug
      .replace(/^[A-Z]+_/, '') // Remove toolkit prefix
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^\w/, c => c.toUpperCase())

    let label = `Running ${readableName}`
    if (toolkit) label += ` on ${toolkit}`
    if (tool.status === 'completed') {
      label = successful === false ? `Failed: ${readableName}` : `${readableName}`
      if (toolkit) label += ` on ${toolkit}`
    }
    return { actionType: 'execute', label }
  }

  if (tool.name === 'composio-list-toolkits') {
    const count = (result?.totalCount as number) ?? null
    const connected = (result?.connectedCount as number) ?? null

    let label = 'Listing available integrations'
    if (count !== null && tool.status === 'completed') {
      label = `${count} integrations available`
      if (connected !== null && connected > 0) label += `, ${connected} connected`
    }
    return { actionType: 'list', label }
  }

  return null
}

export type ToolGroup = {
  type: 'tool-group'
  items: ToolCall[]
  groupId: string
}

export type GroupedConversationItem = ConversationItem | ToolGroup

export const isToolGroup = (item: GroupedConversationItem): item is ToolGroup =>
  'type' in item && (item as ToolGroup).type === 'tool-group'

const isPlainToolCall = (item: ConversationItem): item is ToolCall => {
  if (!isToolCall(item)) return false
  if (item.name === 'code_agent_run') return false // rich standalone block, never grouped
  if (item.name === 'spawn-agent') return false // rich standalone block, never grouped
  if (item.name === 'ask-human') return false // question card, never swallowed into a tool group
  if (getWebSearchCardData(item)) return false
  if (getComposioConnectCardData(item)) return false
  if (getAppActionCardData(item)) return false
  return true
}

export const groupConversationItems = (
  items: ConversationItem[],
  hasPermissionRequest: (id: string) => boolean
): GroupedConversationItem[] => {
  const result: GroupedConversationItem[] = []
  let i = 0

  while (i < items.length) {
    const item = items[i]
    if (isPlainToolCall(item) && !hasPermissionRequest(item.id)) {
      const group: ToolCall[] = [item]
      i++
      while (
        i < items.length &&
        isPlainToolCall(items[i] as ConversationItem) &&
        !hasPermissionRequest((items[i] as ToolCall).id)
      ) {
        group.push(items[i] as ToolCall)
        i++
      }
      if (group.length === 1) {
        result.push(group[0])
      } else {
        result.push({ type: 'tool-group', items: group, groupId: group[0].id })
      }
    } else {
      result.push(item)
      i++
    }
  }

  return result
}

export const getToolGroupSummary = (tools: ToolCall[]): string => {
  const seen = new Set<string>()
  const names: string[] = []
  for (const tool of tools) {
    const name = getToolDisplayName(tool)
    if (!seen.has(name)) {
      seen.add(name)
      names.push(name)
    }
  }
  return names.join(' · ')
}

// Past-tense action phrases for summarizing a finished tool group, e.g.
// "read 3 files, listed directory". Keyed by builtin tool name.
const TOOL_ACTION_VERBS: Record<string, { verb: string; one: string; many: string }> = {
  'file-readText': { verb: 'read', one: 'file', many: 'files' },
  'file-writeText': { verb: 'wrote', one: 'file', many: 'files' },
  'file-editText': { verb: 'edited', one: 'file', many: 'files' },
  'file-list': { verb: 'listed', one: 'directory', many: 'directories' },
  'file-exists': { verb: 'checked', one: 'path', many: 'paths' },
  'file-stat': { verb: 'inspected', one: 'file', many: 'files' },
  'file-glob': { verb: 'searched for', one: 'file', many: 'files' },
  'file-grep': { verb: 'searched', one: 'file', many: 'files' },
  'file-mkdir': { verb: 'created', one: 'directory', many: 'directories' },
  'file-rename': { verb: 'renamed', one: 'file', many: 'files' },
  'file-copy': { verb: 'copied', one: 'file', many: 'files' },
  'file-remove': { verb: 'removed', one: 'file', many: 'files' },
  'file-getRoot': { verb: 'resolved', one: 'file root', many: 'file roots' },
  'executeCommand': { verb: 'ran', one: 'command', many: 'commands' },
  'executeMcpTool': { verb: 'ran', one: 'MCP tool', many: 'MCP tools' },
  'listMcpServers': { verb: 'listed', one: 'MCP server', many: 'MCP servers' },
  'listMcpTools': { verb: 'listed', one: 'MCP tool', many: 'MCP tools' },
  'save-to-memory': { verb: 'saved', one: 'memory', many: 'memories' },
  'loadSkill': { verb: 'loaded', one: 'skill', many: 'skills' },
  'parseFile': { verb: 'parsed', one: 'file', many: 'files' },
}

// Summarize what a group of tools actually did, grouping identical actions
// and counting them: "read 3 files, listed directory". Unmapped tools fall
// back to their lowercased display name.
export const getToolActionsSummary = (tools: ToolCall[]): string => {
  const order: string[] = []
  const grouped = new Map<string, { phrase: typeof TOOL_ACTION_VERBS[string] | null; count: number; fallback: string }>()
  for (const tool of tools) {
    const phrase = TOOL_ACTION_VERBS[tool.name] ?? null
    const key = phrase ? `${phrase.verb}|${phrase.one}` : tool.name
    const existing = grouped.get(key)
    if (existing) {
      existing.count++
    } else {
      grouped.set(key, { phrase, count: 1, fallback: getToolDisplayName(tool) })
      order.push(key)
    }
  }
  const phrases = order.map((key) => {
    const { phrase, count, fallback } = grouped.get(key)!
    if (!phrase) return fallback.toLowerCase()
    if (count > 1) return `${phrase.verb} ${count} ${phrase.many}`
    const article = /^[aeiou]/i.test(phrase.one) ? 'an' : 'a'
    return `${phrase.verb} ${article} ${phrase.one}`
  })
  // Show at most two operations; collapse the rest into "more...".
  const MAX_ACTIONS = 2
  if (phrases.length > MAX_ACTIONS) {
    return `${phrases.slice(0, MAX_ACTIONS).join(', ')}, more...`
  }
  return phrases.join(', ')
}

export const inferRunTitleFromMessage = (content: string): string | undefined => {
  const { message } = parseAttachedFiles(content)
  const normalized = message.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  return normalized.length > 100 ? normalized.substring(0, 100) : normalized
}
