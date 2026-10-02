import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpaceRailSections } from './space-rail-sections'

vi.mock('@/hooks/use-space-chat', () => ({ useSpacesUnreadCounts: () => new Map() }))
vi.mock('./recent-activity', () => ({ RecentActivity: ({ active }: { active: boolean }) => <div>Events {active ? 'live' : 'paused'}</div> }))
beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('Activity rail panel', () => {
    it('collapses from the title, keeps navigation visible, and opens the full view only from the arrow', () => {
        const open = vi.fn()
        const view = render(<SpaceRailSections orgId="org" onOpenMessage={vi.fn()} onOpenActivity={open}>Spaces and DMs</SpaceRailSections>)
        fireEvent.click(screen.getByRole('button', { name: 'Activity' }))
        expect(screen.getByRole('button', { name: 'Activity' })).toHaveAttribute('aria-expanded', 'false')
        expect(screen.getByText('Events paused')).not.toBeVisible()
        expect(screen.getByText('Spaces and DMs')).toBeVisible()
        expect(open).not.toHaveBeenCalled()
        expect(localStorage.getItem('spaces:activityRailCollapsed')).toBe('["activity"]')
        fireEvent.click(screen.getByRole('button', { name: 'Open Activity' }))
        expect(open).toHaveBeenCalledWith('org')
        view.unmount()
        render(<SpaceRailSections orgId="org" onOpenMessage={vi.fn()} onOpenActivity={open}>Spaces and DMs</SpaceRailSections>)
        expect(screen.getByRole('button', { name: 'Activity' })).toHaveAttribute('aria-expanded', 'false')
        fireEvent.click(screen.getByRole('button', { name: 'Activity' }))
        expect(screen.getByText('Events live')).toBeVisible()
        expect(screen.getByTitle('Drag to resize')).toBeVisible()
    })
})
