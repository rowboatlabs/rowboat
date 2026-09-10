import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SecondaryRailDivider, SecondaryRailSectionHeader } from './secondary-rail-section'
import { useSecondaryRailSections } from '@/hooks/use-secondary-rail-sections'

beforeEach(() => localStorage.clear())
afterEach(cleanup)
function Sections({ prefix = 'spaces' }: { prefix?: string }) {
    const panes = useSecondaryRailSections({ collapsedKey: `${prefix}:railCollapsed`, heightKey: `${prefix}:filesHeight` })
    return <div ref={panes.bodyRef} data-testid="body">
        <section style={panes.topStyle} data-testid="navigation">
            <SecondaryRailSectionHeader label="Navigation" collapsed={panes.topCollapsed} count={2} onToggle={panes.toggleTop} />
            {!panes.topCollapsed && <span>Conversations</span>}
        </section>
        <section ref={panes.bottomRef} style={panes.bottomStyle} data-testid="files">
            <SecondaryRailDivider {...panes.dividerProps} />
            <SecondaryRailSectionHeader label="Files" collapsed={panes.bottomCollapsed} count={1} onToggle={panes.toggleBottom} />
            {!panes.bottomCollapsed && <span>report.md</span>}
        </section>
    </div>
}
describe('shared rail sections', () => {
    it('retains existing Spaces collapsed preferences without affecting Projects', () => {
        localStorage.setItem('spaces:railCollapsed', '["files"]')
        const view = render(<Sections />)
        expect(screen.queryByText('report.md')).toBeNull()
        expect(screen.getByTitle('Show files')).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByTitle('Drag to resize')).toBeNull()
        view.unmount()
        render(<Sections prefix="projects" />)
        expect(screen.getByText('report.md')).toBeVisible()
        expect(screen.getByTitle('Drag to resize')).toBeVisible()
    })
    it('hands the available height to the open pane and persists collapse changes', () => {
        render(<Sections />)
        fireEvent.click(screen.getByRole('button', { name: 'Navigation' }))
        expect(screen.queryByText('Conversations')).toBeNull()
        expect(screen.getByTestId('files').style.flex).toBe('1 1 0%')
        expect(localStorage.getItem('spaces:railCollapsed')).toBe('["navigation"]')
    })
    it('restores and updates the same persisted Files height when resized', () => {
        localStorage.setItem('spaces:filesHeight', '240')
        render(<Sections />)
        const files = screen.getByTestId('files')
        expect(files.style.flexBasis).toBe('240px')
        Object.defineProperty(files, 'clientHeight', { value: 240 })
        Object.defineProperty(screen.getByTestId('body'), 'clientHeight', { value: 800 })
        fireEvent.mouseDown(screen.getByTitle('Drag to resize'), { clientY: 500 })
        fireEvent.mouseMove(window, { clientY: 440 })
        fireEvent.mouseUp(window)
        expect(files.style.flexBasis).toBe('300px')
        expect(localStorage.getItem('spaces:filesHeight')).toBe('300')
    })
    it('removes an unfinished drag listener when unmounted', () => {
        const view = render(<Sections />)
        fireEvent.mouseDown(screen.getByTitle('Drag to resize'), { clientY: 400 })
        view.unmount()
        fireEvent.mouseMove(window, { clientY: 100 })
        fireEvent.mouseUp(window)
        expect(localStorage.getItem('spaces:filesHeight')).toBeNull()
    })
})
