import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { ipcSessionsClient } from '@/lib/session-chat/client'
import { subscribeSessionFeed } from '@/lib/session-chat/feed'
import { SessionChatStore, type SessionChatStoreDeps } from '@/lib/session-chat/store'

const defaultDeps: SessionChatStoreDeps = {
  client: ipcSessionsClient,
  subscribeFeed: subscribeSessionFeed,
}

// Thin subscription over SessionChatStore — all logic (seeding, feed events,
// reducer, overlay, action routing) lives in the store, which is unit-tested
// without React. `deps` is injectable for tests.
export function useSessionChat(
  sessionId: string | null,
  deps: SessionChatStoreDeps = defaultDeps,
) {
  const [store] = useState(() => new SessionChatStore(deps))
  useEffect(() => () => store.dispose(), [store])
  useEffect(() => {
    void store.setSession(sessionId)
  }, [store, sessionId])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return useMemo(
    () => ({
      ...snapshot,
      sendMessage: store.sendMessage,
      respondToPermission: store.respondToPermission,
      answerAskHuman: store.answerAskHuman,
      stop: store.stop,
    }),
    [snapshot, store],
  )
}

export type SessionChat = ReturnType<typeof useSessionChat>
