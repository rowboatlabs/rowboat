import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Expand, Plus } from 'lucide-react'
import type { ToolUIPart } from 'ai'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from '@/components/ai-elements/conversation'
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { PermissionRequest } from '@/components/ai-elements/permission-request'
import { AskHumanRequest } from '@/components/ai-elements/ask-human-request'
import { Suggestions } from '@/components/ai-elements/suggestions'
import { type PromptInputMessage, type FileMention } from '@/components/ai-elements/prompt-input'
import { useMentionDetection } from '@/hooks/use-mention-detection'
import { MentionPopover } from '@/components/mention-popover'
import { toKnowledgePath, wikiLabel } from '@/lib/wiki-links'
import { getMentionHighlightSegments } from '@/lib/mention-highlights'
import { ToolPermissionRequestEvent, AskHumanRequestEvent } from '@x/shared/src/runs.js'
import z from 'zod'
import React from 'react'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

interface ToolCall {
  id: string
  name: string
  input: ToolUIPart['input']
  result?: ToolUIPart['output']
  status: 'pending' | 'running' | 'completed' | 'error'
  timestamp: number
}

interface ReasoningBlock {
  id: string
  content: string
  timestamp: number
}

type ConversationItem = ChatMessage | ToolCall | ReasoningBlock

type ToolState = 'input-streaming' | 'input-available' | 'output-available' | 'output-error'

const isChatMessage = (item: ConversationItem): item is ChatMessage => 'role' in item
const isToolCall = (item: ConversationItem): item is ToolCall => 'name' in item
const isReasoningBlock = (item: ConversationItem): item is ReasoningBlock =>
  'content' in item && !('role' in item) && !('name' in item)

