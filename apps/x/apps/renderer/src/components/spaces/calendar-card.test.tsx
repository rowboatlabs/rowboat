import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'

vi.mock('@/lib/spaces-feed', () => ({ subscribeSpacesFeed: () => () => {} }))

import { CalendarCard } from './calendar-card'
import { SpaceMembersProvider } from './member-text'
import { SpaceNavContext, SpaceRefsProvider } from './space-nav'
import { noteCalendarEntries, resetCalendarStore } from '@/lib/spaces-calendar'

// A calendar event's card on its message (2026-11-28).

const names = new Map([['arjun', 'Arjun'], ['pm', 'OSS PM']])
const start = new Date(2026, 11, 1, 9, 0)
const entry: spaces.CalendarEntry = {
    id: '01HZZZZZZZZZZZZZZZZZZZZZZA',
    spaceId: 'S1',
    title: 'Weekly triage',
    description: 'Go through new issues',
    allDay: false,
    start: start.toISOString(),
    end: new Date(2026, 11, 1, 9, 30).toISOString(),
    timeZone: 'UTC',
    recurrence: { freq: 'weekly', interval: 1 },
    attendees: ['arjun', 'pm'],
    createdBy: { memberId: 'arjun', actingMode: 'direct' },
    createdAt: '2026-11-28T10:00:00.000Z',
}

const onOpenCalendar = vi.fn()
function mount(posted: spaces.CalendarEntry = entry) {
    return render(
        <SpaceMembersProvider members={names}>
            <SpaceRefsProvider refs={{ orgId: 'org', orgAddress: 'org.test', spaceId: 'S1' }}>
                <SpaceNavContext.Provider value={{ onOpenFile: () => {}, onOpenCalendar }}>
                    <CalendarCard entry={posted} />
                </SpaceNavContext.Provider>
            </SpaceRefsProvider>
        </SpaceMembersProvider>,
    )
}

afterEach(cleanup)
beforeEach(() => {
    resetCalendarStore()
    onOpenCalendar.mockClear()
})

describe('the calendar card', () => {
    it('shows the event: its day, title, time on the reader’s clock, repeat, description and who it is for', () => {
        mount()
        expect(screen.getByText('Weekly triage')).toBeInTheDocument()
        expect(screen.getByText(/Tue, Dec 1, 9:00 – 9:30 AM/)).toBeInTheDocument()
        expect(screen.getByText(/Repeats weekly on Tue/)).toBeInTheDocument()
        expect(screen.getByText('Go through new issues')).toBeInTheDocument()
        expect(screen.getByRole('list', { name: 'For' })).toHaveTextContent('Arjun')
        expect(screen.getByRole('list', { name: 'For' })).toHaveTextContent('OSS PM')
    })

    it('follows the entry as it changes: a card posted before a move shows the new time', () => {
        mount()
        const moved = { ...entry, start: new Date(2026, 11, 3, 14, 0).toISOString(), end: new Date(2026, 11, 3, 15, 0).toISOString(), updatedAt: '2026-11-28T11:00:00.000Z' }
        act(() => noteCalendarEntries('org', 'S1', [moved]))
        expect(screen.getByText(/Thu, Dec 3, 2:00 – 3:00 PM/)).toBeInTheDocument()
    })

    it('opens the calendar on its event, which the calendar then knows', () => {
        mount()
        fireEvent.click(screen.getByRole('button', { name: 'Open in calendar' }))
        expect(onOpenCalendar).toHaveBeenCalledWith(entry.id)
    })

    it('says a deleted event was cancelled, and offers nowhere to go', () => {
        mount({ ...entry, deletedAt: '2026-11-28T12:00:00.000Z' })
        expect(screen.getByText(/Cancelled/)).toBeInTheDocument()
        expect(screen.queryByText(/Repeats/)).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Open in calendar' })).not.toBeInTheDocument()
    })
})
