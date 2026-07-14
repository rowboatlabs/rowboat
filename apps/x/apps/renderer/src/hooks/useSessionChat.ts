import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { ipcSessionsClient } from '@/lib/session-chat/client'
import { subscribeTurnFeed } from '@/lib/turn-feed'
import { SessionChatStore, type SessionChatStoreDeps } from '@/lib/session-chat/store'

// Declare "this window is watching turn X" so main forwards its deltas.
// Fire-and-forget on both edges: a lost subscribe only degrades streaming
// granularity (durable events still arrive), never correctness.
function subscribeDeltas(turnId: string): () => void {
  void window.ipc.invoke('turns:subscribe', { turnId }).catch(() => undefined)
  return () => {
    void window.ipc.invoke('turns:unsubscribe', { turnId }).catch(() => undefined)
  }
}

const defaultDeps: SessionChatStoreDeps = {
  client: ipcSessionsClient,
  subscribeTurnFeed,
  subscribeDeltas,
}

// Thin subscription over SessionChatStore — all logic (seeding, feed events,
// reducer, overlay, action routing) lives in the store, which is unit-tested
// without React. `deps` is injectable for tests.
export function useSessionChat(
  sessionId: string | null,
  deps: SessionChatStoreDeps = defaultDeps,
) {
  const [store] = useState(() => new SessionChatStore(deps))
  useEffect(() => store.connect(), [store])
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
