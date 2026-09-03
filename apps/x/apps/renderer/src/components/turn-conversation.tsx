import * as React from 'react'
import { cn } from '@/lib/utils'
import {
  Message,
  MessageContent,
  MessageCopyButton,
  MessageResponse,
} from '@/components/ai-elements/message'
import { Tool, ToolContent, ToolGroupComponent, ToolHeader, ToolIODetails } from '@/components/ai-elements/tool'
import { ReasoningRow } from '@/components/reasoning-row'
import { PermissionRequest } from '@/components/ai-elements/permission-request'
import { AutoPermissionDecision } from '@/components/ai-elements/auto-permission-decision'
import { WebSearchResult } from '@/components/ai-elements/web-search-result'
import { AppActionCard } from '@/components/ai-elements/app-action-card'
import { ComposioConnectCard } from '@/components/ai-elements/composio-connect-card'
import { AskHumanSettled } from '@/components/ai-elements/ask-human-request'
import { CodingRunBlock } from '@/components/coding-run'
import { SubAgentBlock } from '@/components/sub-agent-block'
import { TerminalOutput } from '@/components/terminal-output'
import { ChatMessageAttachments } from '@/components/chat-message-attachments'
import { BillingErrorNotice } from '@/components/billing-error-notice'
import { TokenUsageMenu } from '@/components/token-usage-menu'
import { matchBillingError } from '@/lib/billing-error'
import { wikiLabel } from '@/lib/wiki-links'
import { streamdownComponents, userMessageRemarkPlugins } from '@/lib/markdown-render'
import type { PermissionDecision } from '@x/shared/src/code-mode.js'
import {
  type ChatTabViewState,
  type ConversationItem,
  getAppActionCardData,
  getAskHumanCardData,
  getComposioConnectCardData,
  getToolErrorText,
  getToolRowSummary,
  getWebSearchCardData,
  groupConversationItems,
  isChatMessage,
  isErrorMessage,
  isReasoningMessage,
  isToolCall,
  isToolGroup,
  isTurnUsageMessage,
  normalizeToolInput,
  normalizeToolOutput,
  parseAttachedFiles,
  REASONING_EFFORT_LABELS,
  toToolState,
} from '@/lib/chat-conversation'

/**
 * The one shared renderer for a conversation's items — user/assistant
 * messages, tool rows (quiet rows, rich cards, groups), the hover-revealed
 * per-turn usage footer, and error banners. Every surface that shows a turn
 * or chat transcript renders through this component so they stay pixel- and
 * behavior-identical: the full-screen chat and side-pane chat (via
 * ChatSessionPane), the sub-agent block's nested child turn, the bg-task
 * "Runs history" drill-down, and the live-note "Last run" tab.
 *
 * Live-chat wiring (permission cards, code-run permission asks, tool open
 * state lifted to the tab store) is optional: read-only transcript surfaces
 * pass just `items` and get self-contained collapsible tool rows.
 */

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

const EMPTY_PERMISSION_REQUESTS: ChatTabViewState['allPermissionRequests'] = new Map()
const EMPTY_PERMISSION_RESPONSES: ChatTabViewState['permissionResponses'] = new Map()
const EMPTY_AUTO_DECISIONS: ChatTabViewState['autoPermissionDecisions'] = new Map()

export interface TurnConversationProps {
  items: ConversationItem[]
  /**
   * Tool-row open state. Chat panes lift this to the tab store so it survives
   * tab switches; omit both for local per-mount state (transcript surfaces).
   * Return `undefined` for "no explicit user choice" — the renderer then
   * applies the per-tool default (coding runs open, everything else closed).
   */
  isToolOpen?: (toolId: string) => boolean | undefined
  onToolOpenChange?: (toolId: string, open: boolean) => void
  /** Live-chat permission state (from ChatTabViewState); omitted on read-only surfaces. */
  permissionRequests?: ChatTabViewState['allPermissionRequests']
  permissionResponses?: ChatTabViewState['permissionResponses']
  autoPermissionDecisions?: ChatTabViewState['autoPermissionDecisions']
  /** Without it, pending permission requests render no approve/deny card. */
  onPermissionResponse?: (toolCallId: string, subflow: string[], response: 'approve' | 'deny') => void | Promise<void>
  /** Disables the permission card's buttons while the turn is working. */
  permissionIsProcessing?: boolean
  /** Answer a mid-run permission ask from a `code_agent_run` coding turn. */
  onCodePermissionResponse?: (toolCallId: string, requestId: string, decision: PermissionDecision) => void | Promise<void>
  /** Notified when a ComposioConnectCard finishes connecting a toolkit. */
  onComposioConnected?: (toolkitSlug: string) => void
  className?: string
}

