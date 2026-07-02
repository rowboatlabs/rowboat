import { describe, expect, it } from 'vitest'
import type { SessionBusEvent, SessionState } from '@x/shared/src/sessions.js'
import { isChatMessage } from '@/lib/chat-conversation'
import type { SessionsClient } from './client'
import type { SessionFeedListener } from './feed'
import { SessionChatStore, SessionListStore } from './store'
import {
  assistantText,
  completed,
  completedTurnLog,
  created,
  indexEntry,
  requested,
  sessionState,
  turnCompleted,
  user,
  type TEvent,
} from './test-fixtures'

const S1 = 'sess-1'

class FakeClient implements SessionsClient {
  sessions = new Map<string, SessionState>()
  turns = new Map<string, TEvent[]>()
  calls: Array<{ method: string; args: unknown[] }> = []
  // When set, get() defers until the returned resolver is invoked.
  deferredGet: (() => void) | null = null

  private record(method: string, ...args: unknown[]) {
    this.calls.push({ method, args })
  }

  async create(input: { title?: string }) {
    this.record('create', input)
    return { sessionId: 'new-session' }
  }
  async list() {
    this.record('list')
    return { sessions: [...this.sessions.keys()].map((id) => indexEntry(id)) }
  }
  async get(sessionId: string) {
    this.record('get', sessionId)
    if (this.deferredGet === null) {
      const state = this.sessions.get(sessionId)
      if (!state) throw new Error(`session not found: ${sessionId}`)
      return state
    }
    return new Promise<SessionState>((resolve, reject) => {
      this.deferredGet = () => {
        const state = this.sessions.get(sessionId)
        if (state) resolve(state)
        else reject(new Error(`session not found: ${sessionId}`))
      }
    })
  }
  async getTurn(turnId: string) {
    this.record('getTurn', turnId)
    const events = this.turns.get(turnId)
    if (!events) throw new Error(`turn not found: ${turnId}`)
    return { turnId, events }
  }
  async sendMessage(sessionId: string, input: unknown, config: unknown) {
    this.record('sendMessage', sessionId, input, config)
    return { turnId: 'turn-next' }
  }
  async respondToPermission(...args: unknown[]) {
    this.record('respondToPermission', ...args)
  }
  async respondToAskHuman(...args: unknown[]) {
    this.record('respondToAskHuman', ...args)
  }
  async stopTurn(...args: unknown[]) {
    this.record('stopTurn', ...args)
  }
  async resumeTurn(...args: unknown[]) {
    this.record('resumeTurn', ...args)
  }
  async setTitle(...args: unknown[]) {
    this.record('setTitle', ...args)
  }
  async delete(...args: unknown[]) {
    this.record('delete', ...args)
  }
}

function makeStore() {
  const client = new FakeClient()
  let emit: SessionFeedListener = () => undefined
  let subscribed = 0
  let unsubscribed = 0
  const store = new SessionChatStore({
    client,
    subscribeFeed: (listener) => {
      subscribed += 1
      emit = listener
      return () => {
        unsubscribed += 1
        emit = () => undefined
      }
    },
  })
  const disconnect = store.connect()
  return {
    client,
    store,
    disconnect,
    emit: (event: SessionBusEvent) => emit(event),
    getSubscribed: () => subscribed,
    getUnsubscribed: () => unsubscribed,
  }
}

function turnEvent(
  sessionId: string,
  turnId: string,
  event:
    | TEvent
    | { type: 'text_delta' | 'reasoning_delta'; turnId: string; modelCallIndex: number; delta: string },
): SessionBusEvent {
  return { kind: 'turn-event', sessionId, turnId, event }
}

