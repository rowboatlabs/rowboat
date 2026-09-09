import { useState, type ReactElement } from 'react'
import { toast } from 'sonner'
import { useSessionChat } from '@/hooks/useSessionChat'
import { createEmptyChatTabViewState } from '@/lib/chat-conversation'
import type { PanelSize } from '@/lib/assistant-panel-layout'
import { ChatSidebar, type ChatSidebarProps } from './chat-sidebar'
import { queuedMessageText } from './chat-session'
import type { ChatTab } from './tab-bar'

interface AssistantPanelsProps {
  allowDockControls?: boolean
  onDockedWidthChange: (width: number) => void
  recordingChatId?: string | null
  callSessionId?: string | null
  floatingEnabled: boolean
  dockedTabId: string | null
  children: ReactElement<ChatSidebarProps>
  bounds: Record<string, PanelSize & { right: number }>
  onResize: (tabId: string, size: PanelSize) => void
  onFocus: (tab: ChatTab) => void
  onMinimize: (tabId: string) => void
  onClose: (tabId: string) => void
  onToggleDock: (tab: ChatTab) => void
  onChangeChat: (tabId: string, sessionId: string | null) => void
  onSubmit: (tabId: string, ...args: Parameters<ChatSidebarProps['onSubmit']>) => void
}

function SessionPanel({ tab, workspace, base }: { tab: ChatTab; workspace: Omit<AssistantPanelsProps, 'children'>; base: ChatSidebarProps }) {
  const [restoredDraft, setRestoredDraft] = useState<string>()
  const [stopping, setStopping] = useState(false)
  const active = tab.id === base.activeChatTabId
  const floating = workspace.floatingEnabled && tab.id !== workspace.dockedTabId
  const expanded = floating ? Boolean(workspace.bounds[tab.id]) : tab.id === workspace.dockedTabId && base.isOpen
  const session = useSessionChat(tab.runId, undefined, Boolean(expanded))
  const state = session.chatState ?? createEmptyChatTabViewState()
  const recording = workspace.recordingChatId === tab.chatId
  const calling = Boolean(tab.runId && workspace.callSessionId === tab.runId)
  const reportError = (error: unknown) => toast.error(error instanceof Error ? error.message : 'Chat action failed. Please try again.')
  const restore = (text: string) => {
    if (!text) return
    const draft = base.getInitialDraft?.(tab.id)?.trim()
    const next = draft ? `${draft}\n\n${text}` : text
    base.onDraftChangeForTab?.(tab.id, next)
    setRestoredDraft(next)
  }
  return <ChatSidebar
    {...base}
    {...state}
    conversation={session.error ? [{ id: 'session-load-error', kind: 'error', message: `Failed to load chat: ${session.error}`, timestamp: 0 }] : state.conversation}
    chatTabs={[tab]}
    activeChatTabId={tab.id}
    runId={tab.runId}
    keepMounted
    floating={floating}
    className={floating ? undefined : base.className}
    isOpen={expanded}
    isFocused={active}
    isMaximized={active && base.isMaximized}
    floatingBounds={workspace.bounds[tab.id]}
    onFloatingResize={(size) => workspace.onResize(tab.id, size)}
    onDockedWidthChange={workspace.onDockedWidthChange}
    onActivate={() => { if (!active) workspace.onFocus(tab); base.onActivate?.() }}
    onToggleDock={!base.pinnedToCodeSession && workspace.allowDockControls !== false ? () => workspace.onToggleDock(tab) : undefined}
    onMinimize={floating ? () => workspace.onMinimize(tab.id) : undefined}
    onCloseTab={base.onCloseTab ? () => workspace.onClose(tab.id) : undefined}
    onOpenFullScreen={base.onOpenFullScreen ? () => { workspace.onFocus(tab); base.onOpenFullScreen?.() } : undefined}
    pinnedToCodeSession={active ? base.pinnedToCodeSession : null}
    isProcessing={session.chatState?.isProcessing ?? false}
    isReasoning={session.chatState?.isReasoning ?? false}
    isWaitingOnHuman={session.chatState?.isWaitingOnHuman ?? false}
    isStopping={active && calling ? base.isStopping : stopping}
    queuedForActive={session.queued}
    restoredSelectionForActive={session.chatState?.lastSelection}
    presetMessage={restoredDraft ?? (active ? base.presetMessage : undefined)}
    onPresetMessageConsumed={() => { setRestoredDraft(undefined); if (active) base.onPresetMessageConsumed?.() }}
    onSubmit={(...args) => workspace.onSubmit(tab.id, ...args)}
    onSelectRun={(sessionId) => workspace.onChangeChat(tab.id, sessionId)}
    onNewChatTab={() => workspace.onChangeChat(tab.id, null)}
    onStop={() => {
      if (active && base.callOnThisChat) { base.onStop?.(); return }
      setStopping(true)
      void session.stop().then((entries) => restore(entries.map((entry) => queuedMessageText(entry.message)).filter(Boolean).join('\n\n'))).catch(reportError).finally(() => setStopping(false))
    }}
    onRemoveQueued={(id) => { void session.removeQueued(id).catch(reportError) }}
    onPullQueued={(id) => { void session.removeQueued(id).then((entry) => restore(entry ? queuedMessageText(entry.message) : '')).catch(reportError) }}
    onPermissionResponse={(id, _subflow, response) => { void session.respondToPermission(id, response === 'approve' ? 'allow' : 'deny').catch(reportError) }}
    onAskHumanResponse={(id, _subflow, response) => { void session.answerAskHuman(id, response).catch(reportError) }}
    isRecording={recording && base.isRecording}
    recordingText={recording ? base.recordingText : undefined}
    onStartRecording={() => { workspace.onFocus(tab); base.onStartRecording?.() }}
    callOnThisChat={calling}
    onStartCall={(preset) => { workspace.onFocus(tab); base.onStartCall?.(preset) }}
  />
}

export function AssistantPanels({ children, ...workspace }: AssistantPanelsProps) {
  return children.props.chatTabs.map((tab) => <SessionPanel key={tab.chatId} tab={tab} workspace={workspace} base={children.props} />)
}
