import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThreadResizeHandle } from './thread-resize-handle'

afterEach(cleanup)

describe('thread pane resizing', () => {
    it('grows to the left, respects both pane limits, and commits on release', () => {
        const onResize = vi.fn()
        const onCommit = vi.fn()
        render(<ThreadResizeHandle width={400} maxWidth={600} onResize={onResize} onCommit={onCommit} />)
        const handle = screen.getByRole('separator', { name: 'Resize thread pane' })
        handle.setPointerCapture = vi.fn()
        fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 700 })
        fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 })
        expect(onResize).toHaveBeenLastCalledWith(500)
        fireEvent.pointerMove(handle, { pointerId: 1, clientX: 0 })
        expect(onResize).toHaveBeenLastCalledWith(600)
        fireEvent.pointerMove(handle, { pointerId: 1, clientX: 1000 })
        expect(onResize).toHaveBeenLastCalledWith(360)
        expect(onCommit).not.toHaveBeenCalled()
        fireEvent.pointerUp(handle, { pointerId: 1 })
        expect(onCommit).toHaveBeenCalledExactlyOnceWith(360)
        fireEvent.lostPointerCapture(handle, { pointerId: 1 })
        expect(onCommit).toHaveBeenCalledTimes(1)
    })

    it('supports keyboard adjustments and exposes the current width', () => {
        const onResize = vi.fn()
        const onCommit = vi.fn()
        render(<ThreadResizeHandle width={400} maxWidth={600} onResize={onResize} onCommit={onCommit} />)
        const handle = screen.getByRole('separator')
        expect(handle).toHaveAttribute('aria-valuenow', '400')
        fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true })
        expect(onCommit).toHaveBeenLastCalledWith(440)
        fireEvent.keyDown(handle, { key: 'ArrowRight' })
        expect(onCommit).toHaveBeenLastCalledWith(390)
        fireEvent.keyDown(handle, { key: 'Home' })
        expect(onCommit).toHaveBeenLastCalledWith(360)
        fireEvent.keyDown(handle, { key: 'End' })
        expect(onCommit).toHaveBeenLastCalledWith(600)
    })

    it('resets to the default without exceeding the space available', () => {
        const onResize = vi.fn()
        const onCommit = vi.fn()
        render(<ThreadResizeHandle width={360} maxWidth={394} onResize={onResize} onCommit={onCommit} />)
        fireEvent.doubleClick(screen.getByRole('separator'))
        expect(onResize).toHaveBeenCalledWith(394)
        expect(onCommit).toHaveBeenCalledWith(394)
    })
})
