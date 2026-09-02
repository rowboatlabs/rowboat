import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ChatHeader } from '@/components/chat-header'
import { CodeSessionHeader, type CodeSessionHeaderProps } from '@/components/code/code-session-header'
import { type PromptInputMessage, type FileMention } from '@/components/ai-elements/prompt-input'
import { FileCardProvider } from '@/contexts/file-card-context'
import { type ChatTab } from '@/components/tab-bar'
import { type CallPreset, type PermissionMode, type StagedAttachment, type ModelSelection } from '@/components/chat-input-with-mentions'
import { ChatSessionPane, ChatSessionComposer } from '@/components/chat-session'
import type { QueuedSessionMessage } from '@x/shared/src/sessions.js'
import { useTabMeta } from '@/lib/tab-meta'
import { useSidebar } from '@/components/ui/sidebar'
import type { ChatPaneSize } from '@/contexts/theme-context'
import type { PermissionDecision } from '@x/shared/src/code-mode.js'
import {
  type ChatViewportAnchorState,
  type ChatTabViewState,
  type ConversationItem,
  type PermissionResponse,
  type TokenUsage,
  createEmptyChatTabViewState,
} from '@/lib/chat-conversation'

const MIN_WIDTH = 360
const MAX_WIDTH = 1600
const MIN_MAIN_PANE_WIDTH = 420
const MIN_MAIN_PANE_RATIO = 0.3
const DEFAULT_WIDTH = 460
const RIGHT_PANE_WIDTH_STORAGE_KEY = 'x:right-pane-width'

function clampPaneWidth(width: number, maxWidth: number = MAX_WIDTH): number {
  const boundedMax = Math.max(0, Math.min(MAX_WIDTH, maxWidth))
  const boundedMin = Math.min(MIN_WIDTH, boundedMax)
  return Math.min(boundedMax, Math.max(boundedMin, width))
}

function getInitialPaneWidth(defaultWidth: number): number {
  const fallback = clampPaneWidth(defaultWidth)
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(RIGHT_PANE_WIDTH_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return fallback
    return clampPaneWidth(parsed)
  } catch {
    return fallback
  }
}

