import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NotificationMenu } from './notification-menu'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'

afterEach(() => { cleanup(); vi.useRealTimers() })
function pointer(element: Element, type: string) {
    const event = new MouseEvent(type, { bubbles: true })
    Object.defineProperty(event, 'pointerType', { value: 'mouse' })
    fireEvent(element, event)
}
it('keeps the submenu open across the gap and closes when the pointer leaves', () => {
    vi.useFakeTimers()
    render(<NotificationMenu paused={false}><DropdownMenuItem>30 minutes</DropdownMenuItem></NotificationMenu>)
    const trigger = screen.getByRole('button', { name: 'Notifications' })
    pointer(trigger, 'pointerover')
    const menu = screen.getByRole('menu')
    pointer(trigger, 'pointerout')
    act(() => vi.advanceTimersByTime(50))
    pointer(menu, 'pointerover')
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByRole('menu')).toBeVisible()
    pointer(menu, 'pointerout')
    act(() => vi.advanceTimersByTime(150))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})
it('closes when the window loses focus', () => {
    render(<NotificationMenu paused={false}><DropdownMenuItem>30 minutes</DropdownMenuItem></NotificationMenu>)
    pointer(screen.getByRole('button', { name: 'Notifications' }), 'pointerover')
    expect(screen.getByRole('menu')).toBeVisible()
    fireEvent(window, new Event('blur'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})
