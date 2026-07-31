import * as React from 'react'
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
import { TurnActivityIndicator } from '@/components/turn-activity-indicator'
import { TurnConversation } from '@/components/turn-conversation'
import { streamdownComponents } from '@/lib/markdown-render'
import { useSmoothedText } from '@/hooks/useSmoothedText'
import type { useVoiceMode } from '@/hooks/useVoiceMode'
import type { PermissionDecision } from '@x/shared/src/code-mode.js'
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

export interface ChatSessionPaneProps {
  tab: ChatTab
  isActive: boolean
  tabState: ChatTabViewState
  viewportAnchor: ChatViewportAnchorState | undefined
  onPickPrompt: (prompt: string) => void
  isToolOpenForTab: (tabId: string, toolId: string) => boolean
  setToolOpenForTab: (tabId: string, toolId: string, open: boolean) => void
  /** Optional: without it, pending permission requests render no approve/deny card (side-pane chat may omit the handler). */
  onPermissionResponse?: (toolCallId: string, subflow: string[], response: 'approve' | 'deny') => void | Promise<void>
  /** Optional: without it, pending ask-human requests are not rendered (side-pane chat may omit the handler). */
  onAskHumanResponse?: (toolCallId: string, subflow: string[], response: string) => void | Promise<void>
  activeIsWorking: boolean
  activeIsProcessing: boolean
  activeIsReasoning: boolean
  /** Extra classes appended to ConversationContent (the side-pane chat adds `px-3`). */
  contentClassName?: string
  /** Vertically center the empty state (default true). The side-pane chat only centers when maximized. */
  centerEmptyState?: boolean
  /** `wide` flag for ChatEmptyState (default true). The side-pane chat is wide only when maximized. */
  emptyStateWide?: boolean
  /**
   * How the in-flight assistant message is rendered. 'smooth' (default, App)
   * animates via useSmoothedText and strips <voice> tags; 'plain' (side-pane
   * chat) renders the raw text directly.
   */
  streamingRenderer?: 'smooth' | 'plain'
  /** Render quick-reply option buttons on ask-human requests (default true). The side-pane chat renders free-text only. */
  askHumanShowOptions?: boolean
  /**
   * Render the rich tool cards — CodingRunBlock for `code_agent_run`,
   * SubAgentBlock for `spawn-agent`, and AppActionCard for app actions
   * (default true, App). The side-pane chat sets this to false and shows those
   * tool calls as generic collapsible Tool rows instead.
   */
  richToolCards?: boolean
  /**
   * Surface the tool's actual error output (via getToolErrorText) on generic
   * tool rows (side-pane chat). Default false (App): a plain 'Tool error'
   * label when the call errored.
   */
  detailedToolErrors?: boolean
  /** Answer a mid-run permission ask from a `code_agent_run` coding turn (App; used by CodingRunBlock). */
  onCodePermissionResponse?: (toolCallId: string, requestId: string, decision: PermissionDecision) => void | Promise<void>
  /** Notified when a ComposioConnectCard finishes connecting a toolkit. */
  onComposioConnected?: (toolkitSlug: string) => void
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
  contentClassName,
  centerEmptyState = true,
  emptyStateWide = true,
  streamingRenderer = 'smooth',
  askHumanShowOptions = true,
  richToolCards = true,
  detailedToolErrors = false,
  onCodePermissionResponse,
  onComposioConnected,
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

  const tabHasConversation = tabState.conversation.length > 0 || tabState.currentAssistantMessage
  const tabConversationContentClassName = cn(
    'mx-auto w-full max-w-4xl',
    contentClassName,
    tabHasConversation ? 'pb-28' : 'pb-0',
    !tabHasConversation && centerEmptyState && 'min-h-full items-center justify-center',
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
              wide={emptyStateWide}
              onPickPrompt={onPickPrompt}
            />
          ) : (
            <>
              <TurnConversation
                items={tabState.conversation}
                isToolOpen={(toolId) => isToolOpenForTab(tab.id, toolId)}
                onToolOpenChange={(toolId, open) => setToolOpenForTab(tab.id, toolId, open)}
                richToolCards={richToolCards}
                detailedToolErrors={detailedToolErrors}
                permissionRequests={tabState.allPermissionRequests}
                permissionResponses={tabState.permissionResponses}
                autoPermissionDecisions={tabState.autoPermissionDecisions}
                onPermissionResponse={onPermissionResponse}
                permissionIsProcessing={isActive && activeIsWorking}
                onCodePermissionResponse={onCodePermissionResponse}
                onComposioConnected={onComposioConnected}
              />


              {onAskHumanResponse && Array.from(tabState.pendingAskHumanRequests.values()).map((request) => (
                <AskHumanRequest
                  key={request.toolCallId}
                  query={request.query}
                  options={askHumanShowOptions ? request.options : undefined}
                  onResponse={(response) => onAskHumanResponse(request.toolCallId, request.subflow, response)}
                  isProcessing={isActive && activeIsWorking}
                />
              ))}

              {tabState.currentAssistantMessage && (
                <Message from="assistant">
                  <MessageContent>
                    {streamingRenderer === 'plain' ? (
                      <MessageResponse components={streamdownComponents}>{tabState.currentAssistantMessage}</MessageResponse>
                    ) : (
                      <SmoothStreamingMessage text={tabState.currentAssistantMessage.replace(/<\/?voice>/g, '')} components={streamdownComponents} />
                    )}
                  </MessageContent>
                </Message>
              )}

              {isActive && activeIsProcessing && (
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
      <ChatInputWithMentions
        knowledgeFiles={knowledgeFiles}
        recentFiles={recentFiles}
        visibleFiles={visibleFiles}
        onSubmit={onSubmit}
        onStop={onStop}
        isProcessing={isActive && activeIsProcessing}
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
        onStartCall={isActive ? onStartCall : undefined}
        onEndCall={isActive ? onEndCall : undefined}
        callAvailable={callAvailable ?? (voiceAvailable && ttsAvailable)}
      />
    </div>
  )
}
