import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
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

interface CodeSessionsState {
  projects: ProjectRow[]
  sessions: CodeSession[]
  statuses: Record<string, CodeSessionStatus>
  loaded: boolean
}

// One module-level store, shared by every surface that shows code sessions
// (the Code rail, the chat header's session controls, the workspace drawer).
// They all read the same snapshot and a refresh from any of them updates the
// rest — no version-bump props threaded through App.
let state: CodeSessionsState = { projects: [], sessions: [], statuses: {}, loaded: false }
const listeners = new Set<() => void>()
let inflight: Promise<void> | null = null
let ipcSubscribed = false

function setState(patch: Partial<CodeSessionsState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot() {
  return state
}

// Statuses stream over `codeSession:status` (pushed by the main-process
// tracker). Subscribed once for the app's lifetime — the store outlives any
// one component.
function ensureIpcSubscription() {
  if (ipcSubscribed || typeof window === 'undefined' || !window.ipc) return
  ipcSubscribed = true
  window.ipc.on('codeSession:status', ({ sessionId, status }) => {
    if (state.statuses[sessionId] !== status) {
      setState({ statuses: { ...state.statuses, [sessionId]: status } })
    }
    // Turn boundaries bump lastActivityAt — refresh ordering when one ends.
    // A status for a session we don't know yet (created elsewhere — Home's
    // code dispatch, a background task) means the list is stale: fetch it.
    const unknown = !state.sessions.some((s) => s.id === sessionId)
    if (status === 'idle' || unknown) {
      void window.ipc.invoke('codeSession:list', null).then((res) => setState({ sessions: res.sessions }))
    }
  })
}

export async function refreshCodeSessions(): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const [projectsRes, sessionsRes] = await Promise.all([
        window.ipc.invoke('codeProject:list', null),
        window.ipc.invoke('codeSession:list', null),
      ])
      setState({
        projects: projectsRes.projects,
        sessions: sessionsRes.sessions,
        // Live pushes win over the list's snapshot.
        statuses: { ...sessionsRes.statuses, ...state.statuses },
        loaded: true,
      })
    } catch {
      setState({ loaded: true })
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export function codeSessionStatusOf(sessionId: string): CodeSessionStatus {
  return state.statuses[sessionId] ?? 'idle'
}

// Projects + sessions + live statuses for the Code section, attention-first.
export function useCodeSessions() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // Every (re)mount refetches — sessions and projects can be created outside
  // this surface (Home's code dispatch, background tasks), and the lists are
  // two cheap IPC reads. Concurrent mounts share one in-flight refresh.
  useEffect(() => {
    ensureIpcSubscription()
    void refreshCodeSessions()
  }, [])

  const statusOf = useCallback(
    (sessionId: string): CodeSessionStatus => snap.statuses[sessionId] ?? 'idle',
    [snap.statuses],
  )

  const sortedSessions = useMemo(() => {
    return [...snap.sessions].sort((a, b) => {
      const rank = STATUS_RANK[statusOf(a.id)] - STATUS_RANK[statusOf(b.id)]
      if (rank !== 0) return rank
      return (b.lastActivityAt ?? b.createdAt).localeCompare(a.lastActivityAt ?? a.createdAt)
    })
  }, [snap.sessions, statusOf])

  return {
    projects: snap.projects,
    sessions: sortedSessions,
    statuses: snap.statuses,
    statusOf,
    loaded: snap.loaded,
    refresh: refreshCodeSessions,
  }
}
