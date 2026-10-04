import { describe, expect, it } from 'vitest'
import { forgetSessions, isMissingSession, missingSessions } from './missing-chats'

// BAARALI(04/10/2026): a reopened chat the server does not have becomes a new chat.

describe('missing chats', () => {
  it('recognizes the server saying it does not have the session, through IPC', () => {
    expect(isMissingSession(new Error("Error invoking remote method 'sessions:get': Error: session not found: s1"))).toBe(true)
    expect(isMissingSession(new Error('503 Service Unavailable'))).toBe(false)
  })

  it('finds the sessions the server does not have, and keeps one it could not answer for', async () => {
    const get = async (id: string) => {
      if (id === 'gone') throw new Error(`session not found: ${id}`)
      if (id === 'waking') throw new Error('instance not ready')
      return {}
    }
    const missing = await missingSessions(['here', 'gone', null, 'gone', 'waking'], get)
    expect([...missing]).toEqual(['gone'])
  })

  it('turns only those tabs into new chats, in place', () => {
    const tabs = [
      { id: 't1', runId: 'gone', chatId: 'gone' },
      { id: 't2', runId: 'here', chatId: 'here' },
      { id: 't3', runId: null, chatId: 'draft' },
    ]
    const next = forgetSessions(tabs, new Set(['gone']))
    expect(next[0]).toMatchObject({ id: 't1', runId: null })
    expect(next[0].chatId).not.toBe('gone')
    expect(next.slice(1)).toEqual(tabs.slice(1))
  })
})
