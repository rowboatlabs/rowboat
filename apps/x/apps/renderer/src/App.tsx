import { useCallback, useEffect, useState, useRef } from 'react'
import { workspace } from '@x/shared';
import { RunEvent } from '@x/shared/src/runs.js';
import './App.css'
import z from 'zod';
import { Button } from './components/ui/button';
import { Textarea } from './components/ui/textarea';
import { Send, Loader2, MessageSquare } from 'lucide-react';

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
  input: unknown;
  result?: unknown;
  status: 'pending' | 'running' | 'completed' | 'error';
  timestamp: number;
}

interface ReasoningBlock {
  id: string;
  content: string;
  timestamp: number;
}

type ConversationItem = ChatMessage | ToolCall | ReasoningBlock;

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
  const [fileLoading, setFileLoading] = useState(true)
  const [fileError, setFileError] = useState<string | null>(null)

  // Chat state
  const [message, setMessage] = useState<string>('')
  const [conversation, setConversation] = useState<ConversationItem[]>([])
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState<string>('')
  const [currentReasoning, setCurrentReasoning] = useState<string>('')
  const [runId, setRunId] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [agentId] = useState<string>('copilot')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom when conversation updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation, currentAssistantMessage, currentReasoning])

  // Load directory and merge into tree
  const loadDirectory = useCallback(async (path: string = '') => {
    try {
      setFileError(null)
      const result = await window.ipc.invoke('workspace:readdir', {
        path,
        opts: { recursive: true, includeHidden: false }
      })
      const tree = buildTree(result)
      return tree
    } catch (err) {
      setFileError(String(err))
      return []
    }
  }, [])

  // Load initial tree
  useEffect(() => {
    async function process() {
      const tree = await loadDirectory();
      setTree(tree)
      setFileLoading(false)
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
        setFileError(String(err))
      }
    }
    process();
  }, [selectedPath])

  // Listen to run events
  useEffect(() => {
    // Note: runs:events sends RunEvent data, but IPC contract types it as null
    // We need to cast the handler to accept the actual event type
    const cleanup = window.ipc.on('runs:events', ((event: unknown) => {
      handleRunEvent(event as RunEventType)
    }) as (event: null) => void)
    return cleanup
  }, [runId])

  const handleRunEvent = (event: RunEventType) => {
    // Only process events for the current run
    if (event.runId !== runId) return

    console.log('Run event:', event.type, event)

    switch (event.type) {
      case 'run-processing-start':
        setIsProcessing(true)
        break

      case 'run-processing-end':
        setIsProcessing(false)
        break

      case 'start':
        setCurrentAssistantMessage('')
        setCurrentReasoning('')
        break

      case 'llm-stream-event':
        {
          const llmEvent = event.event
          if (llmEvent.type === 'reasoning-delta' && llmEvent.delta) {
            setCurrentReasoning(prev => prev + llmEvent.delta)
          } else if (llmEvent.type === 'reasoning-end') {
            // Commit reasoning block if we have content
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
            // Add tool call to conversation
            setConversation(prev => [...prev, {
              id: llmEvent.toolCallId || `tool-${Date.now()}`,
              name: llmEvent.toolName || 'tool',
              input: llmEvent.input,
              status: 'running',
              timestamp: Date.now(),
            }])
          }
        }
        break

      case 'message':
        {
          const msg = event.message
          if (msg.role === 'assistant') {
            // Commit current assistant message
            setCurrentAssistantMessage(currentMsg => {
              if (currentMsg) {
                setConversation(prev => {
                  // Avoid duplicates
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
        setConversation(prev => prev.map(item =>
          item.id === event.toolCallId || ('name' in item && item.name === event.toolName)
            ? { ...item, status: 'running' as const }
            : item
        ))
        break

      case 'tool-result':
        setConversation(prev => prev.map(item =>
          item.id === event.toolCallId || ('name' in item && item.name === event.toolName)
            ? { ...item, result: event.result, status: 'completed' as const }
            : item
        ))
        break

      case 'error':
        setIsProcessing(false)
        console.error('Run error:', event.error)
        break
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim() || isProcessing) return

    const userMessage = message.trim()
    setMessage('')

    // Add user message immediately
    const userMessageId = `user-${Date.now()}`
    setConversation(prev => [...prev, {
      id: userMessageId,
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    }])

    try {
      // Create run if needed
      let currentRunId = runId
      if (!currentRunId) {
        const run = await window.ipc.invoke('runs:create', {
          agentId,
        })
        currentRunId = run.id
        setRunId(currentRunId)
      }

      // Send message
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

  const handleCreateFile = async (parentPath: string = '') => {
    const name = prompt('Enter file name:')
    if (!name) return

    const filePath = parentPath ? `${parentPath}/${name}` : name
    try {
      await window.ipc.invoke('workspace:writeFile', {
        path: filePath,
        data: '',
        opts: {
          encoding: 'utf8'
        },
      })
    } catch (err) {
      setFileError(String(err))
    }
  }

  const handleCreateDir = async (parentPath: string = '') => {
    const name = prompt('Enter directory name:')
    if (!name) return

    const dirPath = parentPath ? `${parentPath}/${name}` : name
    try {
      await window.ipc.invoke('workspace:mkdir', {
        path: dirPath,
        recursive: false
      })
      if (parentPath) {
        setExpandedPaths(prev => new Set(prev).add(parentPath))
      }
    } catch (err) {
      setFileError(String(err))
    }
  }

  const handleDelete = async (path: string) => {
    if (!confirm(`Delete ${path}?`)) return

    try {
      await window.ipc.invoke('workspace:remove', {
        path,
        opts: {
          recursive: true,
          trash: true,
        },
      })
      if (selectedPath === path) {
        setSelectedPath(null)
      }
    } catch (err) {
      setFileError(String(err))
    }
  }

  const renderTreeNode = (node: TreeNode, depth: number = 0) => {
    const isExpanded = expandedPaths.has(node.path)
    const isSelected = selectedPath === node.path
    const hasChildren = node.children && node.children.length > 0

    return (
      <div key={node.path}>
        <div
          className={`flex items-center gap-2 py-1 px-2 hover:bg-gray-700 cursor-pointer ${isSelected ? 'bg-gray-600' : ''
            }`}
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
          onClick={() => toggleExpand(node.path, node.kind)}
        >
          <span className="text-gray-400 w-4">
            {node.kind === 'dir' ? (isExpanded ? '📂' : '📁') : '📄'}
          </span>
          <span className="flex-1 text-sm text-gray-200">{node.name}</span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleDelete(node.path)
            }}
            className="text-xs text-red-400 hover:text-red-300 px-2"
            title="Delete"
          >
            ×
          </button>
        </div>
        {node.kind === 'dir' && isExpanded && hasChildren && (
          <div>
            {node.children!.map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const renderConversationItem = (item: ConversationItem) => {
    if ('role' in item) {
      // ChatMessage
      return (
        <div
          key={item.id}
          className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'} mb-4`}
        >
          <div
            className={`max-w-[80%] rounded-lg px-4 py-2 ${
              item.role === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-100'
            }`}
          >
            <div className="text-sm whitespace-pre-wrap">{item.content}</div>
          </div>
        </div>
      )
    } else if ('name' in item) {
      // ToolCall
      return (
        <div key={item.id} className="mb-4 bg-gray-800 rounded-lg p-3 border border-gray-700">
          <div className="text-sm font-semibold text-gray-300 mb-1">
            🔧 {item.name}
          </div>
          {item.input !== undefined && item.input !== null && (
            <div className="text-xs text-gray-400 mb-2">
              Input: {JSON.stringify(item.input, null, 2)}
            </div>
          )}
          {item.result !== undefined && (
            <div className="text-xs text-gray-400">
              Result: {typeof item.result === 'string' ? item.result : String(JSON.stringify(item.result, null, 2)).substring(0, 1000)}
            </div>
          )}
          <div className="text-xs text-gray-500 mt-1">
            Status: {item.status}
          </div>
        </div>
      )
    } else {
      // ReasoningBlock
      return (
        <div key={item.id} className="mb-4 bg-gray-800 rounded-lg p-3 border border-gray-700">
          <div className="text-sm font-semibold text-gray-300 mb-1">💭 Reasoning</div>
          <div className="text-sm text-gray-400 whitespace-pre-wrap">{item.content}</div>
        </div>
      )
    }
  }

  return (
    <div className="flex w-full h-screen bg-[#1e1e1e] text-gray-200">
      {/* Sidebar - File Browser */}
      <div className="w-64 border-r border-gray-700 flex flex-col">
        <div className="p-3 border-b border-gray-700 flex gap-2">
          <button
            onClick={() => handleCreateFile()}
            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded"
          >
            + File
          </button>
          <button
            onClick={() => handleCreateDir()}
            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded"
          >
            + Dir
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {fileLoading && <div className="text-sm text-gray-400 p-2">Loading...</div>}
          {fileError && <div className="text-sm text-red-400 p-2">{fileError}</div>}
          {tree.map(node => renderTreeNode(node))}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col">
        {/* File viewer or chat */}
        {selectedPath ? (
          <>
            <div className="border-b border-gray-700 p-2 bg-gray-800 flex items-center justify-between">
              <div className="text-sm text-gray-400">{selectedPath}</div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedPath(null)}
                className="text-gray-300 hover:text-white"
              >
                <MessageSquare className="h-4 w-4 mr-2" />
                Back to Chat
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="text-sm font-mono text-gray-200 whitespace-pre-wrap">
                {fileContent || 'Loading...'}
              </pre>
            </div>
          </>
        ) : (
          <>
            {/* Chat area */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="max-w-4xl mx-auto">
                {conversation.length === 0 && !currentAssistantMessage && !currentReasoning ? (
                  <div className="flex items-center justify-center h-full text-center">
                    <div>
                      <h2 className="text-2xl font-semibold text-gray-300 mb-2">
                        Start a conversation
                      </h2>
                      <p className="text-gray-400 text-sm">
                        Type a message below to begin chatting with the agent
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    {conversation.map(item => renderConversationItem(item))}
                    
                    {/* Current reasoning */}
                    {currentReasoning && (
                      <div className="mb-4 bg-gray-800 rounded-lg p-3 border border-gray-700">
                        <div className="text-sm font-semibold text-gray-300 mb-1">💭 Reasoning</div>
                        <div className="text-sm text-gray-400 whitespace-pre-wrap">
                          {currentReasoning}
                          <span className="inline-block w-2 h-4 ml-1 bg-gray-500 animate-pulse" />
                        </div>
                      </div>
                    )}

                    {/* Current streaming message */}
                    {currentAssistantMessage && (
                      <div className="flex justify-start mb-4">
                        <div className="max-w-[80%] rounded-lg px-4 py-2 bg-gray-700 text-gray-100">
                          <div className="text-sm whitespace-pre-wrap">
                            {currentAssistantMessage}
                            <span className="inline-block w-2 h-4 ml-1 bg-gray-400 animate-pulse" />
                          </div>
                        </div>
                      </div>
                    )}

                    {isProcessing && (
                      <div className="flex justify-center mb-4">
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Processing...</span>
                        </div>
                      </div>
                    )}

                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>
            </div>

            {/* Input area */}
            <div className="border-t border-gray-700 p-4 bg-gray-800">
              <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
                <div className="flex gap-2">
                  <Textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSubmit(e)
                      }
                    }}
                    placeholder="Type your message... (Shift+Enter for new line)"
                    className="resize-none"
                    rows={3}
                    disabled={isProcessing}
                  />
                  <Button
                    type="submit"
                    disabled={!message.trim() || isProcessing}
                    className="self-end"
                  >
                    {isProcessing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default App
