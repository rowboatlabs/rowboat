import type { z } from 'zod'
import type {
  AskHumanRequestEvent,
  ToolPermissionAutoDecisionEvent,
  ToolPermissionMetadata,
  ToolPermissionRequestEvent,
} from '@x/shared/src/runs.js'
import {
  deriveTurnStatus,
  outstandingAsyncTools,
  outstandingPermissions,
  type ToolCallState,
  type TurnState,
  type TurnStreamEvent,
} from '@x/shared/src/turns.js'
import type { CodeRunEvent, PermissionAsk } from '@x/shared/src/code-mode.js'
import type {
  ChatMessage,
  ConversationItem,
  ErrorMessage,
  MessageAttachment,
  PermissionResponse,
  ToolCall,
} from '@/lib/chat-conversation'

// Pure derivations from reduced turn state (+ the ephemeral live overlay) to
// the view shapes the existing chat components already consume. No IPC, no
// React — everything here is unit-testable with plain state values.

// ---------------------------------------------------------------------------
// Live overlay: ephemeral streaming buffers (turn-runtime-design.md §14.4).
// ---------------------------------------------------------------------------

export type LiveOverlay = {
  text: string
  reasoning: string
  toolOutput: Record<string, string>
  // Speakable segments seen while streaming, in order, monotonically growing
  // for the lifetime of the overlay (i.e. one active turn). Usually the
  // contents of completed <voice>…</voice> blocks, but a long still-open
  // block may emit an early clause (see EARLY_SPEECH_MIN_CHARS) so speech
  // can start before the sentence finishes generating. Consumers speak
  // segments beyond what they've already spoken; the overlay reset on turn
  // switch starts a fresh list.
  voiceSegments: string[]
  // Scan cursor into `text` — everything before it has been checked for
  // complete voice blocks.
  voiceScanIndex: number
  // Chars of the currently-open voice block's content already emitted as an
  // early clause — the block's remainder (on close) excludes them.
  voicePartialConsumed: number
}

export const emptyOverlay = (): LiveOverlay => ({
  text: '',
  reasoning: '',
  toolOutput: {},
  voiceSegments: [],
  voiceScanIndex: 0,
  voicePartialConsumed: 0,
})

// The model emits <voice>…</voice> around speakable text when voice output
// is enabled; tags are never shown to the user.
export function stripVoiceTags(text: string): string {
  return text.replace(/<\/?voice>/g, '')
}

const VOICE_BLOCK = /<voice>([\s\S]*?)<\/voice>/g
const VOICE_OPEN_TAG = '<voice>'

