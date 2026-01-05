import { useCallback, useEffect, useState } from 'react'
import { workspace } from '@x/shared';
import { RunEvent } from '@x/shared/src/runs.js';
import type { ChatStatus, LanguageModelUsage, ToolUIPart } from 'ai';
import './App.css'
import z from 'zod';
import { Button } from './components/ui/button';
import { MessageSquare } from 'lucide-react';
import { AppSidebar } from '@/components/app-sidebar';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool';
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
} from '@/components/ai-elements/context';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

type DirEntry = z.infer<typeof workspace.DirEntry>
type RunEventType = z.infer<typeof RunEvent>

interface TreeNode extends DirEntry {
  children?: TreeNode[]
  loaded?: boolean
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface ToolCall {
  id: string;
  name: string;
  input: ToolUIPart['input'];
  result?: ToolUIPart['output'];
  status: 'pending' | 'running' | 'completed' | 'error';
  timestamp: number;
}

interface ReasoningBlock {
  id: string;
  content: string;
  timestamp: number;
}

type ConversationItem = ChatMessage | ToolCall | ReasoningBlock;

type ToolState = 'input-streaming' | 'input-available' | 'output-available' | 'output-error';

const estimateTokens = (text: string) => {
  if (!text) return 0
  return Math.ceil(text.trim().length / 4)
}

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

const normalizeUsage = (usage?: Partial<LanguageModelUsage> | null): LanguageModelUsage | null => {
  if (!usage) return null
  const hasNumbers = Object.values(usage).some((value) => typeof value === 'number')
  if (!hasNumbers) return null
  const inputTokens = usage.inputTokens ?? 0
  const outputTokens = usage.outputTokens ?? 0
  const reasoningTokens = usage.reasoningTokens ?? 0
  const totalTokens = usage.totalTokens ?? inputTokens + outputTokens + reasoningTokens
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens: usage.cachedInputTokens ?? 0,
    reasoningTokens,
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

// Sort nodes (dirs first, then alphabetically)
function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  }).map(node => {
    if (node.children) {
      node.children = sortNodes(node.children)
    }
    return node
  })
}

// Build tree structure from flat entries
function buildTree(entries: DirEntry[]): TreeNode[] {
  const treeMap = new Map<string, TreeNode>()
  const roots: TreeNode[] = []

  // Create nodes
  entries.forEach(entry => {
    const node: TreeNode = { ...entry, children: [], loaded: false }
    treeMap.set(entry.path, node)
  })

  // Build hierarchy
  entries.forEach(entry => {
    const node = treeMap.get(entry.path)!
    const parts = entry.path.split('/')
    if (parts.length === 1) {
      roots.push(node)
    } else {
      const parentPath = parts.slice(0, -1).join('/')
      const parent = treeMap.get(parentPath)
      if (parent) {
        if (!parent.children) parent.children = []
        parent.children.push(node)
      } else {
        roots.push(node)
      }
    }
  })

  return sortNodes(roots)
}

