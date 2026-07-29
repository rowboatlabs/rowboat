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
import { ToolGroupComponent } from '@/components/ai-elements/tool'
import { PermissionRequest } from '@/components/ai-elements/permission-request'
import { AutoPermissionDecision } from '@/components/ai-elements/auto-permission-decision'
import { AskHumanRequest } from '@/components/ai-elements/ask-human-request'
import { TurnActivityIndicator } from '@/components/turn-activity-indicator'
import { MarkdownPreOverride } from '@/components/ai-elements/markdown-code-override'
import { useSmoothedText } from '@/hooks/useSmoothedText'
import type { useVoiceMode } from '@/hooks/useVoiceMode'
import { ChatEmptyState } from './chat-empty-state'
import { ChatInputWithMentions, type CallPreset, type PermissionMode, type StagedAttachment } from './chat-input-with-mentions'
import { type ChatTab } from './tab-bar'
import {
  type ChatTabViewState,
  type ChatViewportAnchorState,
  type ConversationItem,
  groupConversationItems,
  isToolCall,
  isToolGroup,
} from '@/lib/chat-conversation'

const streamdownComponents = { pre: MarkdownPreOverride }

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
  renderItem: (
    item: ConversationItem,
    tabId: string,
    options?: { autoPermissionDetail?: { decision: 'allow'; reason: string } },
  ) => React.ReactNode
  onPermissionResponse: (toolCallId: string, subflow: string[], response: 'approve' | 'deny') => void | Promise<void>
  onAskHumanResponse: (toolCallId: string, subflow: string[], response: string) => void | Promise<void>
  activeIsWorking: boolean
  activeIsProcessing: boolean
  activeIsReasoning: boolean
}