interface ChatSidebarProps {
  defaultWidth?: number
  isOpen?: boolean
  isMaximized?: boolean
  placement?: 'middle' | 'right'
  paneSize?: ChatPaneSize
  className?: string
  chatTabs: ChatTab[]
  activeChatTabId: string
  getChatTabTitle: (tab: ChatTab) => string
  onNewChatTab: () => void
  recentRuns?: { id: string; title?: string; createdAt: string }[]
  onSelectRun?: (runId: string) => void
  onOpenChatHistory?: () => void
  onOpenFullScreen?: () => void
  conversation: ConversationItem[]
  currentAssistantMessage: string
  currentReasoning?: string
  sessionUsage?: TokenUsage
  chatTabStates?: Record<string, ChatTabViewState>
  viewportAnchors?: Record<string, ChatViewportAnchorState>
  isProcessing: boolean
  isReasoning?: boolean
  isWaitingOnHuman?: boolean
  isStopping?: boolean
  onStop?: () => void
  onSubmit: (message: PromptInputMessage, mentions?: FileMention[], attachments?: StagedAttachment[], searchEnabled?: boolean, codeMode?: 'claude' | 'codex', permissionMode?: PermissionMode) => void
  /** Pending-queue mirror for the ACTIVE tab's session (single store — see App). */
  queuedForActive?: QueuedSessionMessage[]
  onRemoveQueued?: (queueId: string) => void
  onPullQueued?: (queueId: string) => void
  knowledgeFiles?: string[]
  recentFiles?: string[]
  visibleFiles?: string[]
  runId?: string | null
  presetMessage?: string
  onPresetMessageConsumed?: () => void
  getInitialDraft?: (tabId: string) => string | undefined
  onDraftChangeForTab?: (tabId: string, text: string) => void
  onSelectionChangeForTab?: (tabId: string, selection: ModelSelection | null) => void
  getInitialSelection?: (tabId: string) => ModelSelection | null
  /** Last-turn selection for the ACTIVE tab's session (single store — see App). */
  restoredSelectionForActive?: ModelSelection | null
  workDirByTab?: Record<string, string | null>
  /** Composer locks for runs bound to Code-section sessions (cwd + agent frozen). */
  codeSessionLocks?: Record<string, { cwd: string; agent: 'claude' | 'codex' }>
  /**
   * Set while a Rowboat-mode code session owns this pane: the chat is pinned to
   * the session, so the chat switcher / new-chat / history affordances hide.
   */
  // Set while the chat is bound to a coding session: the header becomes the
  // session's (title, settings, drawer toggles) instead of the chat switcher.
  pinnedToCodeSession?: CodeSessionHeaderProps | null
  onWorkDirChangeForTab?: (tabId: string, value: string | null) => void
  pendingAskHumanRequests?: ChatTabViewState['pendingAskHumanRequests']
  allPermissionRequests?: ChatTabViewState['allPermissionRequests']
  permissionResponses?: ChatTabViewState['permissionResponses']
  autoPermissionDecisions?: ChatTabViewState['autoPermissionDecisions']
  onPermissionResponse?: (toolCallId: string, subflow: string[], response: PermissionResponse) => void
  onAskHumanResponse?: (toolCallId: string, subflow: string[], response: string) => void
  onCodePermissionResponse?: (toolCallId: string, requestId: string, decision: PermissionDecision) => void | Promise<void>
  isToolOpenForTab?: (tabId: string, toolId: string) => boolean
  onToolOpenChangeForTab?: (tabId: string, toolId: string, open: boolean) => void
  onOpenKnowledgeFile?: (path: string) => void
  onOpenFile?: (path: string) => void
  onActivate?: () => void
  collapsedLeftPaddingPx?: number
  // Voice / TTS props
  isRecording?: boolean
  recordingText?: string
  recordingState?: 'connecting' | 'listening' | 'stopping'
  audioLevelsRef?: React.MutableRefObject<number[]>
  onStartRecording?: () => void
  onSubmitRecording?: () => void | Promise<void>
  onCancelRecording?: () => void
  voiceAvailable?: boolean
  inCall?: boolean
  callOnThisChat?: boolean
  onStartCall?: (preset: CallPreset) => void
  onEndCall?: () => void
  callAvailable?: boolean
  onComposioConnected?: (toolkitSlug: string) => void
}

