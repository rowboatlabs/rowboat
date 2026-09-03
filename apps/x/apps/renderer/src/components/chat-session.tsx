import * as React from 'react'
import { Clock, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message'
import {
  type PromptInputMessage,
  type FileMention,
} from '@/components/ai-elements/prompt-input'
import { AskHumanRequest } from '@/components/ai-elements/ask-human-request'
import { ReasoningRow } from '@/components/reasoning-row'
import { TurnActivityIndicator } from '@/components/turn-activity-indicator'
import { TurnConversation } from '@/components/turn-conversation'
import { streamdownComponents } from '@/lib/markdown-render'
import { useSmoothedText } from '@/hooks/useSmoothedText'
import type { useVoiceMode } from '@/hooks/useVoiceMode'
import type { PermissionDecision } from '@x/shared/src/code-mode.js'
import type { QueuedSessionMessage } from '@x/shared/src/sessions.js'
import { ChatEmptyState } from './chat-empty-state'
import { ChatInputWithMentions, type CallPreset, type PermissionMode, type StagedAttachment, type ModelSelection } from './chat-input-with-mentions'
import { type ChatTab } from './tab-bar'
import { useReportTabMeta } from '@/lib/tab-meta'
import { useSessionTitle } from '@/lib/session-title'
import {
  type ChatTabViewState,
  type ChatViewportAnchorState,
} from '@/lib/chat-conversation'

function SmoothStreamingMessage({ text, components }: { text: string; components: typeof streamdownComponents }) {
  const smoothText = useSmoothedText(text)
  return <MessageResponse components={components}>{smoothText}</MessageResponse>
}

// The typed text of a queued (not-yet-delivered) message — for the pending
// chip's preview and for restoring the text into the composer (chip pull-back,
// stop-drained queue). Attachment/image parts are elided.
export function queuedMessageText(message: QueuedSessionMessage['message']): string {
  if (typeof message.content === 'string') return message.content.trim()
  return message.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim()
}

export interface ChatSessionPaneProps {
  tab: ChatTab
  isActive: boolean
  tabState: ChatTabViewState
  viewportAnchor: ChatViewportAnchorState | undefined
  onPickPrompt: (prompt: string) => void
  /** `undefined` = no explicit choice; TurnConversation applies the per-tool default. */
  isToolOpenForTab: (tabId: string, toolId: string) => boolean | undefined
  setToolOpenForTab: (tabId: string, toolId: string, open: boolean) => void
  /** Optional: without it, pending permission requests render no approve/deny card (side-pane chat may omit the handler). */
  onPermissionResponse?: (toolCallId: string, subflow: string[], response: 'approve' | 'deny') => void | Promise<void>
  /** Optional: without it, pending ask-human requests are not rendered (side-pane chat may omit the handler). */
  onAskHumanResponse?: (toolCallId: string, subflow: string[], response: string) => void | Promise<void>
  activeIsWorking: boolean
  activeIsProcessing: boolean
  activeIsReasoning: boolean
  /** Answer a mid-run permission ask from a `code_agent_run` coding turn (used by CodingRunBlock). */
  onCodePermissionResponse?: (toolCallId: string, requestId: string, decision: PermissionDecision) => void | Promise<void>
  /** Notified when a ComposioConnectCard finishes connecting a toolkit. */
  onComposioConnected?: (toolkitSlug: string) => void
  /** Empty-state flavour: 'code' for a chat bound to a coding session. */
  emptyStateVariant?: 'default' | 'code'
}

export function ChatSessionPane({
  tab,
  isActive,
  tabState,
  viewportAnchor,
  onPickPrompt,
  isToolOpenForTab,
  setToolOpenForTab,
  onPermissionResponse,
  onAskHumanResponse,
  activeIsWorking,
  activeIsProcessing,
  activeIsReasoning,
  onCodePermissionResponse,
  onComposioConnected,
  emptyStateVariant = 'default',
}: ChatSessionPaneProps) {
  // Content-owned tab meta (see lib/tab-meta.ts). Both live instances of a
  // chat (full-screen App pane + side-pane chat) report the same values, so
  // the store's dedupe keeps this quiet; the refcount inside useReportTabMeta
  // keeps one instance's unmount from wiping the other's report.
  // - title: only claimed once the shared session-title store knows this
  //   session's title; `undefined` hands the field back to the strip's
  //   fallback (App's `runs`-derived title, including the optimistic
  //   first-send title and the 'New chat' / '(Untitled chat)' placeholders).
  // - busy: claimed only while this pane has a truthy signal. The only signal
  //   it receives (`activeIsProcessing`) is active-tab-gated, so background
  //   tabs report `undefined` and App's `isChatTabProcessing` fallback keeps
  //   driving their busy state.
  const sessionTitle = useSessionTitle(tab.runId)
  useReportTabMeta(tab.id, {
    title: sessionTitle,
    busy: isActive && activeIsProcessing ? true : undefined,
  })

  // Batched ask-human calls (several questions in one model response) render
  // ONE card at a time, numbered "1 of N". The pending map only holds
  // unanswered questions, so remember the batch's high-water mark while it
  // drains to know N (and which question we're on); reset once it empties.
  // A lone question (the common sequential case) never shows a counter.
  const pendingAsks = Array.from(tabState.pendingAskHumanRequests.values())
  const askBatchMaxRef = React.useRef(0)
  askBatchMaxRef.current = pendingAsks.length === 0 ? 0 : Math.max(askBatchMaxRef.current, pendingAsks.length)
  const askBatchTotal = askBatchMaxRef.current
  const currentAsk = pendingAsks[0]

  const tabHasConversation = tabState.conversation.length > 0 || tabState.currentAssistantMessage
  const tabConversationContentClassName = cn(
    'mx-auto w-full max-w-[820px] px-6',
    tabHasConversation ? 'pb-28' : 'pb-0',
    !tabHasConversation && 'min-h-full items-center justify-center',
  )
  return (
    <div
      className={cn(
        'min-h-0 h-full flex-col',
        isActive
          ? 'flex'
          : 'pointer-events-none invisible absolute inset-0 flex'
      )}
      data-chat-tab-panel={tab.id}
      aria-hidden={!isActive}
    >
      <Conversation
        anchorMessageId={viewportAnchor?.messageId}
        anchorRequestKey={viewportAnchor?.requestKey}
        className="relative flex-1"
      >
        <ConversationContent className={tabConversationContentClassName}>
          {!tabHasConversation ? (
            <ChatEmptyState
              wide
              variant={emptyStateVariant}
              onPickPrompt={onPickPrompt}
            />
          ) : (
            <>
              <TurnConversation
                items={tabState.conversation}
                isToolOpen={(toolId) => isToolOpenForTab(tab.id, toolId)}
                onToolOpenChange={(toolId, open) => setToolOpenForTab(tab.id, toolId, open)}
                permissionRequests={tabState.allPermissionRequests}
                permissionResponses={tabState.permissionResponses}
                autoPermissionDecisions={tabState.autoPermissionDecisions}
                onPermissionResponse={onPermissionResponse}
                permissionIsProcessing={isActive && activeIsWorking}
                onCodePermissionResponse={onCodePermissionResponse}
                onComposioConnected={onComposioConnected}
              />


              {onAskHumanResponse && currentAsk && (
                <AskHumanRequest
                  key={currentAsk.toolCallId}
                  query={currentAsk.query}
                  options={currentAsk.options}
                  multiSelect={currentAsk.multiSelect}
                  progress={
                    askBatchTotal > 1
                      ? { current: askBatchTotal - pendingAsks.length + 1, total: askBatchTotal }
                      : undefined
                  }
                  onResponse={(response) => onAskHumanResponse(currentAsk.toolCallId, currentAsk.subflow, response)}
                  isProcessing={isActive && activeIsWorking}
                />
              )}

              {/* In-flight model call's thought stream: open with a
                  "Thinking..." shimmer while reasoning streams, auto-collapses
                  once the model moves on to its answer. Replaced by the
                  durable (collapsed) reasoning item when the call completes. */}
              {tabState.currentReasoning && (
                <ReasoningRow
                  content={tabState.currentReasoning}
                  isStreaming={isActive && activeIsReasoning}
                />
              )}

              {tabState.currentAssistantMessage && (
                <Message from="assistant">
                  <MessageContent>
                    <SmoothStreamingMessage text={tabState.currentAssistantMessage.replace(/<\/?voice>/g, '')} components={streamdownComponents} />
                  </MessageContent>
                </Message>
              )}

              {/* The reasoning block above already shows its own "Thinking..."
                  shimmer while thought text is streaming — only fall back to
                  the bare indicator when there is nothing to show (working, or
                  reasoning with no visible text, e.g. encrypted-only). */}
              {isActive && activeIsProcessing && !(activeIsReasoning && tabState.currentReasoning) && (
                <Message from="assistant">
                  <MessageContent>
                    <TurnActivityIndicator isReasoning={activeIsReasoning} />
                  </MessageContent>
                </Message>
              )}
            </>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </div>
  )
}

export interface ChatSessionComposerProps {
  tab: ChatTab
  isActive: boolean
  tabState: ChatTabViewState
  knowledgeFiles: string[]
  recentFiles: string[]
  visibleFiles: string[]
  onSubmit: (
    message: PromptInputMessage,
    mentions?: FileMention[],
    stagedAttachments?: StagedAttachment[],
    searchEnabled?: boolean,
    codeMode?: 'claude' | 'codex',
    permissionMode?: PermissionMode,
  ) => void | Promise<void>
  onStop?: () => void | Promise<void>
  activeIsProcessing: boolean
  isStopping?: boolean
  /**
   * Messages waiting in this session's pending queue (sent while the latest
   * turn was still running) — rendered as chips above the input until they
   * steer the live turn or start the next one.
   */
  queued?: QueuedSessionMessage[]
  /** Discard a queued message (chip ×). */
  onRemoveQueued?: (queueId: string) => void
  /** Pull a queued message back into the composer for editing (chip body click). */
  onPullQueued?: (queueId: string) => void
  presetMessage: string | undefined
  onPresetMessageConsumed: () => void
  codeSessionLocks: Record<string, { cwd: string; agent: 'claude' | 'codex' }>
  initialDraft: string | undefined
  onDraftChange: (tabId: string, text: string) => void
  /**
   * The chat's selection (model + effort, ONE value — see the composer's
   * ModelSelection contract) reported on every change, settings seed
   * included; receives the tab so the caller picks its key (chatId).
   */
  onSelectionChange?: (tab: ChatTab, selection: ModelSelection | null) => void
  /** The chat's prior selection (per-tab continuity within the app run). */
  initialSelection?: ModelSelection | null
  /** A reopened session's last-turn selection (see the composer prop). */
  restoredSelection?: ModelSelection | null
  workDirByTab: Record<string, string | null>
  onWorkDirChange: (tabId: string, value: string | null) => void
  isRecording?: boolean
  voiceOwner?: string | null
  voice?: Pick<ReturnType<typeof useVoiceMode>, 'state' | 'interimText' | 'audioLevelsRef'>
  onStartRecording?: (holderId: string) => void
  /**
   * Pre-resolved per-tab recording props (side-pane chat): passed straight
   * through to the input instead of deriving them from voiceOwner/voice.
   */
  recordingOverrides?: {
    isRecording?: boolean
    recordingText?: string
    recordingState?: 'connecting' | 'listening' | 'stopping'
    audioLevelsRef?: React.MutableRefObject<number[]>
    onStartRecording?: () => void
  }
  onSubmitRecording?: () => void | Promise<void>
  onCancelRecording?: () => void
  voiceAvailable?: boolean
  inCall?: boolean
  callOnThisChat?: boolean
  onStartCall?: (preset: CallPreset) => void
  onEndCall?: () => void
  ttsAvailable?: boolean
  /** Pre-resolved call availability (side-pane chat); defaults to voiceAvailable && ttsAvailable. */
  callAvailable?: boolean
}

export function ChatSessionComposer({
  tab,
  isActive,
  tabState,
  knowledgeFiles,
  recentFiles,
  visibleFiles,
  onSubmit,
  onStop,
  activeIsProcessing,
  isStopping,
  queued = [],
  onRemoveQueued,
  onPullQueued,
  presetMessage,
  onPresetMessageConsumed,
  codeSessionLocks,
  initialDraft,
  onDraftChange,
  onSelectionChange,
  initialSelection = null,
  restoredSelection,
  workDirByTab,
  onWorkDirChange,
  isRecording,
  voiceOwner,
  voice,
  onStartRecording,
  recordingOverrides,
  onSubmitRecording,
  onCancelRecording,
  voiceAvailable,
  inCall,
  callOnThisChat,
  onStartCall,
  onEndCall,
  ttsAvailable,
  callAvailable,
}: ChatSessionComposerProps) {
  const ownsVoice = voiceOwner != null && voiceOwner === tab.chatId
  return (
    <div
      className={isActive ? 'block' : 'hidden'}
      data-chat-input-panel={tab.id}
      aria-hidden={!isActive}
    >
      {queued.length > 0 && (
        /* Pending queue: messages accepted mid-turn, waiting to steer the live
           turn (or start the next one). Clicking a chip pulls it back into the
           composer for editing; ✕ discards it. */
        <div className="mb-1.5 flex flex-col gap-1">
          {queued.map((entry) => (
            <div
              key={entry.queueId}
              className="group flex items-center gap-2 rounded-lg border border-border/50 bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground"
            >
              <Clock className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
              <button
                type="button"
                onClick={() => onPullQueued?.(entry.queueId)}
                className="min-w-0 flex-1 truncate text-left transition-colors hover:text-foreground"
                title="Queued — click to edit"
              >
                {queuedMessageText(entry.message) || 'Attachment'}
              </button>
              <span className="shrink-0 text-[13px] text-muted-foreground">Queued</span>
              <button
                type="button"
                onClick={() => onRemoveQueued?.(entry.queueId)}
                aria-label="Remove queued message"
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full opacity-60 transition-[opacity,color] hover:opacity-100 hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <ChatInputWithMentions
        knowledgeFiles={knowledgeFiles}
        recentFiles={recentFiles}
        visibleFiles={visibleFiles}
        onSubmit={onSubmit}
        onStop={onStop}
        isProcessing={isActive && activeIsProcessing}
        // Session chats never drop a mid-turn send: Enter queues/steers via
        // sessions:sendOrQueueMessage (the Stop button still shows while busy).
        allowSubmitWhileProcessing
        isStopping={isActive && isStopping}
        isActive={isActive}
        presetMessage={isActive ? presetMessage : undefined}
        onPresetMessageConsumed={isActive ? onPresetMessageConsumed : undefined}
        runId={tabState.runId}
        codeSessionLock={tabState.runId ? codeSessionLocks[tabState.runId] ?? null : null}
        initialDraft={initialDraft}
        onDraftChange={(text) => onDraftChange(tab.id, text)}
        onSelectionChange={(selection) => onSelectionChange?.(tab, selection)}
        initialSelection={initialSelection}
        restoredSelection={restoredSelection}
        workDir={workDirByTab[tab.id] ?? null}
        onWorkDirChange={(v) => onWorkDirChange(tab.id, v)}
        isRecording={recordingOverrides ? recordingOverrides.isRecording : (isRecording && ownsVoice)}
        recordingText={recordingOverrides ? recordingOverrides.recordingText : (ownsVoice ? voice?.interimText : undefined)}
        recordingState={recordingOverrides ? recordingOverrides.recordingState : (ownsVoice && voice ? (voice.state === 'submitting' ? 'stopping' : voice.state === 'connecting' ? 'connecting' : 'listening') : undefined)}
        audioLevelsRef={recordingOverrides ? recordingOverrides.audioLevelsRef : voice?.audioLevelsRef}
        onStartRecording={
          recordingOverrides
            ? recordingOverrides.onStartRecording
            : isActive && onStartRecording
              ? () => onStartRecording(tab.chatId)
              : undefined
        }
        onSubmitRecording={isActive ? onSubmitRecording : undefined}
        onCancelRecording={isActive ? onCancelRecording : undefined}
        voiceAvailable={isActive && voiceAvailable}
        inCall={inCall}
        callOnThisChat={callOnThisChat}
        onStartCall={isActive ? onStartCall : undefined}
        onEndCall={isActive ? onEndCall : undefined}
        callAvailable={callAvailable ?? (voiceAvailable && ttsAvailable)}
      />
    </div>
  )
}