// Early speech: once an open block has this many unconsumed chars, its last
// complete clause is emitted immediately instead of waiting for </voice> —
// TTS starts on the first clause while the rest of the sentence generates.
const EARLY_SPEECH_MIN_CHARS = 60
// ...but never emit a fragment shorter than this (prosody suffers).
const EARLY_SPEECH_MIN_EMIT = 30
// Clause boundaries (punctuation, optionally inside closing quote/paren,
// followed by whitespace or end-of-buffer).
const CLAUSE_BOUNDARY = /[,;:.!?…—]["')\]]*(?=\s|$)/g

// Accumulates deltas; canonical durable events supersede the buffers (the
// committed transcript now contains what was streaming).
export function applyOverlay(overlay: LiveOverlay, event: TurnStreamEvent): LiveOverlay {
  switch (event.type) {
    case 'text_delta': {
      const text = overlay.text + event.delta
      // Extract complete voice blocks past the scan cursor. Incomplete
      // blocks (opening tag seen, closing not yet) stay unconsumed until a
      // later delta completes them. The first complete block may have had an
      // early clause emitted while it was open — skip those chars.
      const segments: string[] = []
      let scanIndex = overlay.voiceScanIndex
      let partialConsumed = overlay.voicePartialConsumed
      VOICE_BLOCK.lastIndex = scanIndex
      for (let m = VOICE_BLOCK.exec(text); m; m = VOICE_BLOCK.exec(text)) {
        const content = m[1].slice(partialConsumed).trim()
        partialConsumed = 0
        if (content) segments.push(content)
        scanIndex = m.index + m[0].length
      }

      // Early speech: if a voice block is still open and has accumulated a
      // long unconsumed run, emit its last complete clause now — speech can
      // start while the rest of the sentence is still generating.
      const openIdx = text.indexOf(VOICE_OPEN_TAG, scanIndex)
      if (openIdx !== -1) {
        const unconsumed = text.slice(openIdx + VOICE_OPEN_TAG.length + partialConsumed)
        if (unconsumed.length >= EARLY_SPEECH_MIN_CHARS) {
          let lastBoundaryEnd = -1
          CLAUSE_BOUNDARY.lastIndex = 0
          for (let b = CLAUSE_BOUNDARY.exec(unconsumed); b; b = CLAUSE_BOUNDARY.exec(unconsumed)) {
            lastBoundaryEnd = b.index + b[0].length
          }
          if (lastBoundaryEnd >= EARLY_SPEECH_MIN_EMIT) {
            const clause = unconsumed.slice(0, lastBoundaryEnd).trim()
            if (clause) segments.push(clause)
            partialConsumed += lastBoundaryEnd
          }
        }
      } else {
        // No open block — any partial bookkeeping belongs to a block that
        // has since closed.
        partialConsumed = 0
      }

      return {
        ...overlay,
        text,
        ...(segments.length > 0
          ? { voiceSegments: [...overlay.voiceSegments, ...segments] }
          : {}),
        voiceScanIndex: scanIndex,
        voicePartialConsumed: partialConsumed,
      }
    }
    case 'reasoning_delta':
      return { ...overlay, reasoning: overlay.reasoning + event.delta }
    case 'model_call_completed':
      return { ...overlay, text: '', reasoning: '', voiceScanIndex: 0, voicePartialConsumed: 0 }
    case 'tool_progress': {
      const progress = event.progress
      if (
        progress &&
        typeof progress === 'object' &&
        !Array.isArray(progress) &&
        (progress as { kind?: unknown }).kind === 'tool-output' &&
        typeof (progress as { chunk?: unknown }).chunk === 'string'
      ) {
        const chunk = (progress as { chunk: string }).chunk
        return {
          ...overlay,
          toolOutput: {
            ...overlay.toolOutput,
            [event.toolCallId]: (overlay.toolOutput[event.toolCallId] ?? '') + chunk,
          },
        }
      }
      return overlay
    }
    case 'tool_result': {
      if (!(event.toolCallId in overlay.toolOutput)) return overlay
      const toolOutput = { ...overlay.toolOutput }
      delete toolOutput[event.toolCallId]
      return { ...overlay, toolOutput }
    }
    default:
      return overlay
  }
}

// ---------------------------------------------------------------------------
// Conversation items
// ---------------------------------------------------------------------------

type UserContent = TurnState['definition']['input']['content']

function extractText(content: UserContent): string {
  if (typeof content === 'string') return content
  return content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
}

function extractAttachments(content: UserContent): MessageAttachment[] | undefined {
  if (typeof content === 'string') return undefined
  const attachments = content.flatMap((part) =>
    part.type === 'attachment'
      ? [
          {
            path: part.path,
            filename: part.filename,
            mimeType: part.mimeType,
            ...(part.size === undefined ? {} : { size: part.size }),
          },
        ]
      : [],
  )
  return attachments.length > 0 ? attachments : undefined
}

function toolStatus(tc: ToolCallState): ToolCall['status'] {
  if (tc.result) return tc.result.result.isError ? 'error' : 'completed'
  if (tc.permission && !tc.permission.resolved) return 'pending'
  return 'running'
}

// code_agent_run's durable trail in tool_progress (see the publish bridge in
// real-tool-registry.ts): ONE settle-time 'code-run-events' batch carrying the
// whole timeline (the live per-event stream travels over the ephemeral
// CodeRunFeed and never reaches turn state), plus per-ask
// 'code-run-permission-request' / 'code-run-permission-resolved' pairs. An ask
// is pending while requests outnumber resolutions and the tool hasn't settled.
function codeRunViewOf(
  tc: ToolCallState,
): Pick<ToolCall, 'codeRunEvents' | 'pendingCodePermission'> {
  let events: CodeRunEvent[] | undefined
  let pending: { requestId: string; ask: PermissionAsk } | null = null
  let unresolved = 0
  for (const p of tc.progress) {
    const entry = p.progress
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const kind = (entry as { kind?: unknown }).kind
    if (kind === 'code-run-events') {
      const batch = (entry as { events?: unknown }).events
      if (Array.isArray(batch)) events = batch as CodeRunEvent[]
    } else if (kind === 'code-run-permission-request') {
      const { requestId, ask } = entry as { requestId?: unknown; ask?: unknown }
      if (typeof requestId === 'string' && ask) {
        pending = { requestId, ask: ask as PermissionAsk }
        unresolved += 1
      }
    } else if (kind === 'code-run-permission-resolved') {
      unresolved -= 1
    }
  }
  return {
    ...(events && events.length > 0 ? { codeRunEvents: events } : {}),
    ...(pending && unresolved > 0 && !tc.result ? { pendingCodePermission: pending } : {}),
  }
}

// One turn's contribution to the conversation: the user input, then per
// completed model call its text and tool calls (with live status/results).
export function buildTurnConversation(state: TurnState): ConversationItem[] {
  const items: ConversationItem[] = []
  const turnId = state.definition.turnId
  let seq = 0
  const ts = () => Date.parse(state.definition.ts) + seq++

  const userText = extractText(state.definition.input.content)
  const attachments = extractAttachments(state.definition.input.content)
  if (userText || attachments) {
    items.push({
      id: `${turnId}:user`,
      role: 'user',
      content: userText,
      timestamp: ts(),
      ...(attachments ? { attachments } : {}),
    } satisfies ChatMessage)
  }

  const toolCallsById = new Map(state.toolCalls.map((tc) => [tc.toolCallId, tc]))
  for (const call of state.modelCalls) {
    if (call.response === undefined) continue
    const content = call.response.content
    // Voice tags are model-facing markup, never shown (parity with the
    // legacy path's display-time strip).
    const text = stripVoiceTags(
      typeof content === 'string'
        ? content
        : content
            .map((part) => (part.type === 'text' ? part.text : ''))
            .filter(Boolean)
            .join('\n'),
    )
    if (text) {
      items.push({
        id: `${turnId}:a${call.index}`,
        role: 'assistant',
        content: text,
        timestamp: ts(),
      } satisfies ChatMessage)
    }
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type !== 'tool-call') continue
        const tc = toolCallsById.get(part.toolCallId)
        items.push({
          id: part.toolCallId,
          name: part.toolName,
          input: part.arguments as ToolCall['input'],
          ...(tc?.result ? { result: tc.result.result.output as ToolCall['result'] } : {}),
          status: tc ? toolStatus(tc) : 'running',
          timestamp: ts(),
          ...(tc ? codeRunViewOf(tc) : {}),
        } satisfies ToolCall)
      }
    }
  }

  if (state.terminal?.type === 'turn_failed') {
    items.push({
      id: `${turnId}:error`,
      kind: 'error',
      message: state.terminal.error,
      timestamp: ts(),
    } satisfies ErrorMessage)
  }

  return items
}

