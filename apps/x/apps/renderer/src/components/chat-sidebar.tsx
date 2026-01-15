import { useCallback, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { ChatStatus, LanguageModelUsage, ToolUIPart } from 'ai'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
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
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import {
  Context,
  ContextCacheUsage,
  ContextContent,
  ContextContentBody,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
  ContextTrigger,
} from '@/components/ai-elements/context'

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
  conversation: ConversationItem[]
  currentAssistantMessage: string
  currentReasoning: string
  isProcessing: boolean
  message: string
  onMessageChange: (message: string) => void
  onSubmit: (message: PromptInputMessage) => void
  contextUsage: LanguageModelUsage
  maxTokens: number
  usedTokens: number
}

export function ChatSidebar({
  defaultWidth = DEFAULT_WIDTH,
  onClose,
  conversation,
  currentAssistantMessage,
  currentReasoning,
  isProcessing,
  message,
  onMessageChange,
  onSubmit,
  contextUsage,
  maxTokens,
  usedTokens,
}: ChatSidebarProps) {
  const [width, setWidth] = useState(defaultWidth)
  const [isResizing, setIsResizing] = useState(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    startXRef.current = e.clientX
    startWidthRef.current = width
    setIsResizing(true)

    const handleMouseMove = (e: MouseEvent) => {
      // Since sidebar is on right, dragging left increases width
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
  const submitStatus: ChatStatus = isProcessing ? 'streaming' : 'ready'
  const canSubmit = Boolean(message.trim()) && !isProcessing

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
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-sm font-medium">Chat</span>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
          <X className="h-4 w-4" />
        </Button>
      </header>

      {/* Conversation area */}
      <div className="flex min-h-0 flex-1 flex-col">
        <Conversation className="relative flex-1 overflow-y-auto">
          <ConversationContent className={hasConversation ? "px-3 pb-24" : "px-3 min-h-full items-center justify-center"}>
            {!hasConversation ? (
              <ConversationEmptyState className="h-auto">
                <div className="text-lg font-medium text-muted-foreground">
                  Ask anything...
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
          <ConversationScrollButton className="bottom-20" />
        </Conversation>

        {/* Prompt input */}
        <div className="relative sticky bottom-0 z-10 bg-background pb-3 pt-4 px-3 border-t border-border">
          <PromptInput onSubmit={onSubmit}>
            <PromptInputBody>
              <PromptInputTextarea
                value={message}
                onChange={(e) => onMessageChange(e.target.value)}
                placeholder="Type your message..."
                disabled={isProcessing}
                className="min-h-[60px] max-h-[120px]"
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                <Context
                  maxTokens={maxTokens}
                  usedTokens={usedTokens}
                  usage={contextUsage}
                >
                  <ContextTrigger size="sm" />
                  <ContextContent>
                    <ContextContentHeader />
                    <ContextContentBody>
                      <ContextInputUsage />
                      <ContextOutputUsage />
                      <ContextReasoningUsage />
                      <ContextCacheUsage />
                    </ContextContentBody>
                  </ContextContent>
                </Context>
              </PromptInputTools>
              <PromptInputSubmit
                disabled={!canSubmit}
                status={submitStatus}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  )
}
