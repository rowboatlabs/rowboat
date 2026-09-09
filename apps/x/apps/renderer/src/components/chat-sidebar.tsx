import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Minus, X, PanelRightClose, PanelsTopLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { readAssistantPreference, writeAssistantPreference } from '@/lib/assistant-dock'
import { clampPanelSize, type PanelSize } from '@/lib/assistant-panel-layout'
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

export interface ChatSidebarProps {
  isFocused?: boolean
  onDockedWidthChange?: (width: number) => void
  floatingBounds?: PanelSize & { right: number }
  onFloatingResize?: (size: PanelSize) => void
  onToggleDock?: () => void
  floating?: boolean
  keepMounted?: boolean
  onMinimize?: () => void
  onCloseTab?: () => void
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
  /** History navigation, shown in the header only while maximized — the pane
      then covers the main ContentHeader that normally carries these. */
  onNavigateBack?: () => void
  onNavigateForward?: () => void
  canNavigateBack?: boolean
  canNavigateForward?: boolean
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
  isToolOpenForTab?: (tabId: string, toolId: string) => boolean | undefined
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
  onComposioConnected?: (toolkitSlug: string, tabId?: string) => void
}

export function ChatSidebar({
  isFocused = true,
  onDockedWidthChange,
  floatingBounds,
  onFloatingResize,
  onToggleDock,
  floating = false,
  keepMounted = false,
  onMinimize,
  onCloseTab,
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
  onNavigateBack,
  onNavigateForward,
  canNavigateBack = false,
  canNavigateForward = false,
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
  const [animateContent, setAnimateContent] = useState(isOpen)
  const [floatingSize, setFloatingSize] = useState(() => {
    const fallback = { width: 460, height: 600 }
    try {
      const saved = JSON.parse(readAssistantPreference('rowboat-assistant-floating-size') ?? 'null')
      if (Number.isFinite(saved?.width) && Number.isFinite(saved?.height)) {
        return { width: Math.max(360, Math.min(900, saved.width)), height: Math.max(320, Math.min(1000, saved.height)) }
      }
    } catch { return fallback }
    return fallback
  })
  const [localPresetMessage, setLocalPresetMessage] = useState<string | undefined>(undefined)

  const paneRef = useRef<HTMLDivElement>(null)
  const hasOpenedRef = useRef(isOpen)
  const resizeRef = useRef<{ x: number; y: number; size: PanelSize; axis: 'width' | 'height' | 'both'; next: PanelSize } | null>(null)
  const resizeFrame = useRef<number | null>(null)
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
    if (keepMounted || isOpen) {
      setShowContent(true)
      return
    }
    setShowContent(false)
  }, [isOpen, keepMounted])

  useLayoutEffect(() => {
    const pane = paneRef.current
    if (!pane) return
    if (!floating) { pane.style.visibility = isOpen ? 'visible' : 'hidden'; return }
    if (!isOpen && !hasOpenedRef.current) { pane.style.visibility = 'hidden'; return }
    if (isOpen) hasOpenedRef.current = true
    if (!pane.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      pane.style.visibility = isOpen ? 'visible' : 'hidden'
      setAnimateContent(isOpen)
      return
    }
    if (isOpen) setAnimateContent(true)
    pane.style.visibility = 'visible'
    const frames = [{ opacity: 0, transform: 'translateY(16px) scale(0.98)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }]
    const animation = pane.animate(isOpen ? frames : [...frames].reverse(), { duration: isOpen ? 170 : 130, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
    animation.onfinish = () => { pane.style.visibility = isOpen ? 'visible' : 'hidden'; setAnimateContent(isOpen) }
    return () => animation.cancel()
  }, [floating, isOpen])

  useEffect(() => {
    const pane = paneRef.current
    if (!pane || floating || !isOpen || !onDockedWidthChange) return
    const observer = new ResizeObserver(() => onDockedWidthChange(pane.getBoundingClientRect().width))
    observer.observe(pane)
    return () => observer.disconnect()
  }, [floating, isOpen, onDockedWidthChange])

  useEffect(() => () => { if (resizeFrame.current !== null) cancelAnimationFrame(resizeFrame.current) }, [])

  const commitFloatingSize = (size: PanelSize) => {
    setFloatingSize(size)
    onFloatingResize?.(size)
    writeAssistantPreference('rowboat-assistant-floating-size', JSON.stringify(size))
  }

  const resizeHandle = (axis: 'width' | 'height' | 'both') => (
    <div
      role="separator"
      tabIndex={0}
      aria-label={`Resize chat ${axis === 'both' ? 'width and height' : axis}`}
      aria-orientation={axis === 'height' ? 'horizontal' : 'vertical'}
      aria-valuenow={Math.round(axis === 'height' ? (floatingBounds ?? floatingSize).height : (floatingBounds ?? floatingSize).width)}
      className={cn('titlebar-no-drag absolute z-40 touch-none hover:bg-primary/10 focus-visible:bg-primary/20', axis === 'width' ? 'left-0 top-2 bottom-2 w-2 cursor-ew-resize' : axis === 'height' ? 'top-0 left-2 right-2 h-2 cursor-ns-resize' : 'top-0 left-0 size-3 cursor-nwse-resize')}
      onDoubleClick={() => commitFloatingSize(clampPanelSize({ width: 420, height: 600 }, { width: window.innerWidth, height: window.innerHeight }))}
      onPointerDown={(event) => {
        event.preventDefault()
        const bounds = paneRef.current?.getBoundingClientRect()
        if (!bounds) return
        const size = { width: bounds.width, height: bounds.height }
        resizeRef.current = { x: event.clientX, y: event.clientY, size, axis, next: size }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const drag = resizeRef.current
        if (!drag) return
        drag.next = clampPanelSize({ width: drag.size.width + (drag.axis !== 'height' ? drag.x - event.clientX : 0), height: drag.size.height + (drag.axis !== 'width' ? drag.y - event.clientY : 0) }, { width: window.innerWidth - (floatingBounds?.right ?? 12) + 12, height: window.innerHeight })
        if (resizeFrame.current !== null) return
        resizeFrame.current = requestAnimationFrame(() => {
          resizeFrame.current = null
          if (!paneRef.current || !resizeRef.current) return
          paneRef.current.style.width = `${resizeRef.current.next.width}px`
          paneRef.current.style.height = `${resizeRef.current.next.height}px`
        })
      }}
      onLostPointerCapture={() => {
        if (!resizeRef.current) return
        commitFloatingSize(resizeRef.current.next)
        resizeRef.current = null
      }}
      onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
      onPointerCancel={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
        event.preventDefault()
        event.stopPropagation()
        const size = floatingBounds ?? floatingSize
        const step = event.shiftKey ? 40 : 10
        commitFloatingSize(clampPanelSize({ width: size.width + (axis !== 'height' ? (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0) : 0), height: size.height + (axis !== 'width' ? (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0) : 0) }, { width: window.innerWidth, height: window.innerHeight }))
      }}
    />
  )

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
    if (floating) {
      return {
        position: 'fixed', right: floatingBounds?.right ?? 12, bottom: 52, zIndex: 30,
        width: (floatingBounds ?? floatingSize).width, height: (floatingBounds ?? floatingSize).height,
        maxWidth: 'calc(100vw - 88px)', maxHeight: 'calc(100dvh - 108px)',
        minWidth: 'min(320px, calc(100vw - 88px))', minHeight: 'min(280px, calc(100dvh - 108px))',
        pointerEvents: isOpen ? undefined : 'none', transformOrigin: 'bottom right',
      }
    }
    if (!isOpen) {
      return { width: 0, flex: '0 0 auto', borderWidth: 0 }
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
  }, [isOpen, isMaximized, paneSize, width, floating, floatingSize, floatingBounds])

  return (
    <div
      ref={paneRef}
      data-chat-sidebar-root
      data-assistant-panel={activeChatTabId}
      data-assistant-chat={chatTabs.find((tab) => tab.id === activeChatTabId)?.chatId}
      data-docked-chat={isOpen && !floating ? '' : undefined}
      role={floating ? 'region' : undefined}
      aria-label={floating ? 'Assistant conversation' : undefined}
      aria-hidden={!isOpen}
      inert={!isOpen}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || !floating) return
        if ((event.target as HTMLElement).closest('[role="dialog"], [role="menu"], [role="listbox"]')) return
        event.preventDefault()
        onMinimize?.()
      }}
      onMouseDownCapture={onActivate}
      onFocusCapture={onActivate}
      className={cn(
        'relative flex min-w-0 flex-col overflow-hidden bg-background',
        isMiddlePlacement ? 'border-r border-border' : 'border-l border-border',
        !floating && !isResizing && !justToggledMaximize && 'transition-[width] duration-200 ease-linear motion-reduce:transition-none',
        floating && 'rounded-xl border border-border shadow-2xl',
        className
      )}
      style={paneStyle}
    >
      {floating && <span className="sr-only">Use arrow keys on the resize handles to resize. Escape minimizes this chat.</span>}
      {floating && <>{resizeHandle('width')}{resizeHandle('height')}{resizeHandle('both')}</>}
      {!floating && !isMaximized && isResizable && (
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
            className={cn(floating ? 'titlebar-no-drag' : 'titlebar-drag-region', 'flex h-10 shrink-0 items-stretch border-b border-border bg-sidebar')}
            style={{
              paddingLeft: isMaximized ? (sidebarState === 'collapsed' ? collapsedLeftPaddingPx : 12) : undefined,
              paddingRight: isMaximized ? 12 : undefined,
              transition: isMaximized ? 'padding-left 200ms linear' : undefined,
            }}
          >
            {/* Maximized, the pane covers the main ContentHeader — carry the
                same back/forward pair so history navigation stays reachable
                (navigating restores the underlying view and un-maximizes). */}
            {isMaximized && onNavigateBack && onNavigateForward && (
              <>
                <div className="titlebar-no-drag flex items-center gap-1 pr-2 shrink-0">
                  <button
                    type="button"
                    onClick={onNavigateBack}
                    disabled={!canNavigateBack}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
                    aria-label="Go back"
                  >
                    <ChevronLeft className="size-5" />
                  </button>
                  <button
                    type="button"
                    onClick={onNavigateForward}
                    disabled={!canNavigateForward}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
                    aria-label="Go forward"
                  >
                    <ChevronRight className="size-5" />
                  </button>
                </div>
                <div className="titlebar-no-drag self-stretch w-px bg-border/70" aria-hidden="true" />
              </>
            )}
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
            {onToggleDock && !pinnedToCodeSession && <Button variant="ghost" size="icon" onClick={onToggleDock} className="titlebar-no-drag my-1 size-8 shrink-0" aria-label={floating ? 'Dock chat' : 'Undock chat'} title={floating ? 'Dock chat to sidebar' : 'Undock chat into floating panel'}>{floating ? <PanelRightClose className="size-4" /> : <PanelsTopLeft className="size-4" />}</Button>}
            {onOpenFullScreen && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onOpenFullScreen}
                    className="titlebar-no-drag my-1 mr-2 h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={isMaximized ? (onMinimize ? 'Restore chat panel' : 'Dock chat to side pane') : 'Expand chat'}
                  >
                    {isMaximized
                      ? (isMiddlePlacement ? <ArrowLeft className="size-5" /> : <ArrowRight className="size-5" />)
                      : (isMiddlePlacement ? <ArrowRight className="size-5" /> : <ArrowLeft className="size-5" />)}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{isMaximized ? (onMinimize ? 'Restore chat panel' : 'Dock to side pane') : 'Expand chat'}</TooltipContent>
              </Tooltip>
            )}
            {onMinimize && <Button variant="ghost" size="icon" onClick={onMinimize} className="titlebar-no-drag my-1 size-8 shrink-0" aria-label="Minimize chat" title="Minimize chat"><Minus className="size-4" /></Button>}
            {onCloseTab && <Button variant="ghost" size="icon" onClick={onCloseTab} className="titlebar-no-drag my-1 mr-1 size-8 shrink-0" aria-label="Close chat tab" title="Close tab — conversation stays in history"><X className="size-4" /></Button>}
          </header>

          <FileCardProvider onOpenKnowledgeFile={onOpenKnowledgeFile ?? (() => {})} onOpenFile={onOpenFile}>
            <div className="flex min-h-0 flex-1 flex-col">
              {/* Pane padding lives here, on the container — the shared chat pane renders identically on every surface. */}
              <div className="relative min-h-0 flex-1 px-3">
                {chatTabs.map((tab) => {
                  const isActive = tab.id === activeChatTabId && (isOpen || (floating && animateContent))
                  return (
                    <ChatSessionPane
                      // Keyed by chat identity — see App's chat panel key.
                      key={tab.chatId}
                      tab={tab}
                      isActive={isActive}
                      tabState={getTabState(tab.id)}
                      viewportAnchor={viewportAnchors[tab.id]}
                      onPickPrompt={setLocalPresetMessage}
                      isToolOpenForTab={(tabId, toolId) => isToolOpenForTab?.(tabId, toolId)}
                      setToolOpenForTab={(tabId, toolId, open) => onToolOpenChangeForTab?.(tabId, toolId, open)}
                      onPermissionResponse={onPermissionResponse}
                      onAskHumanResponse={onAskHumanResponse}
                      activeIsWorking={isProcessing && !isWaitingOnHuman}
                      activeIsProcessing={isProcessing}
                      activeIsReasoning={isReasoning}
                      onCodePermissionResponse={onCodePermissionResponse}
                      onComposioConnected={(slug) => onComposioConnected?.(slug, tab.id)}
                      emptyStateVariant={pinnedToCodeSession ? 'code' : 'default'}
                      isCodeSession={!!(tab.runId && codeSessionLocks[tab.runId])}
                    />
                  )
                })}
              </div>

              <div className={cn('sticky bottom-0 z-10 bg-background pt-0 shadow-lg', floating ? 'pb-3' : 'pb-12')}>
                <div className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-linear-to-t from-background to-transparent" />
                <div className="mx-auto w-full max-w-4xl px-3">
                  {chatTabs.map((tab) => {
                    const isActive = tab.id === activeChatTabId && (isOpen || (floating && animateContent))
                    return (
                      <ChatSessionComposer
                        // Composer instance per chat — see App's composer key.
                        key={tab.chatId}
                        tab={tab}
                        isActive={isActive}
                        isFocused={isFocused && isOpen}
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
