import { useState, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpLeft, ArrowRightToLine } from 'lucide-react'
import { toast } from 'sonner'
import { ChatHeader } from '@/components/chat-header'
import { ChatSessionPane, ChatSessionComposer, queuedMessageText, type ChatSessionComposerProps } from '@/components/chat-session'
import { FileCardProvider } from '@/contexts/file-card-context'
import { useSessionChat } from '@/hooks/useSessionChat'
import { useSessionTitle } from '@/lib/session-title'
import { createEmptyChatTabViewState, type ChatTabViewState } from '@/lib/chat-conversation'
import type { ChatLocation } from '@/lib/assistant-layout'
import type { ChatTab } from '@/components/tab-bar'
import type { ChatSidebarProps } from '@/components/chat-sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export interface ChatServices extends ChatSidebarProps {
  onSubmitForTab: (id: string, ...args: Parameters<ChatSessionComposerProps['onSubmit']>) => void | Promise<void>
  onStartRecordingForTab: (id: string) => void
  voiceOwner: string | null
  callChatId: string | null
  onStartCallForTab: (id: string, ...args: Parameters<NonNullable<ChatSessionComposerProps['onStartCall']>>) => void
}

const destinations = [
  { location: 'sidebar', label: 'Move to sidebar', Icon: ArrowRightToLine },
  { location: 'assistant', label: 'Move to Assistant', Icon: ArrowUpLeft },
  { location: 'floating', label: 'Move to floating window', Icon: ArrowDownRight },
] as const

/** One stable conversation instance. Its parent changes its host, never its
 *  identity. The chat can ask to be moved; minimizing and closing belong to
 *  the container it sits in. A container whose controls share the header row
 *  (the sidebar's close button) passes them as `controls` rather than stacking
 *  a strip of its own above the chat. */
