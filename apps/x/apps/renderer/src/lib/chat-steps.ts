// BAARALI(05/10/2026): the chat without its backstage (mockup validated by
// the founder). Asked for an image, a person saw « Load skill builtin-tools ·
// 76 tools attached », « listed a MCP server, loaded a skill » and a
// « Thought for a few seconds » between every step: how the agent finds
// its tools, not what it does for them. Those rows are left out of the chat
// (the conversation keeps them); a failed one still shows, with its error.

import { isReasoningMessage, isToolCall, type ConversationItem, type ToolCall } from '@/lib/chat-conversation'

/** How the agent equips itself, never something done for the person. */
const BACKSTAGE_TOOLS = new Set(['loadSkill', 'listMcpServers', 'listMcpTools', 'file-getRoot'])

/** The media server's price list: read before a generation, shown by the answer itself. */
const BACKSTAGE_MCP_TOOLS = new Set(['list_models'])

const mcpToolName = (tool: ToolCall): string | undefined => {
  const input = tool.input as Record<string, unknown> | undefined
  const name = input?.toolName ?? input?.tool
  return typeof name === 'string' ? name : undefined
}

export function isBackstage(item: ConversationItem): boolean {
  if (isReasoningMessage(item)) return item.streaming !== true
  if (!isToolCall(item) || item.status === 'error') return false
  if (BACKSTAGE_TOOLS.has(item.name)) return true
  return item.name === 'executeMcpTool' && BACKSTAGE_MCP_TOOLS.has(mcpToolName(item) ?? '')
}

/** The steps the person sees: what the agent does, and its thinking only while it thinks. */
export const shownSteps = (items: ConversationItem[]): ConversationItem[] => items.filter((item) => !isBackstage(item))
