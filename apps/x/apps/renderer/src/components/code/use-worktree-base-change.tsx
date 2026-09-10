import { useEffect, useState } from 'react'
import type { CodeSession } from '@x/shared/src/code-sessions.js'
import { BranchDialog } from './branch-dialog'
import { refreshCodeSessions } from './use-code-sessions'

type BaseStatus = { canChange: boolean; reason: string | null; baseBranch: string | null }

export function useWorktreeBaseChange(session: CodeSession, menuOpen: boolean, started: boolean) {
  const [eligibility, setEligibility] = useState<BaseStatus | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!menuOpen || !session.worktree || session.worktree.removedAt) return
    let cancelled = false
    const check = () => {
      void window.ipc.invoke('codeSession:baseBranchStatus', { sessionId: session.id })
        .then((result) => { if (!cancelled) setEligibility(result) })
        .catch(() => { if (!cancelled) setEligibility({ canChange: false, baseBranch: null, reason: 'Could not verify this worktree. Reopen it to try again.' }) })
    }
    setEligibility(null)
    check()
    window.addEventListener('focus', check)
    return () => { cancelled = true; window.removeEventListener('focus', check) }
  }, [session.id, session.worktree?.baseCommit, session.worktree?.removedAt, menuOpen, started])
  const reason = started ? "Base branch can't be changed after a session has started." : eligibility?.reason
  const disabled = started || !eligibility?.canChange
  return {
    disabled,
    description: reason ?? (eligibility ? `Current base: ${session.worktree?.baseBranch ?? 'HEAD'}` : 'Checking base branch…'),
    onSelect: () => setOpen(true),
    dialog: open && <BranchDialog projectId={session.projectId} mode="base" initialBranch={session.worktree?.baseBranch}
      excludeBranch={session.worktree?.branch} onClose={() => setOpen(false)} onConfirm={async (baseBranch) => {
        await window.ipc.invoke('codeSession:changeBaseBranch', { sessionId: session.id, baseBranch })
        await refreshCodeSessions()
      }} />,
  }
}
