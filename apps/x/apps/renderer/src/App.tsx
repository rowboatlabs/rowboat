import * as React from 'react'
import { useCallback, useEffect, useState, useRef } from 'react'
import { workspace } from '@x/shared';
import { RunEvent } from '@x/shared/src/runs.js';
import type { ChatStatus, LanguageModelUsage, ToolUIPart } from 'ai';
import './App.css'
import z from 'zod';
import { Button } from './components/ui/button';
import { CheckIcon, LoaderIcon } from 'lucide-react';
import { MarkdownEditor } from './components/markdown-editor';
import { ChatInputBar } from './components/chat-button';
import { ChatSidebar } from './components/chat-sidebar';
import { GraphView, type GraphEdge, type GraphNode } from '@/components/graph-view';
import { useDebounce } from './hooks/use-debounce';
import { SidebarIcon } from '@/components/sidebar-icon';
import { SidebarContentPanel } from '@/components/sidebar-content';
import { SidebarSectionProvider, type ActiveSection } from '@/contexts/sidebar-context';
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
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Separator } from "@/components/ui/separator"
import { stripKnowledgePrefix, toKnowledgePath, wikiLabel } from '@/lib/wiki-links'

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

const DEFAULT_SIDEBAR_WIDTH = 256
const wikiLinkRegex = /\[\[([^[\]]+)\]\]/g
const graphPalette = [
  { hue: 210, sat: 72, light: 52 },
  { hue: 28, sat: 78, light: 52 },
  { hue: 120, sat: 62, light: 48 },
  { hue: 170, sat: 66, light: 46 },
  { hue: 280, sat: 70, light: 56 },
  { hue: 330, sat: 68, light: 54 },
  { hue: 55, sat: 80, light: 52 },
  { hue: 0, sat: 72, light: 52 },
]

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const untitledBaseName = 'untitled'

