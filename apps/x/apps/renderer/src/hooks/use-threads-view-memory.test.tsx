import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useThreadsPreference, useThreadsScroll } from './use-threads-view-memory'

let resize: () => void
const loadOlder = vi.fn()
function View({ space = 'one', loaded = true, hasMore = false, rows = 10 } = {}) {
    const [filter, setFilter] = useThreadsPreference(`filter:${space}`, (raw) => raw ?? 'all')
    const scroll = useThreadsScroll(`scroll:${space}:${filter}`, { loaded, hasMore, rowCount: rows, loadingOlder: false, onLoadOlder: loadOlder })
    return <section aria-label="Threads" ref={scroll.ref} onScroll={scroll.onScroll}>
        <button onClick={() => setFilter(filter === 'all' ? 'mine' : 'all')}>{filter}</button>
    </section>
}
function geometry(height = 2000) {
    const el = screen.getByRole('region', { name: 'Threads' })
    let top = 0
    Object.defineProperties(el, {
        clientHeight: { configurable: true, value: 300 },
        scrollTop: { configurable: true, get: () => top, set: (value: number) => { top = Math.max(0, Math.min(value, height - 300)) } },
    })
    act(() => resize())
    return el
}
beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback: () => void) { resize = callback }
        observe() {}
        disconnect() {}
    })
})
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('Threads view memory', () => {
    it('restores scroll on remount and keeps separate positions for each filter', () => {
        render(<View />)
        let el = geometry()
        fireEvent.scroll(el, { target: { scrollTop: 600 } })
        fireEvent.click(screen.getByRole('button', { name: 'all' }))
        expect(el.scrollTop).toBe(0)
        fireEvent.scroll(el, { target: { scrollTop: 120 } })
        cleanup()
        render(<View />)
        el = geometry()
        expect(screen.getByRole('button', { name: 'mine' })).toBeInTheDocument()
        expect(el.scrollTop).toBe(120)
        fireEvent.click(screen.getByRole('button', { name: 'mine' }))
        expect(el.scrollTop).toBe(600)
    })
    it('keeps preferences and scroll isolated when switching spaces without remounting', () => {
        const { rerender } = render(<View />)
        const el = geometry()
        fireEvent.click(screen.getByRole('button', { name: 'all' }))
        fireEvent.scroll(el, { target: { scrollTop: 400 } })
        rerender(<View space="two" />)
        expect(screen.getByRole('button', { name: 'all' })).toBeInTheDocument()
        expect(el.scrollTop).toBe(0)
        rerender(<View space="one" />)
        expect(screen.getByRole('button', { name: 'mine' })).toBeInTheDocument()
        expect(el.scrollTop).toBe(400)
    })
    it('waits for data and fetches older pages before restoring a deep position', () => {
        localStorage.setItem('scroll:one:all', '900')
        const { rerender } = render(<View loaded={false} hasMore />)
        let el = geometry(500)
        fireEvent.scroll(el)
        expect(localStorage.getItem('scroll:one:all')).toBe('900')
        expect(loadOlder).not.toHaveBeenCalled()
        rerender(<View hasMore />)
        expect(loadOlder).toHaveBeenCalledOnce()
        fireEvent.scroll(el)
        expect(localStorage.getItem('scroll:one:all')).toBe('900')
        el = geometry(2000)
        expect(el.scrollTop).toBe(900)
        fireEvent.scroll(el, { target: { scrollTop: 700 } })
        expect(localStorage.getItem('scroll:one:all')).toBe('700')
    })
    it('keeps filtering usable when browser storage is unavailable', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
        render(<View />)
        fireEvent.click(screen.getByRole('button', { name: 'all' }))
        expect(screen.getByRole('button', { name: 'mine' })).toBeInTheDocument()
        vi.restoreAllMocks()
    })
})
