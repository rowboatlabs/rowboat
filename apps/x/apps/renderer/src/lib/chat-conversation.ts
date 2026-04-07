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

export const inferRunTitleFromMessage = (content: string): string | undefined => {
  const { message } = parseAttachedFiles(content)
  const normalized = message.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  return normalized.length > 100 ? normalized.substring(0, 100) : normalized
}
