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
  MessageCopyButton,
  MessageResponse,
} from '@/components/ai-elements/message'
import {
  type PromptInputMessage,
  type FileMention,
} from '@/components/ai-elements/prompt-input'
import { Tool, ToolContent, ToolGroupComponent, ToolHeader, ToolTabbedContent } from '@/components/ai-elements/tool'
import { PermissionRequest } from '@/components/ai-elements/permission-request'
import { AutoPermissionDecision } from '@/components/ai-elements/auto-permission-decision'
import { AskHumanRequest } from '@/components/ai-elements/ask-human-request'
import { TurnActivityIndicator } from '@/components/turn-activity-indicator'
import { WebSearchResult } from '@/components/ai-elements/web-search-result'
import { AppActionCard } from '@/components/ai-elements/app-action-card'
import { ComposioConnectCard } from '@/components/ai-elements/composio-connect-card'
import { CodingRunBlock } from '@/components/coding-run'
import { SubAgentBlock } from '@/components/sub-agent-block'
import { TerminalOutput } from '@/components/terminal-output'
import { ChatMessageAttachments } from '@/components/chat-message-attachments'
import { BillingErrorNotice } from '@/components/billing-error-notice'
import { TokenUsageMenu } from '@/components/token-usage-menu'
import { matchBillingError } from '@/lib/billing-error'
import { wikiLabel } from '@/lib/wiki-links'
import { streamdownComponents, userMessageRemarkPlugins } from '@/lib/markdown-render'
import { useSmoothedText } from '@/hooks/useSmoothedText'
import type { useVoiceMode } from '@/hooks/useVoiceMode'
import type { PermissionDecision } from '@x/shared/src/code-mode.js'
import { ChatEmptyState } from './chat-empty-state'
import { ChatInputWithMentions, type CallPreset, type PermissionMode, type StagedAttachment, type SelectedModel, type ReasoningEffortLevel } from './chat-input-with-mentions'
import { type ChatTab } from './tab-bar'
import { useReportTabMeta } from '@/lib/tab-meta'
import { useSessionTitle } from '@/lib/session-title'
import {
  type ChatTabViewState,
  type ChatViewportAnchorState,
  type ConversationItem,
  getAppActionCardData,
  getComposioConnectCardData,
  getToolDisplayName,
  getToolErrorText,
  getWebSearchCardData,
  groupConversationItems,
  isChatMessage,
  isErrorMessage,
  isToolCall,
  isToolGroup,
  isTurnUsageMessage,
  normalizeToolInput,
  normalizeToolOutput,
  parseAttachedFiles,
  REASONING_EFFORT_LABELS,
  toToolState,
} from '@/lib/chat-conversation'

function SmoothStreamingMessage({ text, components }: { text: string; components: typeof streamdownComponents }) {
  const smoothText = useSmoothedText(text)
  return <MessageResponse components={components}>{smoothText}</MessageResponse>
}

