import { Activity } from 'react'
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('counts completed sessions once and clears only the session opened', async () => {
  const { noteCodeSessionCompleted, useCodeSessionReader, useUnreadCodeSessions } = await import('./session-read-state')
  const { result } = renderHook(() => useUnreadCodeSessions())
  act(() => {
    noteCodeSessionCompleted('one')
    noteCodeSessionCompleted('one')
    noteCodeSessionCompleted('two')
  })
  expect([...result.current]).toEqual(['one', 'two'])
  renderHook(() => useCodeSessionReader('one'))
  expect([...result.current]).toEqual(['two'])
  act(() => noteCodeSessionCompleted('one'))
  expect([...result.current]).toEqual(['two'])
})

it('keeps completions unread while Projects is hidden, then clears on return', async () => {
  const { noteCodeSessionCompleted, useCodeSessionReader, useUnreadCodeSessions } = await import('./session-read-state')
  function Reader() { useCodeSessionReader('one'); return null }
  const { result } = renderHook(() => useUnreadCodeSessions())
  const view = render(<Activity mode="visible"><Reader /></Activity>)
  view.rerender(<Activity mode="hidden"><Reader /></Activity>)
  act(() => noteCodeSessionCompleted('one'))
  expect(result.current.has('one')).toBe(true)
  view.rerender(<Activity mode="visible"><Reader /></Activity>)
  expect(result.current.size).toBe(0)
})

it('keeps a background window unread until it regains focus', async () => {
  const { noteCodeSessionCompleted, useCodeSessionReader, useUnreadCodeSessions } = await import('./session-read-state')
  vi.mocked(document.hasFocus).mockReturnValue(false)
  renderHook(() => useCodeSessionReader('one'))
  const { result } = renderHook(() => useUnreadCodeSessions())
  act(() => noteCodeSessionCompleted('one'))
  expect(result.current.has('one')).toBe(true)
  vi.mocked(document.hasFocus).mockReturnValue(true)
  act(() => window.dispatchEvent(new Event('focus')))
  expect(result.current.size).toBe(0)
})

it('restores unread completions after reload, including read acknowledgements', async () => {
  const first = await import('./session-read-state')
  first.noteCodeSessionCompleted('one')
  first.noteCodeSessionCompleted('two')
  renderHook(() => first.useCodeSessionReader('one'))
  cleanup()
  vi.resetModules()
  const restored = await import('./session-read-state')
  const { result } = renderHook(() => restored.useUnreadCodeSessions())
  expect([...result.current]).toEqual(['two'])
})

it('marks a session unread only after a live turn settles, not on initial idle or approval', async () => {
  let statusChanged: (event: { sessionId: string; status: string }) => void = () => {}
  Object.assign(window, { ipc: {
    on: (channel: string, listener: typeof statusChanged) => {
      if (channel === 'codeSession:status') statusChanged = listener
      return () => {}
    },
    invoke: async (channel: string) => channel === 'codeProject:list'
      ? { projects: [] }
      : { sessions: [{ id: 'one', createdAt: '2026-09-22T00:00:00Z' }], statuses: { one: 'idle' } },
  } })
  const { useCodeSessions } = await import('./use-code-sessions')
  const { useUnreadCodeSessions } = await import('./session-read-state')
  const store = renderHook(() => useCodeSessions())
  const unread = renderHook(() => useUnreadCodeSessions())
  await waitFor(() => expect(store.result.current.loaded).toBe(true))
  await act(async () => statusChanged({ sessionId: 'one', status: 'idle' }))
  expect(unread.result.current.size).toBe(0)
  act(() => statusChanged({ sessionId: 'one', status: 'working' }))
  act(() => statusChanged({ sessionId: 'one', status: 'needs-you' }))
  expect(unread.result.current.size).toBe(0)
  act(() => statusChanged({ sessionId: 'one', status: 'working' }))
  await act(async () => statusChanged({ sessionId: 'one', status: 'idle' }))
  expect([...unread.result.current]).toEqual(['one'])
})
