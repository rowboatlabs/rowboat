import React from 'react'
import { useSmoothedText } from '@/hooks/useSmoothedText'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { ToolGroupComponent } from '@/components/ai-elements/tool'
import { PermissionRequest } from '@/components/ai-elements/permission-request'
import { AskHumanRequest } from '@/components/ai-elements/ask-human-request'
import { AutoPermissionDecision } from '@/components/ai-elements/auto-permission-decision'
import {
  groupConversationItems,
  isToolCall,
  isToolGroup,
  type ChatTabViewState,
  type ConversationItem,
} from '@/lib/chat-conversation'

type StreamdownComponents = React.ComponentProps<typeof MessageResponse>['components']

export type RenderConversationItem = (
  item: ConversationItem,
  tabId: string,
  options?: { autoPermissionDetail?: { decision: 'allow'; reason: string } },
) => React.ReactNode

type Props = {
  tabState: ChatTabViewState
  tabId: string
  // Actively working (model/tools running) → show the "Thinking…" shimmer. The
  // caller folds in "is this the active tab".
  isThinking: boolean
  isToolOpenForTab: (tabId: string, toolId: string) => boolean
  setToolOpenForTab: (tabId: string, toolId: string, open: boolean) => void
  renderItem: RenderConversationItem
  onPermissionResponse: (toolCallId: string, subflow: string[], response: 'approve' | 'deny') => void
  onAskHumanResponse: (toolCallId: string, subflow: string[], response: string) => void
  streamdownComponents: StreamdownComponents
}

// The conversation render, extracted from App.tsx so the main view and the chat
// sidebar share one implementation. Renders grouped tool calls, per-tool
// permission / auto-decision cards, ask-human cards, the live streaming message,
// and the thinking shimmer. Pure presentation: all data + handlers come in via
// props (the per-item rendering itself is supplied as `renderItem`).
export function ChatConversation({
  tabState,
  tabId,
  isThinking,
  isToolOpenForTab,
  setToolOpenForTab,
  renderItem,
  onPermissionResponse,
  onAskHumanResponse,
  streamdownComponents,
}: Props) {
  const smoothAssistant = useSmoothedText(tabState.currentAssistantMessage.replace(/<\/?voice>/g, ''))

  return (
    <>
      {groupConversationItems(
        tabState.conversation,
        (id) => !!tabState.allPermissionRequests.get(id) || !!tabState.autoPermissionDecisions.get(id),
      ).map((item) => {
        if (isToolGroup(item)) {
          return (
            <ToolGroupComponent
              key={item.groupId}
              group={item}
              isToolOpen={(toolId) => isToolOpenForTab(tabId, toolId)}
              onToolOpenChange={(toolId, open) => setToolOpenForTab(tabId, toolId, open)}
            />
          )
        }
        const autoDecision = isToolCall(item) ? tabState.autoPermissionDecisions.get(item.id) : undefined
        const rendered = renderItem(
          item,
          tabId,
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
                    onApproveSession={() => onPermissionResponse(permRequest.toolCall.toolCallId, permRequest.subflow, 'approve')}
                    onApproveAlways={() => onPermissionResponse(permRequest.toolCall.toolCallId, permRequest.subflow, 'approve')}
                    onDeny={() => onPermissionResponse(permRequest.toolCall.toolCallId, permRequest.subflow, 'deny')}
                    isProcessing={false}
                    response={response}
                  />
                )}
                {/* While a permission is pending the tool hasn't run — show only the
                    card, not a misleading running tool block. The tool renders once
                    approved (permRequest clears). */}
                {!permRequest && rendered}
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
          isProcessing={false}
        />
      ))}

      {tabState.currentAssistantMessage && (
        <Message from="assistant">
          <MessageContent>
            <MessageResponse components={streamdownComponents}>{smoothAssistant}</MessageResponse>
          </MessageContent>
        </Message>
      )}

      {isThinking && !tabState.currentAssistantMessage && (
        <Message from="assistant">
          <MessageContent>
            <Shimmer duration={1}>Thinking...</Shimmer>
          </MessageContent>
        </Message>
      )}
    </>
  )
}