// ---------------------------------------------------------------------------
// Session chat state (superset of the ChatTabViewState fields)
// ---------------------------------------------------------------------------

type PermMeta = z.infer<typeof ToolPermissionMetadata>

export type SessionChatState = {
  conversation: ConversationItem[]
  currentAssistantMessage: string
  // See LiveOverlay.voiceSegments.
  voiceSegments: string[]
  pendingAskHumanRequests: Map<string, z.infer<typeof AskHumanRequestEvent>>
  allPermissionRequests: Map<string, z.infer<typeof ToolPermissionRequestEvent>>
  permissionResponses: Map<string, PermissionResponse>
  autoPermissionDecisions: Map<string, z.infer<typeof ToolPermissionAutoDecisionEvent>>
  // Composer blocked / Stop shown until the latest turn settles (waiting on a
  // permission or ask-human still counts as processing).
  isProcessing: boolean
  // Actively working (non-terminal, nothing waiting on the user) — drives the
  // "Thinking…" shimmer; deliberately false under permission/ask-human cards.
  isThinking: boolean
}

function toolCallPartOf(tc: ToolCallState) {
  return {
    type: 'tool-call' as const,
    toolCallId: tc.toolCallId,
    toolName: tc.toolName,
    arguments: tc.input,
  }
}