export function ChatSidebar({
  defaultWidth = DEFAULT_WIDTH,
  isOpen = true,
  isMaximized = false,
  placement = 'right',
  paneSize = 'chat-smaller',
  className,
  chatTabs,
  activeChatTabId,
  getChatTabTitle,
  onNewChatTab,
  recentRuns = [],
  onSelectRun,
  onOpenChatHistory,
  onOpenFullScreen,
  conversation,
  currentAssistantMessage,
  currentReasoning = '',
  sessionUsage = {},
  chatTabStates = {},
  viewportAnchors = {},
  isProcessing,
  isReasoning = false,
  isWaitingOnHuman = false,
  isStopping,
  onStop,
  onSubmit,
  queuedForActive,
  onRemoveQueued,
  onPullQueued,
  knowledgeFiles = [],
  recentFiles = [],
  visibleFiles = [],
  runId,
  presetMessage,
  onPresetMessageConsumed,
  getInitialDraft,
  onDraftChangeForTab,
  onSelectionChangeForTab,
  getInitialSelection,
  restoredSelectionForActive,
  workDirByTab = {},
  codeSessionLocks = {},
  pinnedToCodeSession = null,
  onWorkDirChangeForTab,
  pendingAskHumanRequests = new Map(),
  allPermissionRequests = new Map(),
  permissionResponses = new Map(),
  autoPermissionDecisions = new Map(),
  onPermissionResponse,
  onAskHumanResponse,
  onCodePermissionResponse,
  isToolOpenForTab,
  onToolOpenChangeForTab,
  onOpenKnowledgeFile,
  onOpenFile,
  onActivate,
  collapsedLeftPaddingPx = 196,
  isRecording,
  recordingText,
  recordingState,
  audioLevelsRef,
  onStartRecording,
  onSubmitRecording,
  onCancelRecording,
  voiceAvailable,
  inCall,
  callOnThisChat,
  onStartCall,
  onEndCall,
  callAvailable,
  onComposioConnected,
}: ChatSidebarProps) {
  const { state: sidebarState } = useSidebar()
  // Content-reported tab meta (see lib/tab-meta.ts): the header title prefers
  // what the chat content reports for the active tab, with the App-derived
  // getChatTabTitle prop as the fallback for unclaimed titles.
  const activeTabMeta = useTabMeta(activeChatTabId)
  const [width, setWidth] = useState(() => getInitialPaneWidth(defaultWidth))
  const [isResizing, setIsResizing] = useState(false)
  const [showContent, setShowContent] = useState(isOpen)
  const [localPresetMessage, setLocalPresetMessage] = useState<string | undefined>(undefined)

  const paneRef = useRef<HTMLDivElement>(null)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)
  const prevIsMaximizedRef = useRef(isMaximized)
  const justToggledMaximize = prevIsMaximizedRef.current !== isMaximized
  const isMiddlePlacement = placement === 'middle'
  const isResizable = paneSize === 'chat-smaller'

  const getMaxAllowedWidth = useCallback(() => {
    if (typeof window === 'undefined') return MAX_WIDTH
    const paneElement = paneRef.current
    const splitContainer = paneElement?.parentElement
    const mainPane = splitContainer?.querySelector<HTMLElement>('[data-slot="sidebar-inset"]')
    const paneWidth = paneElement?.getBoundingClientRect().width ?? 0
    const mainPaneWidth = mainPane?.getBoundingClientRect().width ?? 0
    const splitWidth = paneWidth + mainPaneWidth
    const fallbackWidth = splitContainer?.clientWidth ?? window.innerWidth
    const availableSplitWidth = splitWidth > 0 ? splitWidth : fallbackWidth
    const minMainPaneWidth = Math.min(
      availableSplitWidth,
      Math.max(
        MIN_MAIN_PANE_WIDTH,
        Math.floor(availableSplitWidth * MIN_MAIN_PANE_RATIO)
      )
    )
    return Math.max(0, availableSplitWidth - minMainPaneWidth)
  }, [])

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setShowContent(true), 150)
      return () => clearTimeout(timer)
    }
    setShowContent(false)
  }, [isOpen])

  useEffect(() => {
    prevIsMaximizedRef.current = isMaximized
  }, [isMaximized])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(RIGHT_PANE_WIDTH_STORAGE_KEY, String(width))
    } catch {
      // Ignore persistence failures and keep in-memory behavior.
    }
  }, [width])

  useEffect(() => {
    const clampToAvailableWidth = () => {
      const maxAllowedWidth = getMaxAllowedWidth()
      setWidth((prev) => clampPaneWidth(prev, maxAllowedWidth))
    }

    clampToAvailableWidth()
    window.addEventListener('resize', clampToAvailableWidth)
    return () => window.removeEventListener('resize', clampToAvailableWidth)
  }, [getMaxAllowedWidth])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    startXRef.current = e.clientX
    startWidthRef.current = width
    setIsResizing(true)

    const handleMouseMove = (event: MouseEvent) => {
      const delta = isMiddlePlacement
        ? event.clientX - startXRef.current
        : startXRef.current - event.clientX
      const maxAllowedWidth = getMaxAllowedWidth()
      setWidth(clampPaneWidth(startWidthRef.current + delta, maxAllowedWidth))
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [width, getMaxAllowedWidth, isMiddlePlacement])

  const activeTabState = useMemo<ChatTabViewState>(() => ({
    runId: runId ?? null,
    conversation,
    currentAssistantMessage,
    currentReasoning,
    sessionUsage,
    pendingAskHumanRequests,
    allPermissionRequests,
    permissionResponses,
    autoPermissionDecisions,
  }), [
    runId,
    conversation,
    currentAssistantMessage,
    currentReasoning,
    sessionUsage,
    pendingAskHumanRequests,
    allPermissionRequests,
    permissionResponses,
    autoPermissionDecisions,
  ])
  const emptyTabState = useMemo<ChatTabViewState>(() => createEmptyChatTabViewState(), [])
  const getTabState = useCallback((tabId: string): ChatTabViewState => {
    if (tabId === activeChatTabId) return activeTabState
    return chatTabStates[tabId] ?? emptyTabState
  }, [activeChatTabId, activeTabState, chatTabStates, emptyTabState])
  const paneStyle = useMemo<React.CSSProperties>(() => {
    if (!isOpen) {
      return { width: 0, flex: '0 0 auto' }
    }
    if (isMaximized) {
      // In maximize mode the pane should grow into the freed left space,
      // not add extra width to the right and overflow the app viewport.
      return { width: 0, flex: '1 1 auto' }
    }
    if (paneSize === 'chat-equal' || paneSize === 'chat-bigger') {
      return { width: 0, flex: '1 1 0' }
    }
    return { width, flex: '0 0 auto' }
  }, [isOpen, isMaximized, paneSize, width])

  return (
    <div
      ref={paneRef}
      data-chat-sidebar-root
      onMouseDownCapture={onActivate}
      onFocusCapture={onActivate}
      className={cn(
        'relative flex min-w-0 flex-col overflow-hidden bg-background',
        isMiddlePlacement ? 'border-r border-border' : 'border-l border-border',
        !isResizing && !justToggledMaximize && 'transition-[width] duration-200 ease-linear',
        className
      )}
      style={paneStyle}
    >
      {!isMaximized && isResizable && (
        <div
          onMouseDown={handleMouseDown}
          className={cn(
            'absolute inset-y-0 z-20 w-4 cursor-col-resize',
            isMiddlePlacement ? 'right-0 translate-x-1/2' : 'left-0 -translate-x-1/2',
            'after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:transition-colors',
            'hover:after:bg-sidebar-border',
            isResizing && 'after:bg-primary'
          )}
        />
      )}

      {showContent && (
        <>
          <header
            className="titlebar-drag-region flex h-10 shrink-0 items-stretch border-b border-border bg-sidebar"
            style={{
              paddingLeft: isMaximized && sidebarState === 'collapsed' ? collapsedLeftPaddingPx : undefined,
              paddingRight: isMaximized ? 12 : undefined,
              transition: isMaximized ? 'padding-left 200ms linear' : undefined,
            }}
          >
            {pinnedToCodeSession ? (
              <CodeSessionHeader {...pinnedToCodeSession} />
            ) : (
              <ChatHeader
                activeTitle={(() => {
                  const activeTab = chatTabs.find((tab) => tab.id === activeChatTabId)
                  if (!activeTab) return 'New chat'
                  return activeTabMeta.title ?? getChatTabTitle(activeTab)
                })()}
                onNewChatTab={onNewChatTab}
                recentRuns={recentRuns}
                activeRunId={runId}
                sessionUsage={activeTabState.sessionUsage}
                onSelectRun={onSelectRun}
                onOpenChatHistory={onOpenChatHistory}
              />
            )}
            {onOpenFullScreen && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onOpenFullScreen}
                    className="titlebar-no-drag my-1 mr-2 h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={isMaximized ? 'Dock chat to side pane' : 'Expand chat'}
                  >
                    {isMaximized
                      ? (isMiddlePlacement ? <ArrowLeft className="size-5" /> : <ArrowRight className="size-5" />)
                      : (isMiddlePlacement ? <ArrowRight className="size-5" /> : <ArrowLeft className="size-5" />)}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{isMaximized ? 'Dock to side pane' : 'Expand chat'}</TooltipContent>
              </Tooltip>
            )}
          </header>

          <FileCardProvider onOpenKnowledgeFile={onOpenKnowledgeFile ?? (() => {})} onOpenFile={onOpenFile}>
            <div className="flex min-h-0 flex-1 flex-col">
              {/* Pane padding lives here, on the container — the shared chat pane renders identically on every surface. */}
              <div className="relative min-h-0 flex-1 px-3">
                {chatTabs.map((tab) => {
                  const isActive = tab.id === activeChatTabId
                  return (
                    <ChatSessionPane
                      // Keyed by chat identity — see App's chat panel key.
                      key={tab.chatId}
                      tab={tab}
                      isActive={isActive}
                      tabState={getTabState(tab.id)}
                      viewportAnchor={viewportAnchors[tab.id]}
                      onPickPrompt={setLocalPresetMessage}
                      isToolOpenForTab={(tabId, toolId) => isToolOpenForTab?.(tabId, toolId) ?? false}
                      setToolOpenForTab={(tabId, toolId, open) => onToolOpenChangeForTab?.(tabId, toolId, open)}
                      onPermissionResponse={onPermissionResponse}
                      onAskHumanResponse={onAskHumanResponse}
                      activeIsWorking={isProcessing && !isWaitingOnHuman}
                      activeIsProcessing={isProcessing}
                      activeIsReasoning={isReasoning}
                      onCodePermissionResponse={onCodePermissionResponse}
                      onComposioConnected={onComposioConnected}
                      emptyStateVariant={pinnedToCodeSession ? 'code' : 'default'}
                    />
                  )
                })}
              </div>

              <div className="sticky bottom-0 z-10 bg-background pb-12 pt-0 shadow-lg">
                <div className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-linear-to-t from-background to-transparent" />
                <div className="mx-auto w-full max-w-4xl px-3">
                  {chatTabs.map((tab) => {
                    const isActive = tab.id === activeChatTabId
                    return (
                      <ChatSessionComposer
                        // Composer instance per chat — see App's composer key.
                        key={tab.chatId}
                        tab={tab}
                        isActive={isActive}
                        tabState={getTabState(tab.id)}
                        knowledgeFiles={knowledgeFiles}
                        recentFiles={recentFiles}
                        visibleFiles={visibleFiles}
                        onSubmit={onSubmit}
                        onStop={onStop}
                        activeIsProcessing={isProcessing}
                        isStopping={isStopping}
                        queued={isActive ? queuedForActive : undefined}
                        onRemoveQueued={onRemoveQueued}
                        onPullQueued={onPullQueued}
                        presetMessage={localPresetMessage ?? presetMessage}
                        onPresetMessageConsumed={() => {
                          setLocalPresetMessage(undefined)
                          onPresetMessageConsumed?.()
                        }}
                        codeSessionLocks={codeSessionLocks}
                        initialDraft={getInitialDraft?.(tab.id)}
                        onDraftChange={(tabId, text) => onDraftChangeForTab?.(tabId, text)}
                        onSelectionChange={(t, selection) => onSelectionChangeForTab?.(t.id, selection)}
                        initialSelection={getInitialSelection?.(tab.id) ?? null}
                        restoredSelection={isActive ? restoredSelectionForActive : undefined}
                        workDirByTab={workDirByTab}
                        onWorkDirChange={(tabId, v) => onWorkDirChangeForTab?.(tabId, v)}
                        recordingOverrides={{
                          isRecording: isActive && isRecording,
                          recordingText: isActive ? recordingText : undefined,
                          recordingState: isActive ? recordingState : undefined,
                          audioLevelsRef,
                          onStartRecording: isActive ? onStartRecording : undefined,
                        }}
                        onSubmitRecording={onSubmitRecording}
                        onCancelRecording={onCancelRecording}
                        voiceAvailable={voiceAvailable}
                        inCall={inCall}
                        callOnThisChat={callOnThisChat}
                        onStartCall={onStartCall}
                        onEndCall={onEndCall}
                        callAvailable={callAvailable}
                      />
                    )
                  })}
                </div>
              </div>
            </div>
          </FileCardProvider>
        </>
      )}
    </div>
  )
}
