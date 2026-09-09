import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { ipcSessionsClient } from '@/lib/session-chat/client'
import { subscribeTurnFeed } from '@/lib/turn-feed'
import { subscribeSessionFeed } from '@/lib/session-chat/feed'
import { SessionChatStore, type SessionChatStoreDeps } from '@/lib/session-chat/store'

// Declare "this window is watching turn X" so main forwards its deltas.
// Fire-and-forget on both edges: a lost subscribe only degrades streaming
// granularity (durable events still arrive), never correctness.
const deltaSubscribers = new Map<string, number>()

function subscribeDeltas(turnId: string): () => void {
  const count = deltaSubscribers.get(turnId) ?? 0
  deltaSubscribers.set(turnId, count + 1)
  if (count === 0) void window.ipc.invoke('turns:subscribe', { turnId }).catch(() => undefined)
  return () => {
    const remaining = (deltaSubscribers.get(turnId) ?? 1) - 1
    if (remaining > 0) deltaSubscribers.set(turnId, remaining)
    else {
      deltaSubscribers.delete(turnId)
      void window.ipc.invoke('turns:unsubscribe', { turnId }).catch(() => undefined)
    }
  }
}

const defaultDeps: SessionChatStoreDeps = {
  client: ipcSessionsClient,
  subscribeTurnFeed,
  subscribeSessionFeed,
  subscribeDeltas,
}

// Thin subscription over SessionChatStore — all logic (seeding, feed events,
// reducer, overlay, action routing) lives in the store, which is unit-tested
// without React. `deps` is injectable for tests.
export function useSessionChat(
  sessionId: string | null,
  deps: SessionChatStoreDeps = defaultDeps,
) {
  const binding = useMemo(() => ({ sessionId, store: new SessionChatStore(deps) }), [deps, sessionId])
  const { store } = binding
  useEffect(() => store.connect(), [store])
  useEffect(() => {
    void binding.store.setSession(binding.sessionId)
  }, [binding])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return useMemo(
    () => ({
      ...snapshot,
      ...(snapshot.sessionId !== sessionId ? { sessionId, chatState: null, queued: [], error: null, loading: Boolean(sessionId) } : {}),
      sendMessage: store.sendMessage,
      sendOrQueueMessage: store.sendOrQueueMessage,
      editQueued: store.editQueued,
      removeQueued: store.removeQueued,
      respondToPermission: store.respondToPermission,
      answerAskHuman: store.answerAskHuman,
      stop: store.stop,
    }),
    [snapshot, store, sessionId],
  )
}

export type SessionChat = ReturnType<typeof useSessionChat>
