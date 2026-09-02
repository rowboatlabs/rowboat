import { useState } from 'react'
import { ChevronDown, ChevronRight, FolderGit2, FolderPlus, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import type { CodeSession, CodeSessionStatus } from '@x/shared/src/code-sessions.js'
import type { CodingAgent } from '@x/shared/src/code-mode.js'
import { cn, compactPath, parentPath } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/relative-time'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ProjectRow } from './use-code-sessions'
import { AGENT_LABEL, isAgentReady, type CodeAgentsStatus } from './code-agent-status'

export const CODE_RAIL_WIDTH = 272

// Inline status prefix: a dot plus a word, only when there is something to
// say. Idle rows carry no prefix so the list stays quiet.
function StatusPrefix({ status }: { status: CodeSessionStatus }) {
  if (status === 'working') {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-[var(--rowboat-git)]">
        <span className="size-1.5 rounded-full bg-current" />
        Working
      </span>
    )
  }
  if (status === 'needs-you') {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-[var(--rowboat-attention)]">
        <span className="size-1.5 animate-pulse rounded-full bg-current" />
        Needs you
      </span>
    )
  }
  return null
}

// Left rail of the Code section: registered projects with their sessions,
// attention-first. The session that is currently working wears an orbiting
// outline (see `.code-working-outline` in App.css) so it can be found at a
// glance even when it is not the selected one.
export function SessionRail({
  projects,
  sessions,
  statusOf,
  agentsStatus,
  selectedSessionId,
  onSelectSession,
  onAddProject,
  onRemoveProject,
  onNewSession,
  onDeleteSession,
}: {
  projects: ProjectRow[]
  sessions: CodeSession[]
  statusOf: (sessionId: string) => CodeSessionStatus
  // Null while the probe is still running — entries stay enabled until known.
  agentsStatus: CodeAgentsStatus | null
  selectedSessionId: string | null
  onSelectSession: (sessionId: string) => void
  onAddProject: () => void
  onRemoveProject: (projectId: string) => void
  // No agent = the default (last used, whichever is ready).
  onNewSession: (projectId: string, agent?: CodingAgent) => void
  onDeleteSession: (session: CodeSession) => void
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const toggleCollapsed = (projectId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--rowboat-panel-soft)]">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border pl-3 pr-1.5">
        <span className="text-[13px] text-muted-foreground">Projects</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground" onClick={onAddProject}>
              <FolderPlus className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Add a project folder</TooltipContent>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {projects.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-3 py-10 text-center">
            <FolderGit2 className="size-8 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">
              Add a project folder to start running coding agents on it.
            </p>
            <Button size="sm" variant="outline" onClick={onAddProject}>
              <FolderPlus className="size-3.5" />
              Add project
            </Button>
          </div>
        )}
        {projects.map(({ project }) => {
          const projectSessions = sessions.filter((s) => s.projectId === project.id)
          const isCollapsed = collapsed.has(project.id)
          // A collapsed group still surfaces its live sessions — attention
          // must not hide behind a chevron.
          const visibleSessions = isCollapsed
            ? projectSessions.filter((s) => statusOf(s.id) !== 'idle' || s.id === selectedSessionId)
            : projectSessions
          return (
            <div key={project.id} className="mb-2">
              <div className="group flex h-8 items-center gap-1 rounded-lg pl-1 pr-1 hover:bg-accent/60">
                <button
                  type="button"
                  onClick={() => toggleCollapsed(project.id)}
                  className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:text-foreground"
                  aria-label={isCollapsed ? 'Expand project' : 'Collapse project'}
                >
                  {isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                </button>
                {/* Deliberate hover delay — the full path is reference info,
                    not something that should pop up on a passing cursor. */}
                <Tooltip delayDuration={1000}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => toggleCollapsed(project.id)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                      <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                        {project.name}
                        {/* Where it lives — same-named repos in different
                            parents stay tellable-apart at a glance. */}
                        {parentPath(project.path) && (
                          <span className="ml-1.5 font-normal text-muted-foreground/60">
                            {compactPath(parentPath(project.path), 22)}
                          </span>
                        )}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[420px] break-all font-mono text-xs">
                    {project.path}
                  </TooltipContent>
                </Tooltip>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 shrink-0 p-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => onNewSession(project.id)}
                  title="New session"
                >
                  <Plus className="size-3.5" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 shrink-0 p-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                    >
                      <MoreHorizontal className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => onNewSession(project.id)}>
                      <Plus className="size-4" />
                      New session
                    </DropdownMenuItem>
                    {/* The explicit picks — the plain entry (and the + button)
                        take the agent you last worked with. */}
                    {(['claude', 'codex'] as CodingAgent[]).map((agent) => (
                      <DropdownMenuItem
                        key={agent}
                        disabled={agentsStatus !== null && !isAgentReady(agentsStatus, agent)}
                        onClick={() => onNewSession(project.id, agent)}
                      >
                        <span className="size-4" />
                        New {AGENT_LABEL[agent]} session
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onRemoveProject(project.id)}>
                      <Trash2 className="size-4" />
                      Remove project
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {!isCollapsed && projectSessions.length === 0 && (
                <button
                  type="button"
                  onClick={() => onNewSession(project.id)}
                  className="ml-6 flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                >
                  <Plus className="size-3" />
                  New session
                </button>
              )}
              {visibleSessions.map((session) => {
                const status = statusOf(session.id)
                const selected = selectedSessionId === session.id
                const worktree = session.worktree && !session.worktree.removedAt
                const when = formatRelativeTime(session.lastActivityAt ?? session.createdAt)
                return (
                  <div
                    key={session.id}
                    role="button"
                    tabIndex={0}
                    title={`${session.title}\n${AGENT_LABEL[session.agent] ?? session.agent}${worktree ? ` · ${session.worktree?.branch}` : ''}`}
                    className={cn(
                      'group relative ml-3 mt-0.5 flex h-8 cursor-pointer items-center gap-2 rounded-lg pl-2 pr-1.5',
                      selected ? 'bg-accent text-foreground' : 'hover:bg-accent/60',
                      status === 'working' && 'code-working-outline',
                    )}
                    onClick={() => onSelectSession(session.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelectSession(session.id)
                      }
                    }}
                  >
                    <StatusPrefix status={status} />
                    <span className={cn('min-w-0 flex-1 truncate text-[13px]', selected ? 'font-medium' : 'text-foreground/90')}>
                      {session.title}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70 transition-opacity group-hover:opacity-0">
                      {when}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="absolute right-1 h-6 w-6 shrink-0 p-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Session actions"
                        >
                          <MoreHorizontal className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onClick={() => onDeleteSession(session)}>
                          <Trash2 className="size-4" />
                          Delete session
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
