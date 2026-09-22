import { HarnessControls } from '@/components/harness-controls'
import { WorktreeActions } from './worktree-actions'
import { useState } from 'react'
import { Check, Copy, GitBranch } from 'lucide-react'
import type { CodeSession, CodeSessionStatus } from '@x/shared/src/code-sessions.js'
import type { ApprovalPolicy, CodingAgent } from '@x/shared/src/code-mode.js'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { refreshCodeSessions } from './use-code-sessions'
import { CODE_PANELS, type CodePanel } from './code-panels'
export interface CodeSessionHeaderProps {
  session: CodeSession
  status: CodeSessionStatus
  panel: CodePanel | null
  onTogglePanel: (panel: CodePanel) => void
}

type SessionPatch = { clearPolicy?: boolean; codeModeEnabled?: boolean; agent?: CodingAgent; policy?: ApprovalPolicy; agentModel?: string; agentEffort?: string }

function StatusPill({ status }: { status: CodeSessionStatus }) {
  if (status === 'idle') return null
  const working = status === 'working'
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
        working
          ? 'bg-[color-mix(in_oklab,var(--rowboat-git)_12%,transparent)] text-[var(--rowboat-git)]'
          : 'bg-[color-mix(in_oklab,var(--rowboat-attention)_12%,transparent)] text-[var(--rowboat-attention)]',
      )}
    >
      <span className={cn('size-1.5 rounded-full bg-current', !working && 'animate-pulse')} />
      {working ? 'Working' : 'Needs you'}
    </span>
  )
}

// Branch chip for a session working in an isolated worktree. Hovering reveals
// a copy button so the worktree path can be pasted into a terminal or editor
// without hunting for it.
function WorktreeChip({ branch, path }: { branch: string; path: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(path)
      setCopied(true)
      toast.success('Worktree path copied')
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      toast.error('Could not copy the path')
    }
  }
  return (
    <span
      className="group/wt hidden max-w-56 shrink items-center gap-1 rounded-full bg-muted py-0.5 pl-2 pr-1 text-[11px] text-muted-foreground @[520px]:flex"
    >
      <GitBranch className="size-3 shrink-0" />
      <span className="truncate" title={`${branch}\n${path}`}>{branch}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => void copy()}
            aria-label="Copy worktree path"
            className={cn(
              'flex size-4 shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/wt:opacity-100',
              copied && 'opacity-100 text-[var(--rowboat-git)]',
            )}
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{copied ? 'Copied' : 'Copy worktree path'}</TooltipContent>
      </Tooltip>
    </span>
  )
}

// Project session controls live beside the composer; session identity remains
// in the header below. Turning Harness off leaves the thread and workspace intact.
export function CodeSessionControls({ session, panel, onTogglePanel }: CodeSessionHeaderProps) {
  const update = async (patch: SessionPatch) => {
    try {
      await window.ipc.invoke('codeSession:update', { sessionId: session.id, patch })
      await refreshCodeSessions()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to update session') }
  }

  const setDone = async (done: boolean) => {
    try {
      await window.ipc.invoke('codeSession:setDone', { sessionId: session.id, done })
      await refreshCodeSessions()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update session')
    }
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 py-2 @container">
      <HarnessControls value={{ enabled: session.codeModeEnabled !== false, agent: session.agent, model: session.agentModel, effort: session.agentEffort, policy: session.policy }}
        onChange={(value) => update({ codeModeEnabled: value.enabled, agent: value.agent, agentModel: value.model ?? 'default', agentEffort: value.effort ?? 'default', ...(value.policy ? { policy: value.policy } : { clearPolicy: true }) })} />
      {session.codeModeEnabled !== false && <>
      {/* Doors to the workspace drawer. Clicking the open one closes it. */}
      {CODE_PANELS.map(({ id, label, icon: Icon }) => {
        const active = panel === id
        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onTogglePanel(id)}
                aria-pressed={active}
                aria-label={label}
                className={cn(
                  'flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                  active && 'bg-accent text-foreground',
                )}
              >
                <Icon className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{active ? `Hide ${label.toLowerCase()}` : label}</TooltipContent>
          </Tooltip>
        )
      })}
      </>}
      <WorktreeActions session={session} />
      <Button variant="ghost" size="sm"
        className={cn('h-7 shrink-0 gap-1 text-xs text-muted-foreground hover:text-foreground', session.codeModeEnabled !== false && 'ml-auto')}
        onClick={() => void setDone(!session.doneAt)}>{session.doneAt ? 'Reopen' : 'Mark as done'}</Button>
    </div>
  )
}

// The header keeps identity only; agent controls live beside the composer.
export function CodeSessionHeader({ session, status }: CodeSessionHeaderProps) {
  return <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
    <span className="min-w-0 truncate text-sm font-medium">{session.title}</span>
    <StatusPill status={status} />
    {session.worktree && !session.worktree.removedAt && <WorktreeChip branch={session.worktree.branch} path={session.cwd} />}
  </div>
}
