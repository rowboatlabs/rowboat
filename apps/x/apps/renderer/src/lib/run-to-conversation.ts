import type z from 'zod'
import type { RunEvent } from '@x/shared/dist/runs.js'
import {
  type ChatMessage,
  type ConversationItem,
  type ToolCall,
  normalizeToolInput,
} from './chat-conversation'

type RunLog = z.infer<typeof RunEvent>[]

/**
 * Convert a closed Run.log into a flat list of ConversationItems suitable
 * for read-only playback. Adapted from App.tsx's live-streaming converter
 * (lines ~1731-1843) but trimmed for static history:
 *
 *  - drops llm-stream-event (reasoning lands in the final message)
 *  - drops run-processing-* / start / spawn-subflow (lifecycle, not content)
 *  - drops system/tool-role messages (only user + assistant surface)
 *  - drops permission/ask-human (live-only flows)
 */
export function runLogToConversation(log: RunLog): ConversationItem[] {
  const items: ConversationItem[] = []
  const toolCallMap = new Map<string, ToolCall>()

  for (const event of log) {
    switch (event.type) {
      case 'message': {
        const msg = event.message
        if (msg.role !== 'user' && msg.role !== 'assistant') break

        let textContent = ''
        let msgAttachments: ChatMessage['attachments']
        if (typeof msg.content === 'string') {
          textContent = msg.content
        } else if (Array.isArray(msg.content)) {
          const parts = msg.content as Array<{
            type: string
            text?: string
            path?: string
            filename?: string
            mimeType?: string
            size?: number
            data?: string
            mediaType?: string
            toolCallId?: string
            toolName?: string
            arguments?: unknown
          }>

          textContent = parts
            .filter((p) => p.type === 'text')
            .map((p) => p.text ?? '')
            .join('')

          const attachmentParts = parts.filter((p) => p.type === 'attachment' && p.path)
          // Video-mode webcam frames — inline base64 image parts, shown as a filmstrip
          const imageParts = parts.filter((p) => p.type === 'image' && p.data)
          if (attachmentParts.length > 0 || imageParts.length > 0) {
            msgAttachments = [
              ...attachmentParts.map((p) => ({
                path: p.path!,
                filename: p.filename || p.path!.split('/').pop() || p.path!,
                mimeType: p.mimeType || 'application/octet-stream',
                size: p.size,
              })),
              ...imageParts.map((p, index) => ({
                path: '',
                filename: `camera-frame-${index + 1}.jpg`,
                mimeType: p.mediaType || 'image/jpeg',
                thumbnailUrl: `data:${p.mediaType || 'image/jpeg'};base64,${p.data}`,
                isVideoFrame: true,
              })),
            ]
          }

          if (msg.role === 'assistant') {
            for (const part of parts) {
              if (part.type === 'tool-call' && part.toolCallId && part.toolName) {
                const toolCall: ToolCall = {
                  id: part.toolCallId,
                  name: part.toolName,
                  input: normalizeToolInput(part.arguments as ToolCall['input']),
                  status: 'pending',
                  timestamp: event.ts ? new Date(event.ts).getTime() : Date.now(),
                }
                toolCallMap.set(toolCall.id, toolCall)
                items.push(toolCall)
              }
            }
          }
        }

        if (textContent || msgAttachments) {
          items.push({
            id: event.messageId,
            role: msg.role,
            content: textContent,
            attachments: msgAttachments,
            timestamp: event.ts ? new Date(event.ts).getTime() : Date.now(),
          })
        }
        break
      }

      case 'tool-invocation': {
        const existing = event.toolCallId ? toolCallMap.get(event.toolCallId) : null
        if (existing) {
          existing.input = normalizeToolInput(event.input)
          existing.status = 'running'
        } else {
          const toolCall: ToolCall = {
            id: event.toolCallId || `tool-${items.length}`,
            name: event.toolName,
            input: normalizeToolInput(event.input),
            status: 'running',
            timestamp: event.ts ? new Date(event.ts).getTime() : Date.now(),
          }
          if (event.toolCallId) toolCallMap.set(toolCall.id, toolCall)
          items.push(toolCall)
        }
        break
      }

      case 'tool-result': {
        const existing = event.toolCallId ? toolCallMap.get(event.toolCallId) : null
        if (existing) {
          existing.result = event.result
          existing.status = 'completed'
        }
        break
      }

      case 'error': {
        items.push({
          id: `error-${items.length}`,
          kind: 'error',
          message: event.error,
          timestamp: event.ts ? new Date(event.ts).getTime() : Date.now(),
        })
        break
      }

      // Everything else is lifecycle/streaming — not part of the rendered transcript.
      default:
        break
    }
  }

  return items
}
