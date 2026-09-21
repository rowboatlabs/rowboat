import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useBrowserSettings } from './use-browser-settings'
import { toast } from '@/lib/toast'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
const originalIpc = Object.getOwnPropertyDescriptor(window, 'ipc')
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
  if (originalIpc) Object.defineProperty(window, 'ipc', originalIpc)
  else Reflect.deleteProperty(window, 'ipc')
})

it('migrates the legacy rail preference and uses persisted settings', async () => {
  localStorage.setItem('browser:railOpen', '1')
  const invoke = vi.fn().mockResolvedValue({ ok: true, settings: { tabRailOpen: false } })
  Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } })
  const { result } = renderHook(useBrowserSettings)
  await waitFor(() => expect(result.current.railOpen).toBe(false))
  expect(invoke).toHaveBeenCalledWith('browser:getSettings', { legacyTabRailOpen: true })
  expect(localStorage.getItem('browser:railOpen')).toBeNull()
})

it('does not let a late initial read undo a newer toggle', async () => {
  let finish!: (value: unknown) => void
  const initial = new Promise((resolve) => { finish = resolve })
  const invoke = vi.fn((channel: string) => channel === 'browser:getSettings'
    ? initial : Promise.resolve({ ok: true, settings: { tabRailOpen: true } }))
  Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } })
  const { result } = renderHook(useBrowserSettings)
  act(() => result.current.toggleRail())
  await act(async () => { finish({ ok: true, settings: { tabRailOpen: false } }) })
  expect(result.current.railOpen).toBe(true)
  expect(invoke).toHaveBeenCalledWith('browser:updateSettings', { tabRailOpen: true })
  invoke.mockImplementation(() => Promise.resolve({ ok: false, error: 'Write failed' }))
  act(() => result.current.toggleRail())
  await waitFor(() => expect(result.current.railOpen).toBe(true))
})

it('rolls back the current toggle and reports a failed save', async () => {
  const invoke = vi.fn((channel: string) => Promise.resolve(channel === 'browser:getSettings'
    ? { ok: true, settings: { tabRailOpen: false } }
    : { ok: false, error: 'Disk is full' }))
  Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } })
  const { result } = renderHook(useBrowserSettings)
  await act(async () => {})
  act(() => result.current.toggleRail())
  await waitFor(() => expect(result.current.railOpen).toBe(false))
  expect(toast).toHaveBeenCalledWith('Disk is full', 'error')
})
