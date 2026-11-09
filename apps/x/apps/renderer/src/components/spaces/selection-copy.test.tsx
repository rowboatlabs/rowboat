import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import { SelectionCopy } from './selection-copy'

// Hovering a link in a message offers "Copy link" (2026-11-06): the message
// menu copies the message or its link, never a link inside it.

function setup() {
    render(
        <>
            <SelectionCopy />
            <div className="group/msg">
                <a href="https://example.com/a">example</a>
                <span>plain</span>
            </div>
            <a href="https://outside.example">outside</a>
        </>,
    )
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('SelectionCopy link hover', () => {
    it('shows Copy link after a dwell and copies the href', async () => {
        const writeText = vi.fn(async () => {})
        vi.stubGlobal('navigator', { clipboard: { writeText } })
        setup()
        fireEvent.mouseOver(screen.getByText('example'))
        expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull()
        act(() => { vi.advanceTimersByTime(300) })
        fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
        expect(writeText).toHaveBeenCalledWith('https://example.com/a')
    })

    it('stays while the pointer crosses to the chip, and hides after leaving', () => {
        setup()
        const link = screen.getByText('example')
        fireEvent.mouseOver(link)
        act(() => { vi.advanceTimersByTime(300) })
        const chip = screen.getByRole('button', { name: 'Copy link' })
        fireEvent.mouseOut(link, { relatedTarget: chip })
        fireEvent.mouseEnter(chip)
        act(() => { vi.advanceTimersByTime(1000) })
        expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
        fireEvent.mouseLeave(chip)
        act(() => { vi.advanceTimersByTime(300) })
        expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull()
    })

    it('ignores links outside message rows', () => {
        setup()
        fireEvent.mouseOver(screen.getByText('outside'))
        act(() => { vi.advanceTimersByTime(300) })
        expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull()
    })
})
