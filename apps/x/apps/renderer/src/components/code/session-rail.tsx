import { FolderGit2, FolderPlus, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import type { CodeSession, CodeSessionStatus } from '@x/shared/src/code-sessions.js'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ProjectRow } from './use-code-sessions'

function StatusDot({ status }: { status: CodeSessionStatus }) {
  if (status === 'needs-you') {
    return <span className="size-2 shrink-0 animate-pulse rounded-full bg-amber-500" title="Needs your attention" />
  }
  if (status === 'working') {
    return <span className="size-2 shrink-0 animate-pulse rounded-full bg-blue-500" title="Working" />
  }
  return <span className="size-2 shrink-0 rounded-full bg-muted-foreground/30" title="Idle" />
}

const AGENT_SHORT: Record<string, string> = { claude: 'Claude', codex: 'Codex' }

// Left rail: registered projects with their sessions, attention-first.
export function SessionRail({
  projects,
  sessions,
  statusOf,
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
  selectedSessionId: string | null
  onSelectSession: (sessionId: string) => void
  onAddProject: () => void
  onRemoveProject: (projectId: string) => void
  onNewSession: (projectId: string) => void
  onDeleteSession: (session: CodeSession) => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Projects</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onAddProject}>
              <FolderPlus className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Add a project folder</TooltipContent>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
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
          return (
            <div key={project.id} className="mb-3">
              <div className="group flex items-center gap-1.5 px-1 py-1">
                {/* Deliberate hover delay — the full path is reference info,
                    not something that should pop up on a passing cursor. */}
                <Tooltip delayDuration={1000}>
                  <TooltipTrigger asChild>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {project.name}
                      </span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[420px] break-all font-mono text-xs">
                    {project.path}
                  </TooltipContent>
                </Tooltip>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 opacity-0 transition-opacity group-hover:opacity-100"
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
                      className="h-6 w-6 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <MoreHorizontal className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => onRemoveProject(project.id)}>
                      <Trash2 className="size-4" />
                      Remove project
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {projectSessions.length === 0 ? (
                <button
                  type="button"
                  onClick={() => onNewSession(project.id)}
                  className="ml-5 flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                >
                  <Plus className="size-3" />
                  New session
                </button>
              ) : (
                projectSessions.map((session) => {
                  const status = statusOf(session.id)
                  return (
                    <div
                      key={session.id}
                      className={cn(
                        'group ml-3 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5',
                        selectedSessionId === session.id ? 'bg-muted' : 'hover:bg-muted/60',
                      )}
                      onClick={() => onSelectSession(session.id)}
                    >
                      <StatusDot status={status} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs">{session.title}</div>
                        <div className="truncate text-[10px] text-muted-foreground">
                          {AGENT_SHORT[session.agent]}
                          {session.mode === 'rowboat' ? ' · Rowboat drives' : ''}
                          {session.worktree && !session.worktree.removedAt ? ' · worktree' : ''}
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 shrink-0 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                            onClick={(e) => e.stopPropagation()}
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
                })
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
