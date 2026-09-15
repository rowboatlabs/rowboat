import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppActivity } from './app-activity'
const { live } = vi.hoisted(() => ({ live: new Map() }))
vi.mock('@/hooks/use-bg-task-agent-status', () => ({
  useBackgroundTaskAgentStatus: () => live
}))
const invoke = vi.fn()
const task = {
  slug: 'refresh',
  name: 'Refresh',
  active: true,
  instructions: '',
  createdAt: '2020-01-01',
  lastRunAt: '2020-01-01',
  running: false
}
beforeEach(() => {
  invoke.mockReset()
  live.clear()
  Object.defineProperty(window, 'ipc', {
    configurable: true,
    value: { invoke }
  })
})
afterEach(cleanup)
it('finds app agents beyond the first page of background tasks', async () => {
  invoke.mockImplementation(async (_channel, args) =>
    args.offset === 0
      ? { items: [{ ...task, slug: 'other' }], total: 2 }
      : { items: [task], total: 2 }
  )
  const { result } = renderHook(useAppActivity)
  await waitFor(() =>
    expect(result.current.tasks.map((t) => t.slug)).toEqual([
      'other',
      'refresh'
    ])
  )
})
it('keeps a failed run response visible without relying on a completion event', async () => {
  invoke.mockImplementation(async (channel) =>
    channel === 'bg-task:list'
      ? { items: [task], total: 1 }
      : { success: false, error: 'Account disconnected' }
  )
  const { result } = renderHook(useAppActivity)
  await waitFor(() => expect(result.current.tasks).toHaveLength(1))
  await act(async () => {
    await result.current.run('refresh')
  })
  expect(result.current.failure(task)).toBe('Account disconnected')
  expect(result.current.running('refresh')).toBe(false)
})
it('recognizes an update already running before the view subscribed', async () => {
  invoke.mockResolvedValue({ items: [{ ...task, running: true }], total: 1 })
  const { result } = renderHook(useAppActivity)
  await waitFor(() => expect(result.current.running('refresh')).toBe(true))
  await act(async () => {
    await result.current.run('refresh')
  })
  expect(invoke.mock.calls.every((c) => c[0] === 'bg-task:list')).toBe(true)
})
