import type { ToolUIPart } from 'ai'
import z from 'zod'
import { AskHumanRequestEvent, ToolPermissionRequestEvent } from '@x/shared/src/runs.js'
import { COMPOSIO_DISPLAY_NAMES } from '@x/shared/src/composio.js'

export interface MessageAttachment {
  path: string
  filename: string
  mimeType: string
  size?: number
  thumbnailUrl?: string
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
}

export interface ErrorMessage {
  id: string
  kind: 'error'
  message: string
  timestamp: number
}

export type ConversationItem = ChatMessage | ToolCall | ErrorMessage
export type PermissionResponse = 'approve' | 'deny'

export type ChatTabViewState = {
  runId: string | null
  conversation: ConversationItem[]
  currentAssistantMessage: string
  pendingAskHumanRequests: Map<string, z.infer<typeof AskHumanRequestEvent>>
  allPermissionRequests: Map<string, z.infer<typeof ToolPermissionRequestEvent>>
  permissionResponses: Map<string, PermissionResponse>
}

export type ChatViewportAnchorState = {
  messageId: string | null
  requestKey: number
}

export const createEmptyChatTabViewState = (): ChatTabViewState => ({
  runId: null,
  conversation: [],
  currentAssistantMessage: '',
  pendingAskHumanRequests: new Map(),
  allPermissionRequests: new Map(),
  permissionResponses: new Map(),
})

export type ToolState = 'input-streaming' | 'input-available' | 'output-available' | 'output-error'

export const isChatMessage = (item: ConversationItem): item is ChatMessage => 'role' in item
export const isToolCall = (item: ConversationItem): item is ToolCall => 'name' in item
export const isErrorMessage = (item: ConversationItem): item is ErrorMessage =>
  'kind' in item && item.kind === 'error'

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
      case 'open-view': return { action, label: `Opening ${input.view} view...` }
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
      return { action: 'open-view', label: `Opened ${result.view} view` }
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
  'workspace-readFile': 'Reading file',
  'workspace-writeFile': 'Writing file',
  'workspace-edit': 'Editing file',
  'workspace-readdir': 'Reading directory',
  'workspace-exists': 'Checking path',
  'workspace-stat': 'Getting file info',
  'workspace-glob': 'Finding files',
  'workspace-grep': 'Searching files',
  'workspace-mkdir': 'Creating directory',
  'workspace-rename': 'Renaming',
  'workspace-copy': 'Copying file',
  'workspace-remove': 'Removing',
  'workspace-getRoot': 'Getting workspace root',
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

export const inferRunTitleFromMessage = (content: string): string | undefined => {
  const { message } = parseAttachedFiles(content)
  const normalized = message.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  return normalized.length > 100 ? normalized.substring(0, 100) : normalized
}
