import { z } from 'zod'
import type { AgentLoopTurn, TurnEvent } from '@x/shared/src/agent-turn.js'
import { deriveToolCallState, deriveTurnStatus, toolCallParts } from '@x/shared/src/agent-turn.js'
import type { Message, ToolCallPart } from '@x/shared/src/message.js'
import type { CodeRunEvent, PermissionAsk } from '@x/shared/src/code-mode.js'
import type { ChatMessage, ConversationItem, ToolCall } from './chat-conversation.js'

// Pure derivation of the chat view model from a turn. A turn snapshot →
// ConversationItem[] (the same shape the existing renderer renders), plus the
// pending permission / ask-human prompts. Live deltas (streaming text, tool
// output) are layered on top via LiveOverlay. Everything here is pure and
// unit-tested; the hooks are thin wrappers that feed snapshots + events in.

type Turn = z.infer<typeof AgentLoopTurn>
type Msg = z.infer<typeof Message>

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && (part as { type?: string }).type === 'text'
          ? String((part as { text?: unknown }).text ?? '')
          : '',
      )
      .join('')
  }
  return ''
}

function extractAttachments(content: unknown): ChatMessage['attachments'] {
  if (!Array.isArray(content)) return undefined
  const atts = content
    .filter((p) => p && typeof p === 'object' && (p as { type?: string }).type === 'attachment')
    .map((p) => {
      const a = p as { path: string; filename?: string; mimeType?: string; size?: number }
      return {
        path: a.path,
        filename: a.filename || a.path.split('/').pop() || a.path,
        mimeType: a.mimeType || 'application/octet-stream',
        ...(a.size !== undefined ? { size: a.size } : {}),
      }
    })
  return atts.length > 0 ? atts : undefined
}

function parseResult(content: string): ToolCall['result'] {
  try {
    return JSON.parse(content)
  } catch {
    return content
  }
}

// Map a derived tool-call state to the renderer's ToolCall status.
function toolStatus(state: ReturnType<typeof deriveToolCallState>): ToolCall['status'] {
  switch (state) {
    case 'resolved':
      return 'completed'
    case 'awaiting-user':
      return 'pending'
    case 'interrupted':
      return 'error'
    default:
      // dispatched / cleared / unevaluated / needs-classifier — work in flight
      return 'running'
  }
}

// Turn messages → ordered conversation items (user/assistant bubbles + tool
// cards). Tool results from tool messages are merged into their tool call.
export function buildConversation(turn: Turn): ConversationItem[] {
  const items: ConversationItem[] = []
  const toolsById = new Map<string, ToolCall>()
  let seq = 0
  const ts = () => Date.parse(turn.createdAt) + seq++

  for (const message of turn.messages as Msg[]) {
    if (message.role === 'user') {
      const text = extractText(message.content)
      const attachments = extractAttachments(message.content)
      if (text || attachments) {
        items.push({
          id: `u-${seq}`,
          role: 'user',
          content: text,
          timestamp: ts(),
          ...(attachments ? { attachments } : {}),
        })
      }
      continue
    }
    if (message.role === 'assistant') {
      const text = extractText(message.content)
      if (text) items.push({ id: `a-${seq}`, role: 'assistant', content: text, timestamp: ts() })
      if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type !== 'tool-call') continue
          const tool: ToolCall = {
            id: part.toolCallId,
            name: part.toolName,
            input: part.arguments as ToolCall['input'],
            status: toolStatus(deriveToolCallState(turn, part.toolCallId)),
            timestamp: ts(),
          }
          toolsById.set(part.toolCallId, tool)
          items.push(tool)
        }
      }
      continue
    }
    if (message.role === 'tool') {
      const tool = toolsById.get(message.toolCallId)
      if (tool) {
        tool.result = parseResult(message.content)
        tool.status = toolStatus(deriveToolCallState(turn, message.toolCallId))
      }
    }
  }

  return items
}

// Tool calls awaiting a user permission decision (manual mode / classifier
// abstained), with the originating tool call + the request payload the renderer
// renders into a card.
export function pendingPermissions(
  turn: Turn,
): { toolCall: z.infer<typeof ToolCallPart>; request: unknown }[] {
  const parts = toolCallParts(turn)
  const result: { toolCall: z.infer<typeof ToolCallPart>; request: unknown }[] = []
  for (const req of turn.permissionRequests) {
    if (deriveToolCallState(turn, req.toolCallId) !== 'awaiting-user') continue
    const toolCall = parts.find((p) => p.toolCallId === req.toolCallId)
    if (toolCall) result.push({ toolCall, request: req.request })
  }
  return result
}

// Unresolved ask-human calls (dispatched tools named "ask-human"), with the
// question + options pulled from the call arguments.
export function pendingAskHuman(turn: Turn): { toolCallId: string; question: string; options?: string[] }[] {
  const out: { toolCallId: string; question: string; options?: string[] }[] = []
  for (const message of turn.messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (part.type !== 'tool-call' || part.toolName !== 'ask-human') continue
      if (deriveToolCallState(turn, part.toolCallId) !== 'dispatched') continue
      const args = (part.arguments ?? {}) as { question?: unknown; options?: unknown }
      out.push({
        toolCallId: part.toolCallId,
        question: typeof args.question === 'string' ? args.question : '',
        ...(Array.isArray(args.options) ? { options: args.options.map(String) } : {}),
      })
    }
  }
  return out
}

export function turnStatus(turn: Turn): ReturnType<typeof deriveTurnStatus> {
  return deriveTurnStatus(turn)
}

// ─── Live overlay (streaming deltas applied on top of the latest snapshot) ────

export type LiveOverlay = {
  text: string
  toolOutput: Record<string, string>
  // code_agent_run (rowboat) live activity, keyed by the owning tool call id.
  // These are live-only: a completed turn collapses to the tool's final result.
  codeRunEvents: Record<string, CodeRunEvent[]>
  codePermission: Record<string, { requestId: string; ask: PermissionAsk } | null>
}

export const emptyOverlay = (): LiveOverlay => ({
  text: '',
  toolOutput: {},
  codeRunEvents: {},
  codePermission: {},
})

// Accumulate a live event onto the overlay. A fresh state snapshot supersedes
// the overlay (the committed transcript now includes what was streaming), so
// the hook resets to emptyOverlay() on each snapshot.
export function applyOverlay(overlay: LiveOverlay, event: TurnEvent): LiveOverlay {
  switch (event.type) {
    case 'text-delta':
      return { ...overlay, text: overlay.text + event.delta }
    case 'tool-output':
      return {
        ...overlay,
        toolOutput: {
          ...overlay.toolOutput,
          [event.toolCallId]: (overlay.toolOutput[event.toolCallId] ?? '') + event.chunk,
        },
      }
    case 'code-run-event':
      return {
        ...overlay,
        codeRunEvents: {
          ...overlay.codeRunEvents,
          [event.toolCallId]: [...(overlay.codeRunEvents[event.toolCallId] ?? []), event.event],
        },
      }
    case 'code-run-permission-request':
      return {
        ...overlay,
        codePermission: {
          ...overlay.codePermission,
          [event.toolCallId]: { requestId: event.requestId, ask: event.ask },
        },
      }
    case 'tool-result':
      // The ACP call resolved — drop any lingering code permission card for it.
      if (overlay.codePermission[event.toolCallId]) {
        return {
          ...overlay,
          codePermission: { ...overlay.codePermission, [event.toolCallId]: null },
        }
      }
      return overlay
    default:
      return overlay
  }
}
