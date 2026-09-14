import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { codeWorkspaceKey, type CodeSession } from '@x/shared/src/code-sessions.js'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCodeSessions } from './use-code-sessions'

export function WorkspaceSessionTabs({ session, onSelect }: { session: CodeSession; onSelect: (id: string) => void }) {
  const { sessions, statusOf, refresh } = useCodeSessions()
  const creatingRef = useRef(false)
  const [creating, setCreating] = useState(false)
  const members = sessions.filter((s) => codeWorkspaceKey(s) === codeWorkspaceKey(session))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const create = async () => {
    if (creatingRef.current) return
    creatingRef.current = true
    setCreating(true)
    try {
      const result = await window.ipc.invoke('codeSession:create', {
        projectId: session.projectId, agent: session.agent,
        isolation: session.worktree ? 'worktree' : 'in-repo', workspaceSessionId: session.id,
        ...(session.agentModel ? { agentModel: session.agentModel } : {}),
        ...(session.agentEffort ? { agentEffort: session.agentEffort } : {}),
      })
      await refresh()
      onSelect(result.session.id)
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to create session') }
    finally { creatingRef.current = false; setCreating(false) }
  }
  return <div className="flex h-9 min-w-0 shrink-0 border-b border-border">
    <div role="tablist" aria-label="Worktree sessions" className="flex min-w-0 flex-1 overflow-x-auto">
      {members.map((member) => <button key={member.id} type="button" role="tab" aria-selected={member.id === session.id}
        onClick={() => onSelect(member.id)} title={`${member.title} · ${statusOf(member.id)}${member.doneAt ? ' · Done' : ''}`}
        className={cn('flex max-w-60 shrink-0 items-center gap-2 border-r px-3 text-xs hover:bg-accent/50', member.id === session.id ? 'bg-accent text-foreground' : 'text-muted-foreground')}>
        {statusOf(member.id) !== 'idle' && <span className={cn('size-1.5 shrink-0 rounded-full', statusOf(member.id) === 'working' ? 'animate-pulse bg-green-500' : 'bg-amber-500')} />}
        <span className="truncate">{member.title}</span>
      </button>)}
    </div>
    <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-none" disabled={creating || !!session.worktree?.removedAt}
      aria-label="New session in this worktree" title="New session in this worktree" onClick={() => void create()}><Plus className="size-4" /></Button>
  </div>
}