export function Chat({ tab, location, visible, focused, services: p, onMove, onNew, onSelect, controls }: {
  tab: ChatTab; location: ChatLocation; visible: boolean; focused: boolean; services: ChatServices
  onMove: (location: ChatLocation) => void; onNew: () => void; onSelect: (id: string) => void; controls?: ReactNode
}) {
  const session = useSessionChat(tab.runId)
  const title = useSessionTitle(tab.runId) ?? p.getChatTabTitle(tab)
  const [emptyState] = useState(createEmptyChatTabViewState)
  const [preset, setPreset] = useState<string>()
  const [stopping, setStopping] = useState(false)
  const live = session.chatState
  const state: ChatTabViewState = live ? { ...live, runId: tab.runId } : p.chatTabStates?.[tab.id] ?? emptyState
  const working = live?.isProcessing ?? false
  const restore = (text: string) => {
    if (!text) return
    const draft = p.getInitialDraft?.(tab.id)?.trim()
    const restored = draft ? `${draft}\n\n${text}` : text
    p.onDraftChangeForTab?.(tab.id, restored)
    setPreset(restored)
  }
  const reportError = (error: unknown) => toast.error(error instanceof Error ? error.message : String(error))
  const action = (fn: () => Promise<unknown>) => { void fn().catch(reportError) }
  return <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[inherit] bg-background" data-canonical-chat={tab.chatId}>
    <header data-chat-header className="rowboat-header titlebar-no-drag flex shrink-0 items-center border-b border-border px-1">
      <ChatHeader activeTitle={title} activeRunId={tab.runId} sessionUsage={state.sessionUsage}
        onNewChatTab={onNew} recentRuns={p.recentRuns} onSelectRun={onSelect} onOpenChatHistory={p.onOpenChatHistory} />
      {destinations.filter((destination) => destination.location !== location).map(({ location, label, Icon }) => <Tooltip key={location}>
        <TooltipTrigger asChild><button type="button" aria-label={label} onClick={() => onMove(location)} className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><Icon className="size-4" /></button></TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>)}
      {controls}
    </header>
    <FileCardProvider onOpenKnowledgeFile={p.onOpenKnowledgeFile ?? (() => {})} onOpenFile={p.onOpenFile}>
      {session.error && <div role="alert" className="px-4 py-2 text-sm text-destructive">{session.error}</div>}
      <div className="relative min-h-0 flex-1">
        <ChatSessionPane tab={tab} isActive={visible} tabState={state} viewportAnchor={p.viewportAnchors?.[tab.id]}
          onPickPrompt={setPreset} isToolOpenForTab={(id, tool) => p.isToolOpenForTab?.(id, tool)}
          setToolOpenForTab={(id, tool, open) => p.onToolOpenChangeForTab?.(id, tool, open)}
          activeIsWorking={working && !live?.isWaitingOnHuman} activeIsProcessing={working} activeIsReasoning={live?.isReasoning ?? false}
          onPermissionResponse={(tool, _subflow, response) => action(() => session.respondToPermission(tool, response === 'approve' ? 'allow' : 'deny'))}
          onAskHumanResponse={(tool, _subflow, response) => action(() => session.answerAskHuman(tool, response))}
          onCodePermissionResponse={p.onCodePermissionResponse}
          onComposioConnected={(slug) => p.onComposioConnected?.(slug, tab.id)}
          isCodeSession={!!(tab.runId && p.codeSessionLocks?.[tab.runId])} />
      </div>
      <div className="rowboat-composer-dock shrink-0 bg-background px-3 pb-3 pt-2">
        <div className="mx-auto w-full max-w-4xl">
          <ChatSessionComposer tab={tab} isActive={visible} focused={focused && visible} tabState={state}
            knowledgeFiles={p.knowledgeFiles ?? []} recentFiles={p.recentFiles ?? []} visibleFiles={p.visibleFiles ?? []}
            onSubmit={(...args) => p.onSubmitForTab(tab.id, ...args)} activeIsProcessing={working} isStopping={stopping}
            onStop={async () => {
              setStopping(true)
              try { restore((await session.stop()).map((entry) => queuedMessageText(entry.message)).filter(Boolean).join('\n\n')) }
              catch (error) { reportError(error) } finally { setStopping(false) }
            }}
            queued={session.queued}
            onRemoveQueued={(id) => action(() => session.removeQueued(id))}
            onPullQueued={(id) => action(async () => { const removed = await session.removeQueued(id); if (removed) restore(queuedMessageText(removed.message)) })}
            presetMessage={preset ?? (p.activeChatTabId === tab.id ? p.presetMessage : undefined)}
            onPresetMessageConsumed={() => { setPreset(undefined); if (p.activeChatTabId === tab.id) p.onPresetMessageConsumed?.() }}
            initialDraft={p.getInitialDraft?.(tab.id)} onDraftChange={(id, text) => p.onDraftChangeForTab?.(id, text)}
            initialSelection={p.getInitialSelection?.(tab.id)} restoredSelection={live?.lastSelection}
            onSelectionChange={(entry, selection) => p.onSelectionChangeForTab?.(entry.id, selection)}
            workDirByTab={p.workDirByTab ?? {}} onWorkDirChange={(id, dir) => p.onWorkDirChangeForTab?.(id, dir)} codeSessionLocks={p.codeSessionLocks ?? {}}
            recordingOverrides={{ isRecording: p.voiceOwner === tab.chatId && p.isRecording, recordingText: p.voiceOwner === tab.chatId ? p.recordingText : undefined,
              recordingState: p.voiceOwner === tab.chatId ? p.recordingState : undefined, audioLevelsRef: p.audioLevelsRef, onStartRecording: () => p.onStartRecordingForTab(tab.id) }}
            onSubmitRecording={p.onSubmitRecording} onCancelRecording={p.onCancelRecording} voiceAvailable={p.voiceAvailable}
            inCall={p.inCall} callOnThisChat={!!tab.runId && tab.runId === p.callChatId} onStartCall={(preset) => p.onStartCallForTab(tab.id, preset)} onEndCall={p.onEndCall} callAvailable={p.callAvailable} />
        </div>
      </div>
    </FileCardProvider>
  </div>
}