const getHeadingTitle = (markdown: string) => {
  const lines = markdown.split('\n')
  for (const line of lines) {
    const match = line.match(/^#\s+(.+)$/)
    if (match) return match[1].trim()
    if (line.trim() !== '') return null
  }
  return null
}

const sanitizeHeadingForFilename = (heading: string) => {
  let name = heading.trim()
  if (!name) return null
  if (name.toLowerCase().endsWith('.md')) {
    name = name.slice(0, -3)
  }
  name = name.replace(/[\\/]/g, '-').replace(/\s+/g, ' ').trim()
  return name || null
}

const getBaseName = (path: string) => {
  const file = path.split('/').pop() ?? ''
  return file.replace(/\.md$/i, '')
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

const collectDirPaths = (nodes: TreeNode[]): string[] =>
  nodes.flatMap(n => n.kind === 'dir' ? [n.path, ...(n.children ? collectDirPaths(n.children) : [])] : [])

const collectFilePaths = (nodes: TreeNode[]): string[] =>
  nodes.flatMap(n => n.kind === 'file' ? [n.path] : (n.children ? collectFilePaths(n.children) : []))

function App() {
  // File browser state (for Knowledge section)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [editorContent, setEditorContent] = useState<string>('')
  const [tree, setTree] = useState<TreeNode[]>([])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [recentWikiFiles, setRecentWikiFiles] = useState<string[]>([])
  const [isGraphOpen, setIsGraphOpen] = useState(false)
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({
    nodes: [],
    edges: [],
  })
  const [graphStatus, setGraphStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [graphError, setGraphError] = useState<string | null>(null)
  const [isChatSidebarOpen, setIsChatSidebarOpen] = useState(false)

  // Auto-save state
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const debouncedContent = useDebounce(editorContent, 500)
  const initialContentRef = useRef<string>('')
  const renameInProgressRef = useRef(false)

  // Chat state
  const [message, setMessage] = useState<string>('')
  const [conversation, setConversation] = useState<ConversationItem[]>([])
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState<string>('')
  const [currentReasoning, setCurrentReasoning] = useState<string>('')
  const [modelUsage, setModelUsage] = useState<LanguageModelUsage | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [agentId] = useState<string>('copilot')

  // Load directory tree
  const loadDirectory = useCallback(async () => {
    try {
      const result = await window.ipc.invoke('workspace:readdir', {
        path: 'knowledge',
        opts: { recursive: true, includeHidden: false }
      })
      return buildTree(result)
    } catch (err) {
      console.error('Failed to load directory:', err)
      return []
    }
  }, [])

  // Load initial tree
  useEffect(() => {
    loadDirectory().then(setTree)
  }, [loadDirectory])

  // Listen to workspace change events
  useEffect(() => {
    const cleanup = window.ipc.on('workspace:didChange', () => {
      loadDirectory().then(setTree)
    })
    return cleanup
  }, [loadDirectory])

  // Load file content when selected
  useEffect(() => {
    if (!selectedPath) {
      setFileContent('')
      setEditorContent('')
      initialContentRef.current = ''
      setLastSaved(null)
      return
    }
    (async () => {
      try {
        const stat = await window.ipc.invoke('workspace:stat', { path: selectedPath })
        if (stat.kind === 'file') {
          const result = await window.ipc.invoke('workspace:readFile', { path: selectedPath })
          setFileContent(result.data)
          setEditorContent(result.data)
          initialContentRef.current = result.data
          setLastSaved(null)
        } else {
          setFileContent('')
          setEditorContent('')
          initialContentRef.current = ''
        }
      } catch (err) {
        console.error('Failed to load file:', err)
        setFileContent('')
        setEditorContent('')
        initialContentRef.current = ''
      }
    })()
  }, [selectedPath])

  // Track recently opened markdown files for wiki links
  useEffect(() => {
    if (!selectedPath || !selectedPath.endsWith('.md')) return
    const wikiPath = stripKnowledgePrefix(selectedPath)
    setRecentWikiFiles((prev) => {
      const next = [wikiPath, ...prev.filter((path) => path !== wikiPath)]
      return next.slice(0, 50)
    })
  }, [selectedPath])

  // Auto-save when content changes
  useEffect(() => {
    if (!selectedPath || !selectedPath.endsWith('.md')) return
    if (debouncedContent === initialContentRef.current) return
    if (!debouncedContent) return

    const saveFile = async () => {
      setIsSaving(true)
      let pathToSave = selectedPath
      try {
        if (!renameInProgressRef.current && selectedPath.startsWith('knowledge/')) {
          const headingTitle = getHeadingTitle(debouncedContent)
          const desiredName = headingTitle ? sanitizeHeadingForFilename(headingTitle) : null
          const currentBase = getBaseName(selectedPath)
          if (desiredName && desiredName !== currentBase) {
            const parentDir = selectedPath.split('/').slice(0, -1).join('/')
            const targetPath = `${parentDir}/${desiredName}.md`
            if (targetPath !== selectedPath) {
              const exists = await window.ipc.invoke('workspace:exists', { path: targetPath })
              if (!exists.exists) {
                renameInProgressRef.current = true
                await window.ipc.invoke('workspace:rename', { from: selectedPath, to: targetPath })
                pathToSave = targetPath
                setSelectedPath(targetPath)
              }
            }
          }
        }
        await window.ipc.invoke('workspace:writeFile', {
          path: pathToSave,
          data: debouncedContent,
          opts: { encoding: 'utf8' }
        })
        initialContentRef.current = debouncedContent
        setLastSaved(new Date())
      } catch (err) {
        console.error('Failed to save file:', err)
      } finally {
        renameInProgressRef.current = false
        setIsSaving(false)
      }
    }
    saveFile()
  }, [debouncedContent, selectedPath])

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

  const handleNewChat = useCallback(() => {
    setConversation([])
    setCurrentAssistantMessage('')
    setCurrentReasoning('')
    setRunId(null)
    setMessage('')
    setModelUsage(null)
  }, [])

  const handleChatInputSubmit = (text: string) => {
    setIsChatSidebarOpen(true)
    // Submit immediately - the sidebar will open and show the message
    handlePromptSubmit({ text })
  }

  const toggleExpand = (path: string, kind: 'file' | 'dir') => {
    if (kind === 'file') {
      setSelectedPath(path)
      setIsGraphOpen(false)
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

  // Handle sidebar section changes - switch to chat view for agents
  const handleSectionChange = useCallback((section: ActiveSection) => {
    if (section === 'agents') {
      setSelectedPath(null)
      setIsGraphOpen(false)
    }
  }, [])

  // Knowledge quick actions
  const knowledgeFiles = React.useMemo(() => {
    const files = collectFilePaths(tree).filter((path) => path.endsWith('.md'))
    return Array.from(new Set(files.map(stripKnowledgePrefix)))
  }, [tree])
  const knowledgeFilePaths = React.useMemo(() => (
    knowledgeFiles.reduce<string[]>((acc, filePath) => {
      const resolved = toKnowledgePath(filePath)
      if (resolved) acc.push(resolved)
      return acc
    }, [])
  ), [knowledgeFiles])

  // Get workspace root for full paths
  const [workspaceRoot, setWorkspaceRoot] = useState<string>('')
  useEffect(() => {
    window.ipc.invoke('workspace:getRoot', null).then(result => {
      setWorkspaceRoot(result.root)
    })
  }, [])

  const knowledgeActions = React.useMemo(() => ({
    createNote: async (parentPath: string = 'knowledge') => {
      try {
        let index = 0
        let name = untitledBaseName
        let fullPath = `${parentPath}/${name}.md`
        while (index < 1000) {
          const exists = await window.ipc.invoke('workspace:exists', { path: fullPath })
          if (!exists.exists) break
          index += 1
          name = `${untitledBaseName}-${index}`
          fullPath = `${parentPath}/${name}.md`
        }
        await window.ipc.invoke('workspace:writeFile', {
          path: fullPath,
          data: `# ${name}\n\n`,
          opts: { encoding: 'utf8' }
        })
        setIsGraphOpen(false)
        setSelectedPath(fullPath)
      } catch (err) {
        console.error('Failed to create note:', err)
        throw err
      }
    },
    createFolder: async (parentPath: string = 'knowledge') => {
      try {
        await window.ipc.invoke('workspace:mkdir', {
          path: `${parentPath}/new-folder-${Date.now()}`,
          recursive: true
        })
      } catch (err) {
        console.error('Failed to create folder:', err)
        throw err
      }
    },
    openGraph: () => {
      setSelectedPath(null)
      setIsGraphOpen(true)
    },
    expandAll: () => setExpandedPaths(new Set(collectDirPaths(tree))),
    collapseAll: () => setExpandedPaths(new Set()),
    rename: async (oldPath: string, newName: string, isDir: boolean) => {
      try {
        const parts = oldPath.split('/')
        // For files, ensure .md extension
        const finalName = isDir ? newName : (newName.endsWith('.md') ? newName : `${newName}.md`)
        parts[parts.length - 1] = finalName
        const newPath = parts.join('/')
        await window.ipc.invoke('workspace:rename', { from: oldPath, to: newPath })
        if (selectedPath === oldPath) setSelectedPath(newPath)
      } catch (err) {
        console.error('Failed to rename:', err)
        throw err
      }
    },
    remove: async (path: string) => {
      try {
        await window.ipc.invoke('workspace:remove', { path, opts: { trash: true } })
        if (selectedPath === path) setSelectedPath(null)
      } catch (err) {
        console.error('Failed to remove:', err)
        throw err
      }
    },
    copyPath: (path: string) => {
      const fullPath = workspaceRoot ? `${workspaceRoot}/${path}` : path
      navigator.clipboard.writeText(fullPath)
    },
  }), [tree, selectedPath, workspaceRoot, collectDirPaths])

  const ensureWikiFile = useCallback(async (wikiPath: string) => {
    const resolvedPath = toKnowledgePath(wikiPath)
    if (!resolvedPath) return null
    try {
      const exists = await window.ipc.invoke('workspace:exists', { path: resolvedPath })
      if (!exists.exists) {
        const title = wikiLabel(wikiPath) || 'New Note'
        await window.ipc.invoke('workspace:writeFile', {
          path: resolvedPath,
          data: `# ${title}\n\n`,
          opts: { encoding: 'utf8', mkdirp: true },
        })
      }
      return resolvedPath
    } catch (err) {
      console.error('Failed to ensure wiki link target:', err)
      return null
    }
  }, [])

  const openWikiLink = useCallback(async (wikiPath: string) => {
    const resolvedPath = await ensureWikiFile(wikiPath)
    if (resolvedPath) {
      setSelectedPath(resolvedPath)
    }
  }, [ensureWikiFile, setSelectedPath])

  const wikiLinkConfig = React.useMemo(() => ({
    files: knowledgeFiles,
    recent: recentWikiFiles,
    onOpen: (path: string) => {
      void openWikiLink(path)
    },
    onCreate: (path: string) => {
      void ensureWikiFile(path)
    },
  }), [knowledgeFiles, recentWikiFiles, openWikiLink, ensureWikiFile])

  useEffect(() => {
    if (!isGraphOpen) return
    let cancelled = false

    const buildGraph = async () => {
      setGraphStatus('loading')
      setGraphError(null)

      if (knowledgeFilePaths.length === 0) {
        setGraphData({ nodes: [], edges: [] })
        setGraphStatus('ready')
        return
      }

      const nodeSet = new Set(knowledgeFilePaths)
      const edges: GraphEdge[] = []
      const edgeKeys = new Set<string>()

      const contents = await Promise.all(
        knowledgeFilePaths.map(async (path) => {
          try {
            const result = await window.ipc.invoke('workspace:readFile', { path })
            return { path, data: result.data as string }
          } catch (err) {
            console.error('Failed to read file for graph:', path, err)
            return { path, data: '' }
          }
        })
      )

      for (const { path, data } of contents) {
        for (const match of data.matchAll(wikiLinkRegex)) {
          const rawTarget = match[1]?.trim() ?? ''
          const targetPath = toKnowledgePath(rawTarget)
          if (!targetPath || targetPath === path) continue
          if (!nodeSet.has(targetPath)) continue
          const edgeKey = path < targetPath ? `${path}|${targetPath}` : `${targetPath}|${path}`
          if (edgeKeys.has(edgeKey)) continue
          edgeKeys.add(edgeKey)
          edges.push({ source: path, target: targetPath })
        }
      }

      const degreeMap = new Map<string, number>()
      edges.forEach((edge) => {
        degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1)
        degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1)
      })

      const groupIndexMap = new Map<string, number>()
      const getGroupIndex = (group: string) => {
        const existing = groupIndexMap.get(group)
        if (existing !== undefined) return existing
        const nextIndex = groupIndexMap.size
        groupIndexMap.set(group, nextIndex)
        return nextIndex
      }
      const getNodeGroup = (path: string) => {
        const normalized = stripKnowledgePrefix(path)
        const parts = normalized.split('/').filter(Boolean)
        if (parts.length <= 1) {
          return { group: 'root', depth: 0 }
        }
        return {
          group: parts[0],
          depth: Math.max(0, parts.length - 2),
        }
      }
      const getNodeColors = (groupIndex: number, depth: number) => {
        const base = graphPalette[groupIndex % graphPalette.length]
        const light = clampNumber(base.light + depth * 6, 36, 72)
        const strokeLight = clampNumber(light - 12, 28, 60)
        return {
          fill: `hsl(${base.hue} ${base.sat}% ${light}%)`,
          stroke: `hsl(${base.hue} ${Math.min(80, base.sat + 8)}% ${strokeLight}%)`,
        }
      }

      const nodes = knowledgeFilePaths.map((path) => {
        const degree = degreeMap.get(path) ?? 0
        const radius = 6 + Math.min(18, degree * 2)
        const { group, depth } = getNodeGroup(path)
        const groupIndex = getGroupIndex(group)
        const colors = getNodeColors(groupIndex, depth)
        return {
          id: path,
          label: wikiLabel(path) || path,
          degree,
          radius,
          group,
          color: colors.fill,
          stroke: colors.stroke,
        }
      })

      if (!cancelled) {
        setGraphData({ nodes, edges })
        setGraphStatus('ready')
      }
    }

    buildGraph().catch((err) => {
      if (cancelled) return
      console.error('Failed to build graph:', err)
      setGraphStatus('error')
      setGraphError(err instanceof Error ? err.message : 'Failed to build graph')
    })

    return () => {
      cancelled = true
    }
  }, [isGraphOpen, knowledgeFilePaths])

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
  const conversationContentClassName = hasConversation
    ? "mx-auto w-full max-w-4xl pb-28"
    : "mx-auto w-full max-w-4xl min-h-full items-center justify-center pb-0"
  const submitStatus: ChatStatus = isProcessing ? 'streaming' : 'ready'
  const canSubmit = Boolean(message.trim()) && !isProcessing
  const headerTitle = selectedPath ? selectedPath : (isGraphOpen ? 'Graph View' : 'Chat')

  return (
    <TooltipProvider delayDuration={0}>
      <SidebarSectionProvider defaultSection="knowledge" onSectionChange={handleSectionChange}>
        <div className="flex h-svh w-full">
          {/* Icon sidebar - always visible, fixed position */}
          <SidebarIcon />

          {/* Spacer for the fixed icon sidebar */}
          <div className="w-14 shrink-0" />

          {/* Content sidebar with SidebarProvider for collapse functionality */}
          <SidebarProvider
            style={{
              "--sidebar-offset": "3.5rem",
              "--sidebar-width": `${DEFAULT_SIDEBAR_WIDTH}px`,
            } as React.CSSProperties}
          >
            <SidebarContentPanel
              tree={tree}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onSelectFile={toggleExpand}
              knowledgeActions={knowledgeActions}
            />
            <SidebarInset className="!overflow-hidden min-h-0">
              {/* Header with sidebar trigger */}
              <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 bg-background">
                <SidebarTrigger className="-ml-1" />
                <Separator orientation="vertical" className="h-4" />
                <span className="text-sm font-medium text-muted-foreground">
                  {headerTitle}
                </span>
                {selectedPath && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
                    {isSaving ? (
                      <>
                        <LoaderIcon className="h-3 w-3 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : lastSaved ? (
                      <>
                        <CheckIcon className="h-3 w-3 text-green-500" />
                        <span>Saved</span>
                      </>
                    ) : null}
                  </div>
                )}
                {!selectedPath && isGraphOpen && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsGraphOpen(false)}
                    className="ml-auto text-foreground"
                  >
                    Close Graph
                  </Button>
                )}
              </header>

              {isGraphOpen ? (
                <div className="flex-1 min-h-0">
                  <GraphView
                    nodes={graphData.nodes}
                    edges={graphData.edges}
                    isLoading={graphStatus === 'loading'}
                    error={graphStatus === 'error' ? (graphError ?? 'Failed to build graph') : null}
                    onSelectNode={(path) => {
                      setIsGraphOpen(false)
                      setSelectedPath(path)
                    }}
                  />
                </div>
              ) : selectedPath ? (
                selectedPath.endsWith('.md') ? (
                  <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    <MarkdownEditor
                      content={editorContent}
                      onChange={setEditorContent}
                      placeholder="Start writing..."
                      wikiLinks={wikiLinkConfig}
                    />
                  </div>
                ) : (
                  <div className="flex-1 overflow-auto p-4">
                    <pre className="text-sm font-mono text-foreground whitespace-pre-wrap">
                      {fileContent || 'Loading...'}
                    </pre>
                  </div>
                )
              ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <Conversation className="relative flex-1 overflow-y-auto">
                  <ConversationContent className={conversationContentClassName}>
                    {!hasConversation ? (
                      <ConversationEmptyState className="h-auto">
                        <div className="text-4xl font-semibold tracking-tight text-foreground/80 sm:text-5xl md:text-6xl">
                          RowboatX
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

                <div className="relative sticky bottom-0 z-10 bg-background pb-4 pt-6 shadow-lg">
                  <div className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t from-background to-transparent" />
                  <div className="mx-auto w-full max-w-4xl px-4">
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

            {/* Chat sidebar - shown when viewing files/graph */}
            {isChatSidebarOpen && (selectedPath || isGraphOpen) && (
              <ChatSidebar
                defaultWidth={400}
                onClose={() => setIsChatSidebarOpen(false)}
                onNewChat={handleNewChat}
                conversation={conversation}
                currentAssistantMessage={currentAssistantMessage}
                currentReasoning={currentReasoning}
                isProcessing={isProcessing}
                message={message}
                onMessageChange={setMessage}
                onSubmit={handlePromptSubmit}
                contextUsage={contextUsage}
                maxTokens={maxTokens}
                usedTokens={usedTokens}
              />
            )}
          </SidebarProvider>

          {/* Floating chat input - shown when viewing files/graph and chat sidebar is closed */}
          {(selectedPath || isGraphOpen) && !isChatSidebarOpen && (
            <ChatInputBar
              onSubmit={handleChatInputSubmit}
              onOpen={() => setIsChatSidebarOpen(true)}
            />
          )}
        </div>
      </SidebarSectionProvider>
    </TooltipProvider>
  )
}

export default App
