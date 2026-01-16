import { useCallback, useRef, useState } from 'react'
import { ArrowUp, PanelRightClose, Plus } from 'lucide-react'
import type { LanguageModelUsage, ToolUIPart } from 'ai'
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
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool'

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
  onClose: () => void
  onNewChat: () => void
  conversation: ConversationItem[]
  currentAssistantMessage: string
  currentReasoning: string
  isProcessing: boolean
  message: string
  onMessageChange: (message: string) => void
  onSubmit: (message: { text: string }) => void
  contextUsage: LanguageModelUsage
  maxTokens: number
  usedTokens: number
}

export function ChatSidebar({
  defaultWidth = DEFAULT_WIDTH,
  onClose,
  onNewChat,
  conversation,
  currentAssistantMessage,
  currentReasoning,
  isProcessing,
  message,
  onMessageChange,
  onSubmit,
}: ChatSidebarProps) {
  const [width, setWidth] = useState(defaultWidth)
  const [isResizing, setIsResizing] = useState(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

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

  const hasConversation = conversation.length > 0 || currentAssistantMessage || currentReasoning
  const canSubmit = Boolean(message.trim()) && !isProcessing

  const handleSubmit = () => {
    const trimmed = message.trim()
    if (trimmed && !isProcessing) {
      onSubmit({ text: trimmed })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
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

  return (
    <div
      className="relative flex flex-col border-l border-border bg-background shrink-0"
      style={{ width }}
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

      {/* Header - minimal, no border */}
      <header className="flex h-12 shrink-0 items-center justify-between px-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-muted-foreground hover:text-foreground">
              <PanelRightClose className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Close</TooltipContent>
        </Tooltip>
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
                {conversation.map(item => renderConversationItem(item))}

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
          <ConversationScrollButton className="bottom-24" />
        </Conversation>

        {/* Input area - responsive to sidebar width, matches floating bar position exactly */}
        <div className="absolute bottom-6 left-14 right-6 z-10">
          <div className="flex items-center gap-2 bg-background border border-border rounded-full shadow-xl px-4 py-2.5">
            <input
              ref={inputRef}
              type="text"
              value={message}
              onChange={(e) => onMessageChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything..."
              disabled={isProcessing}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />
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
        </div>
      </div>
    </div>
  )
}
