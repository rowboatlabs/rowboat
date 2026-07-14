import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { ipcSessionsClient } from '@/lib/session-chat/client'
import { subscribeSessionFeed } from '@/lib/session-chat/feed'
import { SessionListStore, type SessionListStoreDeps } from '@/lib/session-chat/store'

const defaultDeps: SessionListStoreDeps = {
  client: ipcSessionsClient,
  subscribeFeed: subscribeSessionFeed,
}

// The session list (chat history sidebar): seeded from sessions:list, kept
// current by index-changed feed events. Logic lives in SessionListStore.
export function useSessions(deps: SessionListStoreDeps = defaultDeps) {
  const [store] = useState(() => new SessionListStore(deps))
  useEffect(() => {
    const disconnect = store.connect()
    void store.load()
    return disconnect
  }, [store])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const client = deps.client
  return useMemo(
    () => ({
      ...snapshot,
      createSession: (input: { title?: string } = {}) => client.create(input),
      deleteSession: (sessionId: string) => client.delete(sessionId),
      setTitle: (sessionId: string, title: string) => client.setTitle(sessionId, title),
    }),
    [snapshot, client],
  )
}

export type Sessions = ReturnType<typeof useSessions>
