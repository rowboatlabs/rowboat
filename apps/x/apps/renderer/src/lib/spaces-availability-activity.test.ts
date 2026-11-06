import { afterEach, expect, it, vi } from 'vitest'
import { startActivityReporter } from './spaces-availability-activity'

afterEach(() => vi.useRealTimers())
it('goes away after ten minutes without input and becomes active after input, without tab blur forcing away', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-05T12:00:00Z'))
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    const send = vi.fn()
    const stop = startActivityReporter(() => ['org'], send)
    expect(send).toHaveBeenLastCalledWith('org', true)
    window.dispatchEvent(new Event('blur'))
    vi.advanceTimersByTime(9 * 60_000)
    expect(send).toHaveBeenLastCalledWith('org', true)
    vi.advanceTimersByTime(60_000)
    expect(send).toHaveBeenLastCalledWith('org', false)
    window.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(15_000)
    expect(send).toHaveBeenLastCalledWith('org', true)
    stop()
    expect(send).toHaveBeenLastCalledWith('org', false)
    const count = send.mock.calls.length
    vi.advanceTimersByTime(60_000)
    expect(send).toHaveBeenCalledTimes(count)
})
