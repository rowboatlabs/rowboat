import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSidebarShortcut } from './use-sidebar-shortcut'

afterEach(cleanup)

function Harness({ enabled, toggle }: { enabled: boolean; toggle: () => void }) {
    useSidebarShortcut(enabled, toggle)
    return <div><textarea aria-label="plain" /><div aria-label="rich" contentEditable suppressContentEditableWarning /></div>
}

describe('useSidebarShortcut', () => {
    it('⌘B and Ctrl+B toggle; other chords do not', () => {
        const toggle = vi.fn()
        render(<Harness enabled toggle={toggle} />)
        fireEvent.keyDown(document.body, { key: 'b', metaKey: true })
        fireEvent.keyDown(document.body, { key: 'B', ctrlKey: true })
        fireEvent.keyDown(document.body, { key: 'b', metaKey: true, shiftKey: true })
        fireEvent.keyDown(document.body, { key: 'b' })
        expect(toggle).toHaveBeenCalledTimes(2)
    })

    it('works from a plain textarea, leaves rich text its bold', () => {
        const toggle = vi.fn()
        const { getByLabelText } = render(<Harness enabled toggle={toggle} />)
        fireEvent.keyDown(getByLabelText('plain'), { key: 'b', metaKey: true })
        const rich = getByLabelText('rich')
        Object.defineProperty(rich, 'isContentEditable', { value: true })
        fireEvent.keyDown(rich, { key: 'b', metaKey: true })
        expect(toggle).toHaveBeenCalledTimes(1)
    })

    it('does nothing while disabled', () => {
        const toggle = vi.fn()
        render(<Harness enabled={false} toggle={toggle} />)
        fireEvent.keyDown(document.body, { key: 'b', metaKey: true })
        expect(toggle).not.toHaveBeenCalled()
    })
})
