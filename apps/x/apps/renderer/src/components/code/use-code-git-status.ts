import { useCallback, useEffect, useState } from 'react'
import type { CodeSessionStatus, GitStatusFile } from '@x/shared/src/code-sessions.js'

export interface CodeGitStatus {
  isRepo: boolean
  branch: string | null
  hasCommits: boolean
  files: GitStatusFile[]
}

// Working-tree status for one code session. Lives above the workspace drawer
// so the chat header can show the changed-file count while the drawer is
// closed. Refreshes on turn end and polls lightly while the agent is working —
// the session cwd lives outside the workspace watcher, so there are no change
// events to react to.
export function useCodeGitStatus(sessionId: string | null, status: CodeSessionStatus) {
  // Tagged with the session it belongs to, so a switch reads as "unknown"
  // until the new session's status lands — no reset step needed.
  const [git, setGit] = useState<{ sessionId: string; status: CodeGitStatus | null } | null>(null)

  const refresh = useCallback(async () => {
    if (!sessionId) return
    try {
      const res = await window.ipc.invoke('codeSession:gitStatus', { sessionId })
      setGit({ sessionId, status: res })
    } catch {
      setGit({ sessionId, status: null })
    }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    const tick = () => { void refresh() }
    // First read after the current frame; then poll only while the agent is
    // busy (idle sessions refresh on the next status change instead).
    const kick = setTimeout(tick, 0)
    const interval = status === 'idle' ? null : setInterval(tick, 5000)
    return () => {
      clearTimeout(kick)
      if (interval) clearInterval(interval)
    }
  }, [sessionId, status, refresh])

  return {
    gitStatus: sessionId && git?.sessionId === sessionId ? git.status : null,
    refresh,
  }
}