// Compose the whole session's conversation: prior (settled) turns plus the
// latest turn, with the live overlay stitched onto the latest turn's items.
export function buildSessionChatState(
  turns: TurnState[],
  overlay: LiveOverlay,
): SessionChatState {
  const conversation: ConversationItem[] = []
  for (const turn of turns) {
    conversation.push(...buildTurnConversation(turn))
  }
  for (let i = 0; i < conversation.length; i++) {
    const item = conversation[i]
    if ('name' in item && overlay.toolOutput[item.id]) {
      conversation[i] = { ...item, streamingOutput: overlay.toolOutput[item.id] }
    }
  }

  const latest = turns[turns.length - 1]
  const status = latest ? deriveTurnStatus(latest) : undefined
  const latestTurnId = latest?.definition.turnId ?? ''

  const allPermissionRequests = new Map<string, z.infer<typeof ToolPermissionRequestEvent>>()
  const permissionResponses = new Map<string, PermissionResponse>()
  const autoPermissionDecisions = new Map<
    string,
    z.infer<typeof ToolPermissionAutoDecisionEvent>
  >()
  const pendingAskHumanRequests = new Map<string, z.infer<typeof AskHumanRequestEvent>>()

  if (latest) {
    for (const tc of outstandingPermissions(latest)) {
      allPermissionRequests.set(tc.toolCallId, {
        runId: latestTurnId,
        type: 'tool-permission-request',
        subflow: [],
        toolCall: toolCallPartOf(tc),
        permission: tc.permission?.required.request as PermMeta,
      })
    }
    for (const tc of latest.toolCalls) {
      const resolved = tc.permission?.resolved
      if (!resolved) continue
      if (resolved.source === 'human') {
        permissionResponses.set(tc.toolCallId, resolved.decision === 'allow' ? 'approve' : 'deny')
      } else if (resolved.source === 'classifier') {
        autoPermissionDecisions.set(tc.toolCallId, {
          runId: latestTurnId,
          type: 'tool-permission-auto-decision',
          subflow: [],
          toolCallId: tc.toolCallId,
          toolCall: toolCallPartOf(tc),
          permission: tc.permission?.required.request as PermMeta,
          decision: resolved.decision,
          reason: resolved.reason ?? '',
        })
      }
    }
    for (const tc of outstandingAsyncTools(latest)) {
      if (tc.toolName !== 'ask-human') continue
      const input = (tc.input ?? {}) as { question?: unknown; options?: unknown }
      pendingAskHumanRequests.set(tc.toolCallId, {
        runId: latestTurnId,
        type: 'ask-human-request',
        toolCallId: tc.toolCallId,
        subflow: [],
        query: typeof input.question === 'string' ? input.question : '',
        ...(Array.isArray(input.options) && input.options.every((o) => typeof o === 'string')
          ? { options: input.options }
          : {}),
      })
    }
  }

  const settled = status === 'completed' || status === 'failed' || status === 'cancelled'
  return {
    conversation,
    currentAssistantMessage: stripVoiceTags(overlay.text),
    voiceSegments: overlay.voiceSegments,
    pendingAskHumanRequests,
    allPermissionRequests,
    permissionResponses,
    autoPermissionDecisions,
    isProcessing: latest !== undefined && !settled,
    isThinking: status === 'idle',
  }
}
