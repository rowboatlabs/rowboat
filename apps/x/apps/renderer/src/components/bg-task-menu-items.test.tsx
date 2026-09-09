import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { BgTaskMenuItems } from './bg-task-menu-items'

afterEach(cleanup)

function setup({ active = true, busy = false, updating = false, context = true } = {}) {
    const callbacks = {
        onOpen: vi.fn(), onDetails: vi.fn(), onToggleActive: vi.fn(), onRun: vi.fn(), onDelete: vi.fn(),
    }
    const contents = <BgTaskMenuItems {...callbacks} context={context} active={active} busy={busy} updating={updating} />
    if (context) {
        render(
            <table><tbody><ContextMenu>
                <ContextMenuTrigger asChild>
                    <tr><td><button onClick={callbacks.onOpen}>Task row</button></td></tr>
                </ContextMenuTrigger>
                <ContextMenuContent>{contents}</ContextMenuContent>
            </ContextMenu></tbody></table>,
        )
        fireEvent.contextMenu(screen.getByRole('button', { name: 'Task row' }), { button: 2 })
    } else {
        render(<DropdownMenu>
            <DropdownMenuTrigger>Options</DropdownMenuTrigger>
            <DropdownMenuContent>{contents}</DropdownMenuContent>
        </DropdownMenu>)
        fireEvent.keyDown(screen.getByRole('button', { name: 'Options' }), { key: 'ArrowDown' })
    }
    return callbacks
}

describe('background task menus', () => {
    it.each([true, false])('uses the same actions for context=%s', (context) => {
        setup({ context })
        expect(screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual([
            'Open task', 'View details', 'Pause', 'Run now', 'Delete task',
        ])
    })

    it.each([
        ['Open task', 'onOpen'], ['View details', 'onDetails'], ['Pause', 'onToggleActive'],
        ['Run now', 'onRun'], ['Delete task', 'onDelete'],
    ] as const)('routes %s without triggering other actions', (label, action) => {
        const callbacks = setup()
        expect(callbacks.onOpen).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('menuitem', { name: label }))
        for (const [name, callback] of Object.entries(callbacks)) {
            expect(callback).toHaveBeenCalledTimes(name === action ? 1 : 0)
        }
    })

    it('offers Resume and manual Run now for a paused task', () => {
        const { onToggleActive } = setup({ active: false })
        expect(screen.queryByRole('menuitem', { name: 'Pause' })).toBeNull()
        expect(screen.getByRole('menuitem', { name: 'Run now' })).not.toHaveAttribute('aria-disabled')
        fireEvent.click(screen.getByRole('menuitem', { name: 'Resume' }))
        expect(onToggleActive).toHaveBeenCalledTimes(1)
    })

    it.each([{ busy: true }, { updating: true }])('disables conflicting actions for %j', (state) => {
        const { onToggleActive, onRun } = setup(state)
        for (const name of ['Pause', 'Run now']) {
            const item = screen.getByRole('menuitem', { name })
            expect(item).toHaveAttribute('aria-disabled', 'true')
            fireEvent.click(item)
        }
        expect(onToggleActive).not.toHaveBeenCalled()
        expect(onRun).not.toHaveBeenCalled()
        expect(screen.getByRole('menuitem', { name: 'View details' })).not.toHaveAttribute('aria-disabled')
    })
})
