import { useCallback, useEffect, useState } from 'react'
import type { CodeProject, CodeSession, CodeSessionStatus, GitRepoInfo } from '@x/shared/src/code-sessions.js'

export interface ProjectRow {
  project: CodeProject
  git: GitRepoInfo
}

const STATUS_RANK: Record<CodeSessionStatus, number> = {
  'needs-you': 0,
  working: 1,
  idle: 2,
}

// Projects + sessions + live statuses for the Code section. Statuses stream
// over `codeSession:status` (pushed by the main-process tracker); the lists
// load on demand and on session lifecycle changes.
export function useCodeSessions() {
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [sessions, setSessions] = useState<CodeSession[]>([])
  const [statuses, setStatuses] = useState<Record<string, CodeSessionStatus>>({})
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [projectsRes, sessionsRes] = await Promise.all([
        window.ipc.invoke('codeProject:list', null),
        window.ipc.invoke('codeSession:list', null),
      ])
      setProjects(projectsRes.projects)
      setSessions(sessionsRes.sessions)
      setStatuses((prev) => ({ ...sessionsRes.statuses, ...prev }))
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    return window.ipc.on('codeSession:status', ({ sessionId, status }) => {
      setStatuses((prev) => (prev[sessionId] === status ? prev : { ...prev, [sessionId]: status }))
      // Turn boundaries bump lastActivityAt — refresh ordering when one ends.
      if (status === 'idle') {
        void window.ipc.invoke('codeSession:list', null).then((res) => setSessions(res.sessions))
      }
    })
  }, [])

  const statusOf = useCallback(
    (sessionId: string): CodeSessionStatus => statuses[sessionId] ?? 'idle',
    [statuses],
  )

  const sortedSessions = [...sessions].sort((a, b) => {
    const rank = STATUS_RANK[statusOf(a.id)] - STATUS_RANK[statusOf(b.id)]
    if (rank !== 0) return rank
    return (b.lastActivityAt ?? b.createdAt).localeCompare(a.lastActivityAt ?? a.createdAt)
  })

  return {
    projects,
    sessions: sortedSessions,
    statuses,
    statusOf,
    loaded,
    refresh,
    setSessions,
  }
}