describe('SessionChatStore', () => {
  it('seeds a session: prior turns frozen, latest live, conversation composed', async () => {
    const { client, store } = makeStore()
    client.sessions.set(S1, sessionState(S1, ['turn-1', 'turn-2']))
    client.turns.set('turn-1', completedTurnLog('turn-1', S1, 'first?', 'first answer'))
    client.turns.set('turn-2', completedTurnLog('turn-2', S1, 'second?', 'second answer'))

    await store.setSession(S1)
    const snapshot = store.getSnapshot()
    expect(snapshot.loading).toBe(false)
    expect(snapshot.latestTurnId).toBe('turn-2')
    expect(
      snapshot.chatState?.conversation.filter(isChatMessage).map((m) => m.content),
    ).toEqual(['first?', 'first answer', 'second?', 'second answer'])
    expect(snapshot.chatState?.isProcessing).toBe(false)
  })

  it('applies live durable events through the shared reducer', async () => {
    const { client, store, emit } = makeStore()
    client.sessions.set(S1, sessionState(S1, []))
    await store.setSession(S1)

    emit(turnEvent(S1, 'turn-1', created('turn-1', S1, user('go'))))
    emit(turnEvent(S1, 'turn-1', requested('turn-1', 0, [user('go')])))
    expect(store.getSnapshot().chatState?.isThinking).toBe(true)

    emit(turnEvent(S1, 'turn-1', completed('turn-1', 0, assistantText('done'))))
    emit(turnEvent(S1, 'turn-1', turnCompleted('turn-1')))
    const snapshot = store.getSnapshot()
    expect(snapshot.latestTurnId).toBe('turn-1')
    expect(snapshot.chatState?.isProcessing).toBe(false)
    expect(
      snapshot.chatState?.conversation.filter(isChatMessage).map((m) => m.content),
    ).toEqual(['go', 'done'])
  })

  it('accumulates text deltas and clears them on the canonical response', async () => {
    const { client, store, emit } = makeStore()
    client.sessions.set(S1, sessionState(S1, []))
    await store.setSession(S1)
    emit(turnEvent(S1, 'turn-1', created('turn-1', S1, user('go'))))
    emit(turnEvent(S1, 'turn-1', requested('turn-1', 0, [user('go')])))
    emit(turnEvent(S1, 'turn-1', { type: 'text_delta', turnId: 'turn-1', modelCallIndex: 0, delta: 'he' }))
    emit(turnEvent(S1, 'turn-1', { type: 'text_delta', turnId: 'turn-1', modelCallIndex: 0, delta: 'y' }))
    expect(store.getSnapshot().chatState?.currentAssistantMessage).toBe('hey')

    emit(turnEvent(S1, 'turn-1', completed('turn-1', 0, assistantText('hey'))))
    expect(store.getSnapshot().chatState?.currentAssistantMessage).toBe('')
  })

  it('freezes the previous latest turn when a new turn starts', async () => {
    const { client, store, emit } = makeStore()
    client.sessions.set(S1, sessionState(S1, ['turn-1']))
    client.turns.set('turn-1', completedTurnLog('turn-1', S1, 'q1', 'a1'))
    await store.setSession(S1)

    emit(turnEvent(S1, 'turn-2', created('turn-2', S1, user('q2'))))
    const snapshot = store.getSnapshot()
    expect(snapshot.latestTurnId).toBe('turn-2')
    expect(
      snapshot.chatState?.conversation.filter(isChatMessage).map((m) => m.content),
    ).toEqual(['q1', 'a1', 'q2'])
  })

  it('ignores events for other sessions', async () => {
    const { client, store, emit } = makeStore()
    client.sessions.set(S1, sessionState(S1, []))
    await store.setSession(S1)
    emit(turnEvent('other-session', 'turn-x', created('turn-x', 'other-session')))
    expect(store.getSnapshot().chatState?.conversation).toEqual([])
  })

  it('reconciles an unknown mid-turn event by refetching the turn', async () => {
    const { client, store, emit } = makeStore()
    client.sessions.set(S1, sessionState(S1, []))
    await store.setSession(S1)
    // The feed attached mid-turn: we never saw turn_created for turn-9.
    client.turns.set('turn-9', [
      created('turn-9', S1, user('missed')),
      requested('turn-9', 0, [user('missed')]),
    ])
    emit(turnEvent(S1, 'turn-9', completed('turn-9', 0, assistantText('caught up'))))
    await Promise.resolve()
    await Promise.resolve()
    expect(store.getSnapshot().latestTurnId).toBe('turn-9')
  })

  it('routes actions against the latest turn', async () => {
    const { client, store, emit } = makeStore()
    client.sessions.set(S1, sessionState(S1, []))
    await store.setSession(S1)
    emit(turnEvent(S1, 'turn-1', created('turn-1', S1)))

    await store.sendMessage(user('next'), { agent: { agentId: 'copilot' } })
    await store.respondToPermission('tc1', 'allow')
    await store.answerAskHuman('ah1', '42')
    await store.stop()

    expect(client.calls.filter((c) => c.method !== 'get' && c.method !== 'getTurn')).toEqual([
      { method: 'sendMessage', args: [S1, user('next'), { agent: { agentId: 'copilot' } }] },
      { method: 'respondToPermission', args: ['turn-1', 'tc1', 'allow', undefined] },
      { method: 'respondToAskHuman', args: ['turn-1', 'ah1', '42'] },
      { method: 'stopTurn', args: ['turn-1'] },
    ])
  })

  it('rejects sendMessage without an active session', async () => {
    const { store } = makeStore()
    await expect(
      store.sendMessage(user('x'), { agent: { agentId: 'copilot' } }),
    ).rejects.toThrowError('No active session')
  })

  it('drops stale loads after a session switch', async () => {
    const { client, store } = makeStore()
    client.sessions.set(S1, sessionState(S1, ['turn-1']))
    client.turns.set('turn-1', completedTurnLog('turn-1', S1, 'old', 'old answer'))
    client.sessions.set('sess-2', sessionState('sess-2', []))

    client.deferredGet = () => undefined // arm deferral
    const first = store.setSession(S1)
    const release = client.deferredGet
    client.deferredGet = null
    const second = store.setSession('sess-2')
    release?.() // S1's get resolves after the switch
    await Promise.all([first, second])

    expect(store.getSnapshot().sessionId).toBe('sess-2')
    expect(store.getSnapshot().chatState?.conversation).toEqual([])
  })

  it('surfaces load errors and disconnects its feed subscription', async () => {
    const { store, disconnect, getUnsubscribed } = makeStore()
    await store.setSession('missing-session')
    expect(store.getSnapshot().error).toMatch(/session not found/)
    disconnect()
    expect(getUnsubscribed()).toBe(1)
    void store
  })

  it('survives a StrictMode-style connect -> cleanup -> connect cycle', async () => {
    // React StrictMode runs every effect's mount/cleanup/mount cycle in dev;
    // the feed must re-attach or the store goes permanently deaf (the bug
    // this test pins: a constructor-made subscription torn down by the first
    // cleanup was never restored, leaving the chat stuck at "Thinking…").
    const { client, store, disconnect, emit, getSubscribed } = makeStore()
    client.sessions.set(S1, sessionState(S1, []))
    disconnect()
    const disconnect2 = store.connect()
    expect(getSubscribed()).toBe(2)

    await store.setSession(S1)
    emit(turnEvent(S1, 'turn-1', created('turn-1', S1, user('go'))))
    emit(turnEvent(S1, 'turn-1', requested('turn-1', 0, [user('go')])))
    emit(turnEvent(S1, 'turn-1', completed('turn-1', 0, assistantText('done'))))
    emit(turnEvent(S1, 'turn-1', turnCompleted('turn-1')))
    expect(store.getSnapshot().chatState?.isProcessing).toBe(false)
    expect(
      store.getSnapshot().chatState?.conversation.filter(isChatMessage).map((m) => m.content),
    ).toEqual(['go', 'done'])
    disconnect2()
  })
})

describe('SessionListStore', () => {
  it('loads, applies index updates and deletions, and sorts by updatedAt', async () => {
    const client = new FakeClient()
    client.sessions.set('a', sessionState('a', []))
    client.sessions.set('b', sessionState('b', []))
    let emit: SessionFeedListener = () => undefined
    const store = new SessionListStore({
      client,
      subscribeFeed: (listener) => {
        emit = listener
        return () => undefined
      },
    })
    store.connect()
    await store.load()
    expect(store.getSnapshot().sessions.map((s) => s.sessionId).sort()).toEqual(['a', 'b'])

    emit({
      kind: 'index-changed',
      sessionId: 'c',
      entry: indexEntry('c', { updatedAt: '2026-07-03T00:00:00Z' }),
    })
    expect(store.getSnapshot().sessions[0].sessionId).toBe('c')

    emit({ kind: 'index-changed', sessionId: 'a', entry: null })
    expect(store.getSnapshot().sessions.map((s) => s.sessionId)).toEqual(['c', 'b'])
  })
})