function AutoScrollPre({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = React.useRef<HTMLPreElement>(null)
  const stickToBottom = React.useRef(true)

  React.useLayoutEffect(() => {
    const el = ref.current
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [children])

  const handleScroll = React.useCallback(() => {
    const el = ref.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    stickToBottom.current = atBottom
  }, [])

  return (
    <pre ref={ref} onScroll={handleScroll} className={className}>
      {children}
    </pre>
  )
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

  const renderConversationItem = (
    item: ConversationItem,
    options?: { autoPermissionDetail?: { decision: 'allow'; reason: string } },
  ): React.ReactNode => {
    if (isChatMessage(item)) {
      if (item.role === 'user') {
        if (item.attachments && item.attachments.length > 0) {
          return (
            <Message key={item.id} from={item.role} data-message-id={item.id}>
              <MessageContent className="group-[.is-user]:bg-transparent group-[.is-user]:px-0 group-[.is-user]:py-0 group-[.is-user]:rounded-none">
                <ChatMessageAttachments attachments={item.attachments} />
              </MessageContent>
              {item.content && (
                <div className="flex flex-col items-end">
                  <MessageContent>
                    <MessageResponse
                      components={streamdownComponents}
                      remarkPlugins={userMessageRemarkPlugins}
                    >
                      {item.content}
                    </MessageResponse>
                  </MessageContent>
                  <MessageCopyButton text={item.content} className="mt-0.5" />
                </div>
              )}
            </Message>
          )
        }
        const { message, files } = parseAttachedFiles(item.content)
        return (
          <Message key={item.id} from={item.role} data-message-id={item.id}>
            <div className="flex flex-col items-end">
              <MessageContent>
                {files.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {files.map((filePath, index) => (
                      <span
                        key={index}
                        className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                      >
                        @{wikiLabel(filePath)}
                      </span>
                    ))}
                  </div>
                )}
                <MessageResponse
                  components={streamdownComponents}
                  remarkPlugins={userMessageRemarkPlugins}
                >
                  {message}
                </MessageResponse>
              </MessageContent>
              <MessageCopyButton text={message} className="mt-0.5" />
            </div>
          </Message>
        )
      }
      return (
        <Message key={item.id} from={item.role} data-message-id={item.id}>
          <MessageContent>
            <MessageResponse components={streamdownComponents}>{item.content}</MessageResponse>
          </MessageContent>
        </Message>
      )
    }

    if (isToolCall(item)) {
      if (richToolCards) {
        if (item.name === 'code_agent_run') {
          return (
            <CodingRunBlock
              key={item.id}
              item={item}
              open={isToolOpenForTab(tab.id, item.id)}
              onOpenChange={(open) => setToolOpenForTab(tab.id, item.id, open)}
              onPermissionDecision={(decision) => {
                if (item.pendingCodePermission) {
                  onCodePermissionResponse?.(item.id, item.pendingCodePermission.requestId, decision)
                }
              }}
            />
          )
        }
        if (item.name === 'spawn-agent') {
          return (
            <SubAgentBlock
              key={item.id}
              item={item}
              open={isToolOpenForTab(tab.id, item.id)}
              onOpenChange={(open) => setToolOpenForTab(tab.id, item.id, open)}
            />
          )
        }
        const appActionData = getAppActionCardData(item)
        if (appActionData) {
          return <AppActionCard key={item.id} data={appActionData} status={item.status} />
        }
      }
      const webSearchData = getWebSearchCardData(item)
      if (webSearchData) {
        return (
          <WebSearchResult
            key={item.id}
            query={webSearchData.query}
            results={webSearchData.results}
            status={item.status}
            title={webSearchData.title}
          />
        )
      }
      const composioConnectData = getComposioConnectCardData(item)
      if (composioConnectData) {
        // Skip rendering if this is a duplicate "already connected" card
        if (composioConnectData.hidden) return null
        return (
          <ComposioConnectCard
            key={item.id}
            toolkitSlug={composioConnectData.toolkitSlug}
            toolkitDisplayName={composioConnectData.toolkitDisplayName}
            status={item.status}
            alreadyConnected={composioConnectData.alreadyConnected}
            onConnected={onComposioConnected}
          />
        )
      }
      const toolTitle = getToolDisplayName(item)
      const errorText = detailedToolErrors
        ? getToolErrorText(item)
        : (item.status === 'error' ? 'Tool error' : '')
      const output = normalizeToolOutput(item.result, item.status)
      const input = normalizeToolInput(item.input)
      return (
        <Tool
          key={item.id}
          open={isToolOpenForTab(tab.id, item.id)}
          onOpenChange={(open) => setToolOpenForTab(tab.id, item.id, open)}
          autoPermissionDetail={options?.autoPermissionDetail}
        >
          <ToolHeader title={toolTitle} type={`tool-${item.name}`} state={toToolState(item.status)} />
          <ToolContent>
            {item.streamingOutput ? (
              <AutoScrollPre className="max-h-80 overflow-auto px-4 py-3 font-mono text-xs whitespace-pre-wrap text-foreground/90">
                <TerminalOutput raw={item.streamingOutput} />
              </AutoScrollPre>
            ) : (
              <ToolTabbedContent input={input} output={output} errorText={errorText} />
            )}
          </ToolContent>
        </Tool>
      )
    }

    if (isTurnUsageMessage(item)) {
      return (
        <div key={item.id} className="-mt-6 -ml-1 flex items-center justify-start gap-1" data-message-id={item.id}>
          <TokenUsageMenu
            usage={item.usage}
            scope="turn"
            modelCallCount={item.modelCallCount}
            align="start"
          />
          {item.reasoningEffort && (
            <span className="text-xs text-muted-foreground/70">
              {REASONING_EFFORT_LABELS[item.reasoningEffort]}
            </span>
          )}
        </div>
      )
    }

    if (isErrorMessage(item)) {
      const billingMatch = matchBillingError(item.message)
      if (billingMatch) {
        return <BillingErrorNotice key={item.id} id={item.id} match={billingMatch} />
      }
      return (
        <Message key={item.id} from="assistant" data-message-id={item.id}>
          <MessageContent className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive">
            <pre className="whitespace-pre-wrap font-mono text-xs">{item.message}</pre>
          </MessageContent>
        </Message>
      )
    }

    return null
  }

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
                const rendered = renderConversationItem(
                  item,
                  autoDecision?.decision === 'allow'
                    ? { autoPermissionDetail: { decision: 'allow', reason: autoDecision.reason } }
                    : undefined,
                )
                if (isToolCall(item)) {
                  const deniedAutoDecision = autoDecision?.decision === 'deny' ? autoDecision : null
                  const permRequest = tabState.allPermissionRequests.get(item.id)
                  if (deniedAutoDecision || (permRequest && onPermissionResponse)) {
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
                        {permRequest && onPermissionResponse && (
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
  /** Ref-style model tracking keyed by chatId (App). Either this or onSelectedModelChange. */
  selectedModelByTabRef?: React.RefObject<Map<string, { provider: string; model: string }>>
  /** Ref-style effort tracking keyed by chatId (App). Either this or onReasoningEffortChange. */
  reasoningEffortByTabRef?: React.RefObject<Map<string, 'low' | 'medium' | 'high'>>
  /** Callback-style model reporting (side-pane chat); receives the tab so the caller picks its key. */
  onSelectedModelChange?: (tab: ChatTab, model: SelectedModel | null) => void
  /** Callback-style effort reporting (side-pane chat). */
  onReasoningEffortChange?: (tab: ChatTab, effort: ReasoningEffortLevel | null) => void
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
  selectedModelByTabRef,
  reasoningEffortByTabRef,
  onSelectedModelChange,
  onReasoningEffortChange,
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
        onSelectedModelChange={(m) => {
          if (selectedModelByTabRef) {
            if (m) {
              selectedModelByTabRef.current.set(tab.chatId, m)
            } else {
              selectedModelByTabRef.current.delete(tab.chatId)
            }
          }
          onSelectedModelChange?.(tab, m)
        }}
        onReasoningEffortChange={(effort) => {
          if (reasoningEffortByTabRef) {
            if (effort) {
              reasoningEffortByTabRef.current.set(tab.chatId, effort)
            } else {
              reasoningEffortByTabRef.current.delete(tab.chatId)
            }
          }
          onReasoningEffortChange?.(tab, effort)
        }}
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
