import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useFocusedPresence } from './use-focused-presence'

const invoke = vi.fn().mockResolvedValue({ success: true })
let focused = true
let visibility = 'visible'
beforeEach(() => {
    vi.useFakeTimers()
    focused = true
    visibility = 'visible'
    invoke.mockClear()
    Object.assign(window, { ipc: { invoke } })
    vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility as DocumentVisibilityState)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })
const latest = () => invoke.mock.lastCall?.[1]

it('renews only a visible, focused Spaces window and clears on blur or hiding', () => {
    renderHook(() => useFocusedPresence('org', true))
    expect(latest()).toMatchObject({ orgId: 'org', active: true })
    const sessionId = latest().sessionId
    act(() => vi.advanceTimersByTime(20_000))
    expect(latest()).toMatchObject({ sessionId, active: true })
    focused = false
    act(() => window.dispatchEvent(new Event('blur')))
    expect(latest()).toMatchObject({ sessionId, active: false })
    act(() => vi.advanceTimersByTime(20_000))
    expect(latest().active).toBe(false)
    focused = true
    act(() => window.dispatchEvent(new Event('focus')))
    expect(latest().active).toBe(true)
    visibility = 'hidden'
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(latest().active).toBe(false)
    act(() => window.dispatchEvent(new Event('focus')))
    expect(latest().active).toBe(false)
})

it('does not report online on a background mount or outside the Spaces view', () => {
    focused = false
    const { rerender } = renderHook(({ active }) => useFocusedPresence('org', active), { initialProps: { active: true } })
    expect(latest().active).toBe(false)
    rerender({ active: false })
    invoke.mockClear()
    focused = true
    act(() => {
        window.dispatchEvent(new Event('focus'))
        vi.advanceTimersByTime(60_000)
    })
    expect(invoke).not.toHaveBeenCalled()
})

it('clears the old org on navigation and clears on pagehide and unmount', () => {
    const { rerender, unmount } = renderHook(({ org }) => useFocusedPresence(org, true), { initialProps: { org: 'first' } })
    rerender({ org: 'second' })
    expect(invoke.mock.calls.slice(-2).map(call => call[1])).toEqual([
        expect.objectContaining({ orgId: 'first', active: false }),
        expect.objectContaining({ orgId: 'second', active: true }),
    ])
    act(() => window.dispatchEvent(new Event('pagehide')))
    expect(latest().active).toBe(false)
    act(() => vi.advanceTimersByTime(20_000))
    expect(latest().active).toBe(false)
    act(() => window.dispatchEvent(new Event('pageshow')))
    expect(latest().active).toBe(true)
    unmount()
    expect(latest()).toMatchObject({ orgId: 'second', active: false })
    invoke.mockClear()
    act(() => vi.advanceTimersByTime(60_000))
    expect(invoke).not.toHaveBeenCalled()
})

it('uses distinct window sessions so one window cannot clear another', () => {
    const first = renderHook(() => useFocusedPresence('org', true))
    const firstId = latest().sessionId
    renderHook(() => useFocusedPresence('org', true))
    const secondId = latest().sessionId
    expect(secondId).not.toBe(firstId)
    first.unmount()
    expect(latest()).toMatchObject({ sessionId: firstId, active: false })
})
