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

type Binding = { store: SessionChatStore; users: number; disconnect?: () => void; loaded: boolean }
const bindings = new WeakMap<SessionChatStoreDeps, Map<string, Binding>>()

function getBinding(deps: SessionChatStoreDeps, sessionId: string | null): Binding {
  if (!sessionId) return { store: new SessionChatStore(deps), users: 0, loaded: false }
  let sessions = bindings.get(deps)
  if (!sessions) { sessions = new Map(); bindings.set(deps, sessions) }
  let binding = sessions.get(sessionId)
  if (!binding) {
    binding = { store: new SessionChatStore(deps), users: 0, loaded: false }
    sessions.set(sessionId, binding)
  }
  return binding
}

// Thin subscription over SessionChatStore — all logic (seeding, feed events,
// reducer, overlay, action routing) lives in the store, which is unit-tested
// without React. `deps` is injectable for tests.
function retainBinding(binding: Binding, sessionId: string | null, deps: SessionChatStoreDeps) {
  const { store } = binding
  if (sessionId) bindings.get(deps)?.set(sessionId, binding)
  binding.users += 1
  if (binding.users === 1) binding.disconnect = store.connect()
  if (!binding.loaded) {
    binding.loaded = true
    void store.setSession(sessionId)
  }
  return () => {
    binding.users -= 1
    if (binding.users === 0) {
      binding.disconnect?.()
      binding.loaded = false
      if (sessionId && bindings.get(deps)?.get(sessionId) === binding) bindings.get(deps)?.delete(sessionId)
    }
  }
}

function useSessionStore(sessionId: string | null, deps: SessionChatStoreDeps) {
  const binding = useMemo(() => getBinding(deps, sessionId), [deps, sessionId])
  const { store } = binding
  useEffect(() => retainBinding(binding, sessionId, deps), [binding, sessionId, deps])
  return store
}

const inactiveSubscribe = () => () => undefined

export function useSessionChatStatus(sessionId: string | null) {
  const store = useSessionStore(sessionId, defaultDeps)
  const getStatus = () => {
    const state = store.getSnapshot().chatState
    return state?.isWaitingOnHuman ? 'waiting' : state?.isProcessing ? 'working' : 'idle'
  }
  return useSyncExternalStore(store.subscribe, getStatus)
}

export function useSessionChat(sessionId: string | null, deps: SessionChatStoreDeps = defaultDeps, live = true) {
  const store = useSessionStore(sessionId, deps)
  const getSnapshot = useMemo(() => {
    if (live) return store.getSnapshot
    const frozen = store.getSnapshot()
    return () => frozen
  }, [store, live])
  const snapshot = useSyncExternalStore(live ? store.subscribe : inactiveSubscribe, getSnapshot)
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
