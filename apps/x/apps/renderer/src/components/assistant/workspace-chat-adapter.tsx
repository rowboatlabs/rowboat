import { useState } from 'react'
import { toast } from 'sonner'
import { ChatSidebar } from '@/components/chat-sidebar'
import { useSessionChat } from '@/hooks/useSessionChat'
import { createEmptyChatTabViewState } from '@/lib/chat-conversation'
import { queuedMessageText } from '@/components/chat-session'
import type { ChatServices } from './chat'

/** Keeps Code/Projects bound to their selected session while floating chats take focus. */
export function WorkspaceChatAdapter({ services: p, sessionId, onFocus }: { services: ChatServices; sessionId: string | null; onFocus: (id: string) => void }) {
  const session = useSessionChat(sessionId)
  const [empty] = useState(createEmptyChatTabViewState)
  const [preset, setPreset] = useState<string>()
  const tab = p.chatTabs.find((tab) => tab.runId === sessionId)
  if (!tab) return null
  const state = session.chatState ?? p.chatTabStates?.[tab.id] ?? empty
  const perform = (fn: () => Promise<unknown>) => { void fn().catch((error) => toast.error(String(error))) }
  const restore = (text: string) => {
    if (!text) return
    const draft = p.getInitialDraft?.(tab.id)?.trim()
    const value = draft ? `${draft}\n\n${text}` : text
    p.onDraftChangeForTab?.(tab.id, value)
    setPreset(value)
  }
  return <ChatSidebar {...p}
    chatTabs={[tab]} activeChatTabId={tab.id} runId={sessionId} chatTabStates={{ [tab.id]: { ...state, runId: sessionId } }}
    conversation={state.conversation} currentAssistantMessage={state.currentAssistantMessage} currentReasoning={state.currentReasoning}
    sessionUsage={state.sessionUsage} isProcessing={session.chatState?.isProcessing ?? false} isReasoning={session.chatState?.isReasoning}
    isWaitingOnHuman={session.chatState?.isWaitingOnHuman} isStopping={false} queuedForActive={session.queued}
    pendingAskHumanRequests={state.pendingAskHumanRequests} allPermissionRequests={state.allPermissionRequests}
    permissionResponses={state.permissionResponses} autoPermissionDecisions={state.autoPermissionDecisions}
    restoredSelectionForActive={session.chatState?.lastSelection} presetMessage={preset ?? (p.activeChatTabId === tab.id ? p.presetMessage : undefined)}
    onPresetMessageConsumed={() => { setPreset(undefined); if (p.activeChatTabId === tab.id) p.onPresetMessageConsumed?.() }}
    onActivate={() => onFocus(tab.id)} onSubmit={(...args) => p.onSubmitForTab(tab.id, ...args)}
    onStop={() => perform(async () => restore((await session.stop()).map((entry) => queuedMessageText(entry.message)).join('\n\n')))}
    onRemoveQueued={(id) => perform(() => session.removeQueued(id))}
    onPullQueued={(id) => perform(async () => { const removed = await session.removeQueued(id); if (removed) restore(queuedMessageText(removed.message)) })}
    onPermissionResponse={(id, _subflow, response) => perform(() => session.respondToPermission(id, response === 'approve' ? 'allow' : 'deny'))}
    onAskHumanResponse={(id, _subflow, response) => perform(() => session.answerAskHuman(id, response))}
    isRecording={p.voiceOwner === tab.chatId && p.isRecording} recordingText={p.voiceOwner === tab.chatId ? p.recordingText : undefined}
    onStartRecording={() => p.onStartRecordingForTab(tab.id)} onStartCall={(preset) => p.onStartCallForTab(tab.id, preset)} callOnThisChat={!!sessionId && p.callChatId === sessionId} />
}