export function TurnConversation({
  items,
  isToolOpen: isToolOpenProp,
  onToolOpenChange: onToolOpenChangeProp,
  permissionRequests = EMPTY_PERMISSION_REQUESTS,
  permissionResponses = EMPTY_PERMISSION_RESPONSES,
  autoPermissionDecisions = EMPTY_AUTO_DECISIONS,
  onPermissionResponse,
  permissionIsProcessing = false,
  onCodePermissionResponse,
  onComposioConnected,
  className,
}: TurnConversationProps) {
  // Local fallback open state for surfaces that don't lift it. A Map (not a
  // Set) so "never toggled" stays distinct from an explicit collapse — the
  // per-tool default below only applies while there's no explicit choice.
  const [localOpenTools, setLocalOpenTools] = React.useState<ReadonlyMap<string, boolean>>(() => new Map())
  const isToolOpenExplicit = isToolOpenProp ?? ((toolId: string) => localOpenTools.get(toolId))
  // Explicit user choice wins; otherwise coding-run cards default open (the
  // run card is the primary output surface) and everything else stays closed.
  const isToolOpen = (toolId: string, defaultOpen = false) => isToolOpenExplicit(toolId) ?? defaultOpen
  const onToolOpenChange =
    onToolOpenChangeProp ??
    ((toolId: string, open: boolean) => {
      setLocalOpenTools((prev) => {
        const next = new Map(prev)
        next.set(toolId, open)
        return next
      })
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

    if (isReasoningMessage(item)) {
      // Settled thoughts start collapsed; the live streaming row in
      // ChatSessionPane is what shows reasoning expanded while it happens.
      return <ReasoningRow key={item.id} content={item.content} />
    }

    if (isToolCall(item)) {
      if (item.name === 'code_agent_run') {
        return (
          <CodingRunBlock
            key={item.id}
            item={item}
            open={isToolOpen(item.id, true)}
            onOpenChange={(open) => onToolOpenChange(item.id, open)}
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
            open={isToolOpen(item.id)}
            onOpenChange={(open) => onToolOpenChange(item.id, open)}
          />
        )
      }
      const askHumanData = getAskHumanCardData(item)
      if (askHumanData) {
        // Pending: the interactive card (mounted by the pane below the
        // conversation) is the question's representation — a transcript row
        // here would duplicate it. Settled (answered/skipped/cancelled):
        // compact question → answer block.
        if (askHumanData.answer === null) return null
        return (
          <AskHumanSettled
            key={item.id}
            question={askHumanData.question}
            answer={askHumanData.answer}
            skipped={askHumanData.skipped}
            isError={item.status === 'error'}
          />
        )
      }
      const appActionData = getAppActionCardData(item)
      if (appActionData) {
        return <AppActionCard key={item.id} data={appActionData} status={item.status} />
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
      const errorText = getToolErrorText(item)
      const output = normalizeToolOutput(item.result, item.status)
      const input = normalizeToolInput(item.input)
      return (
        <Tool
          key={item.id}
          open={isToolOpen(item.id)}
          onOpenChange={(open) => onToolOpenChange(item.id, open)}
        >
          <ToolHeader
            summary={getToolRowSummary(item)}
            type={`tool-${item.name}`}
            state={toToolState(item.status)}
            autoApproved={options?.autoPermissionDetail}
            errorLine={getToolErrorText(item)?.split('\n')[0]}
          />
          <ToolContent>
            {item.streamingOutput ? (
              <AutoScrollPre className="max-h-80 overflow-auto py-1 font-mono text-xs whitespace-pre-wrap text-foreground/90">
                <TerminalOutput raw={item.streamingOutput} />
              </AutoScrollPre>
            ) : (
              <ToolIODetails input={input} output={output} errorText={errorText} />
            )}
          </ToolContent>
        </Tool>
      )
    }

    if (isTurnUsageMessage(item)) {
      // Right-aligned, hover-revealed footer for the turn (see the
      // [data-turn-usage] rules in App.css: shown when the row itself or the
      // element just above it is hovered, or while the menu is open). The
      // menu sits last so per-turn actions (copy) slot in before it.
      // The copy target is the turn's final assistant message — the last one
      // before this usage marker — copied verbatim, no transformation.
      const usageIndex = items.findIndex((entry) => entry.id === item.id)
      const finalOutput = items
        .slice(0, usageIndex === -1 ? undefined : usageIndex)
        .reduceRight<string | null>(
          (found, entry) => found ?? (isChatMessage(entry) && entry.role === 'assistant' ? entry.content : null),
          null,
        )
      return (
        <div
          key={item.id}
          className="-mt-6 -mr-1 flex items-center justify-end gap-1"
          data-turn-usage
          data-message-id={item.id}
        >
          {item.reasoningEffort && (
            <span className="text-xs text-muted-foreground/70">
              {REASONING_EFFORT_LABELS[item.reasoningEffort]}
            </span>
          )}
          {finalOutput && <MessageCopyButton text={finalOutput} className="opacity-100" />}
          <TokenUsageMenu
            usage={item.usage}
            scope="turn"
            modelCallCount={item.modelCallCount}
            align="end"
          />
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

  return (
    <div className={cn('flex w-full flex-col gap-8', className)}>
      {groupConversationItems(
        items,
        // Only an interactive permission card (ask or denial) breaks a
        // tool out of a group — auto-approved calls group fine, since
        // their approval renders as a shield glyph on the row itself.
        (id) => !!permissionRequests.get(id) || autoPermissionDecisions.get(id)?.decision === 'deny'
      ).map(item => {
        if (isToolGroup(item)) {
          return (
            <ToolGroupComponent
              key={item.groupId}
              group={item}
              isToolOpen={isToolOpen}
              onToolOpenChange={onToolOpenChange}
              getAutoApproved={(toolId) => {
                const decision = autoPermissionDecisions.get(toolId)
                return decision?.decision === 'allow' ? { reason: decision.reason } : undefined
              }}
            />
          )
        }
        const autoDecision = isToolCall(item)
          ? autoPermissionDecisions.get(item.id)
          : undefined
        const rendered = renderConversationItem(
          item,
          autoDecision?.decision === 'allow'
            ? { autoPermissionDetail: { decision: 'allow', reason: autoDecision.reason } }
            : undefined,
        )
        if (isToolCall(item)) {
          const deniedAutoDecision = autoDecision?.decision === 'deny' ? autoDecision : null
          const permRequest = permissionRequests.get(item.id)
          if (deniedAutoDecision || (permRequest && onPermissionResponse)) {
            const response = permissionResponses.get(item.id) || null
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
                    isProcessing={permissionIsProcessing}
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
    </div>
  )
}