function App() {
  // File browser state
  const [tree, setTree] = useState<TreeNode[]>([])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')

  // Chat state
  const [message, setMessage] = useState<string>('')
  const [conversation, setConversation] = useState<ConversationItem[]>([])
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState<string>('')
  const [currentReasoning, setCurrentReasoning] = useState<string>('')
  const [modelUsage, setModelUsage] = useState<LanguageModelUsage | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [agentId] = useState<string>('copilot')

  // Load directory and merge into tree
  const loadDirectory = useCallback(async (path: string = '') => {
    try {
      const result = await window.ipc.invoke('workspace:readdir', {
        path,
        opts: { recursive: true, includeHidden: false }
      })
      const tree = buildTree(result)
      return tree
    } catch (err) {
      console.error('Failed to load directory:', err)
      return []
    }
  }, [])

  // Load initial tree
  useEffect(() => {
    async function process() {
      const tree = await loadDirectory();
      setTree(tree)
    }
    process();
  }, [loadDirectory])

  // Listen to workspace change events
  useEffect(() => {
    const cleanup = window.ipc.on('workspace:didChange', () => {
      // Reload tree on any change
      loadDirectory().then(result => setTree(result))
    })
    return cleanup
  }, [loadDirectory])

  // Load file content when selected
  useEffect(() => {
    async function process() {
      if (!selectedPath) {
        setFileContent('')
        return
      }
      try {
        const stat = await window.ipc.invoke('workspace:stat', { path: selectedPath })
        if (stat.kind === 'file') {
          const result = await window.ipc.invoke('workspace:readFile', { path: selectedPath })
          setFileContent(result.data)
        } else {
          setFileContent('')
        }
      } catch (err) {
        console.error('Failed to load file:', err)
      }
    }
    process();
  }, [selectedPath])

  // Listen to run events
  useEffect(() => {
    const cleanup = window.ipc.on('runs:events', ((event: unknown) => {
      handleRunEvent(event as RunEventType)
    }) as (event: null) => void)
    return cleanup
  }, [runId])

  const handleRunEvent = (event: RunEventType) => {
    if (event.runId !== runId) return

    console.log('Run event:', event.type, event)

    switch (event.type) {
      case 'run-processing-start':
        setIsProcessing(true)
        setModelUsage(null)
        break

      case 'run-processing-end':
        setIsProcessing(false)
        break

      case 'start':
        setCurrentAssistantMessage('')
        setCurrentReasoning('')
        setModelUsage(null)
        break

      case 'llm-stream-event':
        {
          const llmEvent = event.event
          if (llmEvent.type === 'reasoning-delta' && llmEvent.delta) {
            setCurrentReasoning(prev => prev + llmEvent.delta)
          } else if (llmEvent.type === 'reasoning-end') {
            setCurrentReasoning(reasoning => {
              if (reasoning) {
                setConversation(prev => [...prev, {
                  id: `reasoning-${Date.now()}`,
                  content: reasoning,
                  timestamp: Date.now(),
                }])
              }
              return ''
            })
          } else if (llmEvent.type === 'text-delta' && llmEvent.delta) {
            setCurrentAssistantMessage(prev => prev + llmEvent.delta)
          } else if (llmEvent.type === 'tool-call') {
            setConversation(prev => [...prev, {
              id: llmEvent.toolCallId || `tool-${Date.now()}`,
              name: llmEvent.toolName || 'tool',
              input: normalizeToolInput(llmEvent.input as ToolUIPart['input']),
              status: 'running',
              timestamp: Date.now(),
            }])
          } else if (llmEvent.type === 'finish-step') {
            const nextUsage = normalizeUsage(llmEvent.usage)
            if (nextUsage) {
              setModelUsage(nextUsage)
            }
          }
        }
        break

      case 'message':
        {
          const msg = event.message
          if (msg.role === 'assistant') {
            setCurrentAssistantMessage(currentMsg => {
              if (currentMsg) {
                setConversation(prev => {
                  const exists = prev.some(m => 
                    m.id === event.messageId && 'role' in m && m.role === 'assistant'
                  )
                  if (exists) return prev
                  return [...prev, {
                    id: event.messageId,
                    role: 'assistant',
                    content: currentMsg,
                    timestamp: Date.now(),
                  }]
                })
              }
              return ''
            })
          }
        }
        break

      case 'tool-invocation':
        {
          const parsedInput = normalizeToolInput(event.input)
          setConversation(prev => {
            let matched = false
            const next = prev.map(item => {
              if (
                isToolCall(item)
                && (event.toolCallId ? item.id === event.toolCallId : item.name === event.toolName)
              ) {
                matched = true
                return { ...item, input: parsedInput, status: 'running' as const }
              }
              return item
            })
            if (!matched) {
              next.push({
                id: event.toolCallId ?? `tool-${Date.now()}`,
                name: event.toolName,
                input: parsedInput,
                status: 'running',
                timestamp: Date.now(),
              })
            }
            return next
          })
          break
        }

      case 'tool-result':
        {
          setConversation(prev => {
            let matched = false
            const next = prev.map(item => {
              if (
                isToolCall(item)
                && (event.toolCallId ? item.id === event.toolCallId : item.name === event.toolName)
              ) {
                matched = true
                return {
                  ...item,
                  result: event.result as ToolUIPart['output'],
                  status: 'completed' as const,
                }
              }
              return item
            })
            if (!matched) {
              next.push({
                id: event.toolCallId ?? `tool-${Date.now()}`,
                name: event.toolName,
                input: {},
                result: event.result as ToolUIPart['output'],
                status: 'completed',
                timestamp: Date.now(),
              })
            }
            return next
          })
          break
        }

      case 'error':
        setIsProcessing(false)
        console.error('Run error:', event.error)
        break
    }
  }

  const handlePromptSubmit = async ({ text }: PromptInputMessage) => {
    if (isProcessing) return

    const userMessage = text.trim()
    if (!userMessage) return

    setMessage('')

    const userMessageId = `user-${Date.now()}`
    setConversation(prev => [...prev, {
      id: userMessageId,
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    }])

    try {
      let currentRunId = runId
      if (!currentRunId) {
        const run = await window.ipc.invoke('runs:create', {
          agentId,
        })
        currentRunId = run.id
        setRunId(currentRunId)
      }

      await window.ipc.invoke('runs:createMessage', {
        runId: currentRunId,
        message: userMessage,
      })
    } catch (error) {
      console.error('Failed to send message:', error)
    }
  }

  const toggleExpand = (path: string, kind: 'file' | 'dir') => {
    if (kind === 'file') {
      setSelectedPath(path)
      return
    }

    const newExpanded = new Set(expandedPaths)
    if (newExpanded.has(path)) {
      newExpanded.delete(path)
    } else {
      newExpanded.add(path)
    }
    setExpandedPaths(newExpanded)
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

  const chatMessages = conversation.filter(isChatMessage)
  const reasoningBlocks = conversation.filter(isReasoningBlock)
  const estimatedInputTokens = chatMessages
    .filter((item) => item.role === 'user')
    .reduce((total, item) => total + estimateTokens(item.content), 0)
  const estimatedOutputTokens = chatMessages
    .filter((item) => item.role === 'assistant')
    .reduce((total, item) => total + estimateTokens(item.content), 0)
    + estimateTokens(currentAssistantMessage)
  const estimatedReasoningTokens = reasoningBlocks
    .reduce((total, item) => total + estimateTokens(item.content), 0)
    + estimateTokens(currentReasoning)
  const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens + estimatedReasoningTokens
  const maxTokens = 128_000
  const estimatedUsage = {
    inputTokens: estimatedInputTokens,
    outputTokens: estimatedOutputTokens,
    totalTokens: estimatedTotalTokens,
    cachedInputTokens: 0,
    reasoningTokens: estimatedReasoningTokens,
  } as LanguageModelUsage
  const effectiveUsage = modelUsage ?? estimatedUsage
  const effectiveTotalTokens = effectiveUsage.totalTokens
    ?? (effectiveUsage.inputTokens ?? 0)
      + (effectiveUsage.outputTokens ?? 0)
      + (effectiveUsage.reasoningTokens ?? 0)
  const usedTokens = Math.min(effectiveTotalTokens, maxTokens)
  const contextUsage = {
    ...effectiveUsage,
    totalTokens: effectiveTotalTokens,
  } as LanguageModelUsage

  const hasConversation = conversation.length > 0 || currentAssistantMessage || currentReasoning
  const submitStatus: ChatStatus = isProcessing ? 'streaming' : 'ready'
  const canSubmit = Boolean(message.trim()) && !isProcessing

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(16rem + var(--sidebar-width-icon))",
        } as React.CSSProperties
      }
    >
      <AppSidebar 
        tree={tree}
        selectedPath={selectedPath}
        expandedPaths={expandedPaths}
        onSelectFile={toggleExpand}
      />
      <SidebarInset>
        <header className="bg-background sticky top-0 z-20 flex shrink-0 items-center gap-2 border-b p-4 shadow-sm">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-4"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="#">Workspace</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>
                  {selectedPath ? selectedPath : 'Chat'}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        
        {selectedPath ? (
          <>
            <div className="border-b border-border p-2 bg-muted flex items-center justify-between">
              <div className="text-sm text-muted-foreground">{selectedPath}</div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedPath(null)}
                className="text-foreground"
              >
                <MessageSquare className="h-4 w-4 mr-2" />
                Back to Chat
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="text-sm font-mono text-foreground whitespace-pre-wrap">
                {fileContent || 'Loading...'}
              </pre>
            </div>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <Conversation className="relative flex-1 overflow-y-auto">
              <ConversationContent className="mx-auto w-full max-w-4xl pb-28">
                {!hasConversation ? (
                  <ConversationEmptyState
                    description="Type a message below to begin chatting with the agent."
                    icon={<MessageSquare className="size-6" />}
                    title="Start a conversation"
                  />
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

            <div className="relative sticky bottom-0 z-10 bg-background pb-4 pt-6 shadow-lg">
              <div className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t from-background to-transparent" />
              <div className="mx-auto w-full max-w-4xl">
                <PromptInput onSubmit={handlePromptSubmit}>
                  <PromptInputBody>
                    <PromptInputTextarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Type your message..."
                      disabled={isProcessing}
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
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}

export default App