export function ChatSessionPane({
  tab,
  isActive,
  tabState,
  viewportAnchor,
  onPickPrompt,
  isToolOpenForTab,
  setToolOpenForTab,
  renderItem,
  onPermissionResponse,
  onAskHumanResponse,
  activeIsWorking,
  activeIsProcessing,
  activeIsReasoning,
}: ChatSessionPaneProps) {
  const tabHasConversation = tabState.conversation.length > 0 || tabState.currentAssistantMessage
  const tabConversationContentClassName = tabHasConversation
    ? "mx-auto w-full max-w-4xl pb-28"
    : "mx-auto w-full max-w-4xl min-h-full items-center justify-center pb-0"
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
              onPickPrompt={onPickPrompt}
            />
          ) : (
            <>
              {groupConversationItems(
                tabState.conversation,
                (id) => !!tabState.allPermissionRequests.get(id) || !!tabState.autoPermissionDecisions.get(id)
              ).map(item => {
                if (isToolGroup(item)) {
                  return (
                    <ToolGroupComponent
                      key={item.groupId}
                      group={item}
                      isToolOpen={(toolId) => isToolOpenForTab(tab.id, toolId)}
                      onToolOpenChange={(toolId, open) => setToolOpenForTab(tab.id, toolId, open)}
                    />
                  )
                }
                const autoDecision = isToolCall(item)
                  ? tabState.autoPermissionDecisions.get(item.id)
                  : undefined
                const rendered = renderItem(
                  item,
                  tab.id,
                  autoDecision?.decision === 'allow'
                    ? { autoPermissionDetail: { decision: 'allow', reason: autoDecision.reason } }
                    : undefined,
                )
                if (isToolCall(item)) {
                  const deniedAutoDecision = autoDecision?.decision === 'deny' ? autoDecision : null
                  const permRequest = tabState.allPermissionRequests.get(item.id)
                  if (deniedAutoDecision || permRequest) {
                    const response = tabState.permissionResponses.get(item.id) || null
                    return (
                      <React.Fragment key={item.id}>
                        {deniedAutoDecision && (
                          <AutoPermissionDecision
                            toolCall={deniedAutoDecision.toolCall}
                            permission={deniedAutoDecision.permission}
                            decision={deniedAutoDecision.decision}
                            reason={deniedAutoDecision.reason}
                          />
                        )}
                        {permRequest && (
                          <PermissionRequest
                            toolCall={permRequest.toolCall}
                            permission={permRequest.permission}
                            onApprove={() => onPermissionResponse(permRequest.toolCall.toolCallId, permRequest.subflow, 'approve')}
                            onDeny={() => onPermissionResponse(permRequest.toolCall.toolCallId, permRequest.subflow, 'deny')}
                            isProcessing={isActive && activeIsWorking}
                            response={response}
                          />
                        )}
                        {rendered}
                      </React.Fragment>
                    )
                  }
                }
                return rendered
              })}

              {Array.from(tabState.pendingAskHumanRequests.values()).map((request) => (
                <AskHumanRequest
                  key={request.toolCallId}
                  query={request.query}
                  options={request.options}
                  onResponse={(response) => onAskHumanResponse(request.toolCallId, request.subflow, response)}
                  isProcessing={isActive && activeIsWorking}
                />
              ))}

              {tabState.currentAssistantMessage && (
                <Message from="assistant">
                  <MessageContent>
                    <SmoothStreamingMessage text={tabState.currentAssistantMessage.replace(/<\/?voice>/g, '')} components={streamdownComponents} />
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
  onStop: () => void | Promise<void>
  activeIsProcessing: boolean
  isStopping: boolean
  presetMessage: string | undefined
  onPresetMessageConsumed: () => void
  codeSessionLocks: Record<string, { cwd: string; agent: 'claude' | 'codex' }>
  initialDraft: string | undefined
  onDraftChange: (tabId: string, text: string) => void
  selectedModelByTabRef: React.RefObject<Map<string, { provider: string; model: string }>>
  reasoningEffortByTabRef: React.RefObject<Map<string, 'low' | 'medium' | 'high'>>
  workDirByTab: Record<string, string | null>
  onWorkDirChange: (tabId: string, value: string | null) => void
  isRecording: boolean
  voiceOwner: string | null
  voice: Pick<ReturnType<typeof useVoiceMode>, 'state' | 'interimText' | 'audioLevelsRef'>
  onStartRecording: (holderId: string) => void
  onSubmitRecording: () => void | Promise<void>
  onCancelRecording: () => void
  voiceAvailable: boolean
  inCall: boolean
  onStartCall: (preset: CallPreset) => void
  onEndCall: () => void
  ttsAvailable: boolean
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
  selectedModelByTabRef,
  reasoningEffortByTabRef,
  workDirByTab,
  onWorkDirChange,
  isRecording,
  voiceOwner,
  voice,
  onStartRecording,
  onSubmitRecording,
  onCancelRecording,
  voiceAvailable,
  inCall,
  onStartCall,
  onEndCall,
  ttsAvailable,
}: ChatSessionComposerProps) {
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
        onSelectedModelChange={(m) => {
          if (m) {
            selectedModelByTabRef.current.set(tab.chatId, m)
          } else {
            selectedModelByTabRef.current.delete(tab.chatId)
          }
        }}
        onReasoningEffortChange={(effort) => {
          if (effort) {
            reasoningEffortByTabRef.current.set(tab.chatId, effort)
          } else {
            reasoningEffortByTabRef.current.delete(tab.chatId)
          }
        }}
        workDir={workDirByTab[tab.id] ?? null}
        onWorkDirChange={(v) => onWorkDirChange(tab.id, v)}
        isRecording={isRecording && voiceOwner === tab.chatId}
        recordingText={voiceOwner === tab.chatId ? voice.interimText : undefined}
        recordingState={voiceOwner === tab.chatId ? (voice.state === 'submitting' ? 'stopping' : voice.state === 'connecting' ? 'connecting' : 'listening') : undefined}
        audioLevelsRef={voice.audioLevelsRef}
        onStartRecording={isActive ? () => onStartRecording(tab.chatId) : undefined}
        onSubmitRecording={isActive ? onSubmitRecording : undefined}
        onCancelRecording={isActive ? onCancelRecording : undefined}
        voiceAvailable={isActive && voiceAvailable}
        inCall={inCall}
        onStartCall={isActive ? onStartCall : undefined}
        onEndCall={isActive ? onEndCall : undefined}
        callAvailable={voiceAvailable && ttsAvailable}
      />
    </div>
  )
}