const toToolState = (status: ToolCall['status']): ToolState => {
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

const normalizeToolInput = (input: ToolCall['input'] | string | undefined): ToolCall['input'] => {
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

const normalizeToolOutput = (output: ToolCall['result'] | undefined, status: ToolCall['status']) => {
  if (output === undefined || output === null) {
    return status === 'completed' ? 'No output returned.' : null
  }
  if (output === '') return '(empty output)'
  if (typeof output === 'boolean' || typeof output === 'number') return String(output)
  return output
}

const MIN_WIDTH = 300
const MAX_WIDTH = 700
const DEFAULT_WIDTH = 400

interface ChatSidebarProps {
  defaultWidth?: number
  isOpen?: boolean
  onNewChat: () => void
  onOpenFullScreen?: () => void
  conversation: ConversationItem[]
  currentAssistantMessage: string
  currentReasoning: string
  isProcessing: boolean
  message: string
  onMessageChange: (message: string) => void
  onSubmit: (message: PromptInputMessage, mentions?: FileMention[]) => void
  knowledgeFiles?: string[]
  recentFiles?: string[]
  visibleFiles?: string[]
  selectedPath?: string | null
  pendingPermissionRequests?: Map<string, z.infer<typeof ToolPermissionRequestEvent>>
  pendingAskHumanRequests?: Map<string, z.infer<typeof AskHumanRequestEvent>>
  allPermissionRequests?: Map<string, z.infer<typeof ToolPermissionRequestEvent>>
  permissionResponses?: Map<string, 'approve' | 'deny'>
  onPermissionResponse?: (toolCallId: string, subflow: string[], response: 'approve' | 'deny') => void
  onAskHumanResponse?: (toolCallId: string, subflow: string[], response: string) => void
}

export function ChatSidebar({
  defaultWidth = DEFAULT_WIDTH,
  isOpen = true,
  onNewChat,
  onOpenFullScreen,
  conversation,
  currentAssistantMessage,
  currentReasoning,
  isProcessing,
  message,
  onMessageChange,
  onSubmit,
  knowledgeFiles = [],
  recentFiles = [],
  visibleFiles = [],
  selectedPath,
  pendingAskHumanRequests = new Map(),
  allPermissionRequests = new Map(),
  permissionResponses = new Map(),
  onPermissionResponse,
  onAskHumanResponse,
}: ChatSidebarProps) {
  const [width, setWidth] = useState(defaultWidth)
  const [isResizing, setIsResizing] = useState(false)
  const [showContent, setShowContent] = useState(isOpen)

  // Delay showing content when opening, hide immediately when closing
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setShowContent(true), 150)
      return () => clearTimeout(timer)
    } else {
      setShowContent(false)
    }
  }, [isOpen])
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)
  const [mentions, setMentions] = useState<FileMention[]>([])
  const autoMentionRef = useRef<{ path: string; displayName: string } | null>(null)
  const lastSelectedPathRef = useRef<string | null>(null)

  // Build mention labels for highlighting (handles multi-word names like "AI Agents")
  const mentionLabels = useMemo(() => {
    if (knowledgeFiles.length === 0) return []
    const labels = knowledgeFiles
      .map((path) => wikiLabel(path))
      .map((label) => label.trim())
      .filter(Boolean)
    return Array.from(new Set(labels))
  }, [knowledgeFiles])

  const { activeMention, cursorCoords } = useMentionDetection(
    textareaRef,
    message,
    knowledgeFiles.length > 0
  )

  // Use proper regex-based highlight segmentation that handles multi-word names
  const mentionHighlights = useMemo(
    () => getMentionHighlightSegments(message, activeMention, mentionLabels),
    [message, activeMention, mentionLabels]
  )

  // Sync highlight overlay scroll with textarea
  const syncHighlightScroll = useCallback(() => {
    const textarea = textareaRef.current
    const highlight = highlightRef.current
    if (!textarea || !highlight) return
    highlight.scrollTop = textarea.scrollTop
    highlight.scrollLeft = textarea.scrollLeft
  }, [])

  useEffect(() => {
    syncHighlightScroll()
  }, [message, mentionHighlights.hasHighlights, syncHighlightScroll])

  const handleMentionSelect = useCallback(
    (path: string, displayName: string) => {
      if (!activeMention) return

      const beforeAt = message.substring(0, activeMention.triggerIndex)
      const afterQuery = message.substring(
        activeMention.triggerIndex + 1 + activeMention.query.length
      )

      const newText = `${beforeAt}@${displayName} ${afterQuery}`
      onMessageChange(newText)

      const fullPath = toKnowledgePath(path)
      if (fullPath) {
        setMentions(prev => {
          if (prev.some(m => m.path === fullPath)) return prev
          return [...prev, { id: `mention-${Date.now()}`, path: fullPath, displayName }]
        })
      }

      textareaRef.current?.focus()
    },
    [activeMention, message, onMessageChange]
  )

  const handleMentionClose = useCallback(() => {
    // The popover handles its own closing
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    startXRef.current = e.clientX
    startWidthRef.current = width
    setIsResizing(true)

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startXRef.current - e.clientX
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current + delta))
      setWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [width])

  // Auto-focus textarea when sidebar opens or when conversation is cleared (new chat)
  useEffect(() => {
    // Focus when conversation is empty (new chat started)
    if (conversation.length === 0) {
      const timer = setTimeout(() => {
        textareaRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [conversation.length])

  // Auto-populate with @currentfile when switching knowledge files
  useEffect(() => {
    if (selectedPath === lastSelectedPathRef.current) return
    lastSelectedPathRef.current = selectedPath ?? null

    if (!selectedPath || !selectedPath.startsWith('knowledge/') || !selectedPath.endsWith('.md')) {
      return
    }

    const displayName = wikiLabel(selectedPath)
    const previousAuto = autoMentionRef.current
    const trimmed = message.trim()
    const previousToken = previousAuto ? `@${previousAuto.displayName}` : null
    const shouldReplace = !trimmed || (previousToken && trimmed === previousToken)

    if (!shouldReplace) {
      return
    }

    const nextText = `@${displayName} `
    if (message !== nextText) {
      onMessageChange(nextText)
    }

    setMentions((prev) => {
      const withoutPrevious = previousAuto
        ? prev.filter((mention) => mention.path !== previousAuto.path)
        : prev
      if (withoutPrevious.some((mention) => mention.path === selectedPath)) {
        return withoutPrevious
      }
      return [
        ...withoutPrevious,
        {
          id: `mention-auto-${Date.now()}`,
          path: selectedPath,
          displayName,
        },
      ]
    })

    autoMentionRef.current = { path: selectedPath, displayName }
  }, [selectedPath, message, onMessageChange])

  const hasConversation = conversation.length > 0 || currentAssistantMessage || currentReasoning
  const canSubmit = Boolean(message.trim()) && !isProcessing

  const handleSubmit = () => {
    const trimmed = message.trim()
    if (trimmed && !isProcessing) {
      onSubmit({ text: trimmed, files: [] }, mentions)
      setMentions([])
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // If mention popover is open, let it handle navigation keys
    if (activeMention && ['ArrowDown', 'ArrowUp', 'Tab', 'Escape'].includes(e.key)) {
      return
    }

    if (e.key === 'Enter') {
      // If mention popover is open, Enter should select the item
      if (activeMention) {
        return
      }

      if (!e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    }

    // Handle backspace to delete entire mention at once
    if (e.key === 'Backspace') {
      const textarea = e.currentTarget
      const cursorPos = textarea.selectionStart
      const selectionEnd = textarea.selectionEnd

      // Only handle if no text is selected (cursor is at a single position)
      if (cursorPos !== selectionEnd) return

      // Check if cursor is right after a mention
      for (const label of mentionLabels) {
        const mentionText = `@${label}`
        const startPos = cursorPos - mentionText.length
        if (startPos >= 0) {
          const textBefore = message.substring(startPos, cursorPos)
          if (textBefore === mentionText) {
            // Check if it's at word boundary (start of string or preceded by whitespace)
            if (startPos === 0 || /\s/.test(message[startPos - 1])) {
              e.preventDefault()
              const newText = message.substring(0, startPos) + message.substring(cursorPos)
              onMessageChange(newText)
              // Remove the mention from state
              setMentions(prev => prev.filter(m => m.displayName !== label))
              // Set cursor position after React updates
              setTimeout(() => {
                textarea.selectionStart = startPos
                textarea.selectionEnd = startPos
              }, 0)
              return
            }
          }
        }
      }
    }
  }

  const renderConversationItem = (item: ConversationItem) => {
    if (isChatMessage(item)) {
      return (
        <Message key={item.id} from={item.role}>
          <MessageContent>
            {item.role === 'assistant' ? (
              <MessageResponse>{item.content}</MessageResponse>
            ) : (
              item.content
            )}
          </MessageContent>
        </Message>
      )
    }

    if (isToolCall(item)) {
      const errorText = item.status === 'error' ? 'Tool error' : ''
      const output = normalizeToolOutput(item.result, item.status)
      const input = normalizeToolInput(item.input)
      return (
        <Tool key={item.id}>
          <ToolHeader
            title={item.name}
            type={`tool-${item.name}`}
            state={toToolState(item.status)}
          />
          <ToolContent>
            <ToolInput input={input} />
            {output !== null ? (
              <ToolOutput output={output} errorText={errorText} />
            ) : null}
          </ToolContent>
        </Tool>
      )
    }

    if (isReasoningBlock(item)) {
      return (
        <Reasoning key={item.id}>
          <ReasoningTrigger />
          <ReasoningContent>{item.content}</ReasoningContent>
        </Reasoning>
      )
    }

    return null
  }

  const displayWidth = isOpen ? width : 0

  return (
    <div
      className={cn(
        "relative flex flex-col border-l border-border bg-background shrink-0 overflow-hidden",
        !isResizing && "transition-[width] duration-200 ease-linear"
      )}
      style={{ width: displayWidth }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          "absolute inset-y-0 left-0 z-20 w-4 -translate-x-1/2 cursor-col-resize",
          "after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:transition-colors",
          "hover:after:bg-sidebar-border",
          isResizing && "after:bg-primary"
        )}
      />

      {/* Content - delayed on open, hidden immediately on close to avoid layout issues during animation */}
      {showContent && (
        <>
          {/* Header - minimal, expand and new chat buttons */}
          <header className="flex h-12 shrink-0 items-center justify-end gap-1 px-2">
            {onOpenFullScreen && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={onOpenFullScreen} className="h-8 w-8 text-muted-foreground hover:text-foreground">
                    <Expand className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Full screen chat</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={onNewChat} className="h-8 w-8 text-muted-foreground hover:text-foreground">
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">New chat</TooltipContent>
            </Tooltip>
          </header>

      {/* Conversation area */}
      <div className="flex min-h-0 flex-1 flex-col relative">
        <Conversation className="relative flex-1 overflow-y-auto">
          <ConversationContent className={hasConversation ? "px-4 pb-24" : "px-4 min-h-full items-center justify-center"}>
            {!hasConversation ? (
              <ConversationEmptyState className="h-auto">
                <div className="flex flex-col items-center gap-1 text-center">
                  <div className="text-sm text-muted-foreground">
                    Ask anything...
                  </div>
                </div>
              </ConversationEmptyState>
            ) : (
              <>
                {conversation.map(item => {
                  const rendered = renderConversationItem(item)
                  // If this is a tool call, check for permission request (pending or responded)
                  if (isToolCall(item) && onPermissionResponse) {
                    const permRequest = allPermissionRequests.get(item.id)
                    if (permRequest) {
                      const response = permissionResponses.get(item.id) || null
                      return (
                        <React.Fragment key={item.id}>
                          {rendered}
                          <PermissionRequest
                            toolCall={permRequest.toolCall}
                            onApprove={() => onPermissionResponse(permRequest.toolCall.toolCallId, permRequest.subflow, 'approve')}
                            onDeny={() => onPermissionResponse(permRequest.toolCall.toolCallId, permRequest.subflow, 'deny')}
                            isProcessing={isProcessing}
                            response={response}
                          />
                        </React.Fragment>
                      )
                    }
                  }
                  return rendered
                })}

                {/* Render pending ask-human requests */}
                {onAskHumanResponse && Array.from(pendingAskHumanRequests.values()).map((request) => (
                  <AskHumanRequest
                    key={request.toolCallId}
                    query={request.query}
                    onResponse={(response) => onAskHumanResponse(request.toolCallId, request.subflow, response)}
                    isProcessing={isProcessing}
                  />
                ))}

                {currentReasoning && (
                  <Reasoning isStreaming>
                    <ReasoningTrigger />
                    <ReasoningContent>{currentReasoning}</ReasoningContent>
                  </Reasoning>
                )}

                {currentAssistantMessage && (
                  <Message from="assistant">
                    <MessageContent>
                      <MessageResponse>{currentAssistantMessage}</MessageResponse>
                    </MessageContent>
                  </Message>
                )}

                {isProcessing && !currentAssistantMessage && !currentReasoning && (
                  <Message from="assistant">
                    <MessageContent>
                      <Shimmer duration={1}>Thinking...</Shimmer>
                    </MessageContent>
                  </Message>
                )}
              </>
            )}
          </ConversationContent>
        </Conversation>

        {/* Input area - responsive to sidebar width, matches floating bar position exactly */}
        <div className="absolute bottom-6 left-14 right-6 z-10" ref={containerRef}>
          {!hasConversation && (
            <Suggestions
              onSelect={(prompt) => {
                onMessageChange(prompt)
                setTimeout(() => textareaRef.current?.focus(), 0)
              }}
              vertical
              className="mb-3"
            />
          )}
          <div className="flex items-center gap-2 bg-background border border-border rounded-3xl shadow-xl px-4 py-2.5">
            <div className="relative flex-1 min-w-0">
              {mentionHighlights.hasHighlights && (
                <div
                  ref={highlightRef}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-0 overflow-hidden whitespace-pre-wrap wrap-break-word text-sm text-transparent"
                >
                  {mentionHighlights.segments.map((segment, index) =>
                    segment.highlighted ? (
                      <span
                        key={`mention-${index}`}
                        className="rounded bg-primary/20 text-transparent [box-decoration-break:clone] shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.15),-3px_0_0_hsl(var(--primary)/0.2),3px_0_0_hsl(var(--primary)/0.2),0_-2px_0_hsl(var(--primary)/0.2),0_2px_0_hsl(var(--primary)/0.2)]"
                      >
                        {segment.text}
                      </span>
                    ) : (
                      <span key={`text-${index}`}>{segment.text}</span>
                    )
                  )}
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => onMessageChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onScroll={syncHighlightScroll}
                placeholder="Ask anything..."
                rows={1}
                className="relative z-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground resize-none max-h-32 min-h-6"
                style={{ fieldSizing: 'content' } as React.CSSProperties}
              />
            </div>
            <Button
              size="icon"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={cn(
                "h-7 w-7 rounded-full shrink-0 transition-all",
                canSubmit
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground"
              )}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>
          {knowledgeFiles.length > 0 && (
            <MentionPopover
              files={knowledgeFiles}
              recentFiles={recentFiles}
              visibleFiles={visibleFiles}
              query={activeMention?.query ?? ''}
              position={cursorCoords}
              containerRef={containerRef}
              onSelect={handleMentionSelect}
              onClose={handleMentionClose}
              open={Boolean(activeMention)}
            />
          )}
        </div>
      </div>
        </>
      )}
    </div>
  )
}
