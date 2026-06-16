import { type ReactNode } from 'react'
import type { PendingApproval } from '@x/shared/dist/approvals.js'
import type { PermissionDecision } from '@x/shared/dist/code-mode.js'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PermissionRequest } from '@/components/ai-elements/permission-request'
import { CodeRunPermissionRequest } from '@/components/coding-run'
import { usePendingApprovals, dismissApprovalOptimistic } from '@/hooks/use-pending-approvals'

// Popover listing permission asks from headless background-task runs. Answers
// go through the same IPC channels as the in-chat cards; main's approvals
// store sees the resolution and re-broadcasts the snapshot.

async function answerToolApproval(
  approval: Extract<PendingApproval, { kind: 'tool' }>,
  response: 'approve' | 'deny',
  scope?: 'once' | 'session' | 'always',
) {
  dismissApprovalOptimistic(approval)
  try {
    await window.ipc.invoke('runs:authorizePermission', {
      runId: approval.runId,
      authorization: {
        subflow: approval.subflow,
        toolCallId: approval.toolCallId,
        response,
        scope,
      },
    })
  } catch (error) {
    console.error('Failed to authorize background-task permission:', error)
  }
}

async function answerCodeApproval(
  approval: Extract<PendingApproval, { kind: 'code' }>,
  decision: PermissionDecision,
) {
  dismissApprovalOptimistic(approval)
  try {
    await window.ipc.invoke('codeRun:resolvePermission', {
      requestId: approval.requestId,
      decision,
    })
  } catch (error) {
    console.error('Failed to resolve background-task code permission:', error)
  }
}

function ApprovalCard({ approval, onOpenTask }: {
  approval: PendingApproval
  onOpenTask?: (slug: string) => void
}) {
  return (
    <div className="space-y-1">
      <button
        type="button"
        className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
        onClick={() => onOpenTask?.(approval.slug)}
        title="Open task"
      >
        {approval.taskName}
      </button>
      {approval.kind === 'tool' ? (
        <PermissionRequest
          className="mb-0"
          toolCall={approval.toolCall}
          permission={approval.permission}
          onApprove={() => void answerToolApproval(approval, 'approve', 'once')}
          onApproveSession={() => void answerToolApproval(approval, 'approve', 'session')}
          onApproveAlways={() => void answerToolApproval(approval, 'approve', 'always')}
          onDeny={() => void answerToolApproval(approval, 'deny')}
        />
      ) : (
        <CodeRunPermissionRequest
          ask={approval.ask}
          onDecide={(decision) => void answerCodeApproval(approval, decision)}
        />
      )}
    </div>
  )
}

export function PendingApprovalsPopover({ trigger, onOpenTask }: {
  trigger: ReactNode
  onOpenTask?: (slug: string) => void
}) {
  const approvals = usePendingApprovals()

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-96 max-h-[70vh] overflow-y-auto p-3">
        <div className="mb-2 text-sm font-semibold text-foreground">
          Waiting on you
        </div>
        {approvals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending approvals.</p>
        ) : (
          <div className="space-y-3">
            {approvals.map((approval) => (
              <ApprovalCard
                key={approval.kind === 'code' ? approval.requestId : `${approval.runId}-${approval.toolCallId}`}
                approval={approval}
                onOpenTask={onOpenTask}
              />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
