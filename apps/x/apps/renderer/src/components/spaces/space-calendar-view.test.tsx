import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type React from 'react'

// The grid library is stubbed: it draws nothing a test could read in jsdom,
// and what matters here is what the view hands it and does with what it
// hands back. The stub draws each event as a button and keeps the props, so
// a test can drag, stretch and select by calling them.
const grid = vi.hoisted(() => {
    const held = { props: {} as Record<string, unknown>, keep: (props: Record<string, unknown>) => { held.props = props } }
    return held
})
vi.mock('@fullcalendar/react', async () => {
    const { forwardRef, useImperativeHandle } = await import('react')
    const api = { today: vi.fn(), prev: vi.fn(), next: vi.fn(), changeView: vi.fn(), gotoDate: vi.fn(), unselect: vi.fn(), getDate: () => new Date(2026, 11, 1) }
    return {
        default: forwardRef(function FullCalendarStub(props: Record<string, unknown>, ref) {
            grid.keep({ ...props, api })
            useImperativeHandle(ref, () => ({ getApi: () => api }))
            const events = props.events as Array<{ id: string; title: string; start: string; end: string; allDay: boolean; extendedProps: unknown }>
            return (
                <div data-testid="grid">
                    {events.map((event) => (
                        <button key={event.id} type="button" onClick={(e) => (props.eventClick as (info: unknown) => void)({
                            event: { ...event, start: new Date(event.start), end: new Date(event.end) }, el: e.currentTarget, jsEvent: e, view: {},
                        })}>{event.title} @ {event.start}</button>
                    ))}
                </div>
            )
        }),
    }
})
vi.mock('@fullcalendar/react/daygrid', () => ({ default: {} }))
vi.mock('@fullcalendar/react/timegrid', () => ({ default: {} }))
vi.mock('@fullcalendar/react/interaction', () => ({ default: {} }))
vi.mock('@fullcalendar/react/themes/classic', () => ({ default: {} }))
vi.mock('@fullcalendar/react/skeleton.css', () => ({}))
vi.mock('@fullcalendar/react/themes/classic/theme.css', () => ({}))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
vi.mock('@/lib/spaces-feed', () => ({ subscribeSpacesFeed: () => () => {} }))
vi.mock('@/hooks/use-spaces', () => ({ useSpaceLive: () => {} }))
vi.mock('@/lib/spaces-access', () => ({ canActInSpace: () => true, isSpaceArchived: () => false }))

import { toast } from '@/lib/toast'
import { resetCalendarStore } from '@/lib/spaces-calendar'
import { SpaceMembersProvider } from './member-text'
import { SpaceCalendarView } from './space-calendar-view'

// The Calendar tab (2026-11-28): what it reads, draws and writes.

const names = new Map([['arjun', 'Arjun'], ['tushar', 'Tushar'], ['pm', 'OSS PM']])
const members = [...names].map(([id, displayName]) => ({ id, displayName, kind: id === 'pm' ? 'agent' : 'human', role: 'member' }) as spaces.Member)
const space = { id: 'S1', name: 'oss', kind: 'shared' } as spaces.Space
const at = (day: number, hour: number, minute = 0) => new Date(2026, 11, day, hour, minute)
const entry = (patch: Partial<spaces.CalendarEntry> = {}): spaces.CalendarEntry => ({
    id: '01HZZZZZZZZZZZZZZZZZZZZZZA', spaceId: 'S1', title: 'Roadmap review', allDay: false,
    start: at(1, 15).toISOString(), end: at(1, 16).toISOString(), timeZone: 'UTC', attendees: ['arjun', 'tushar'],
    createdBy: { memberId: 'tushar', actingMode: 'direct' }, createdAt: '2026-11-28T10:00:00.000Z', ...patch,
})

let listed: spaces.CalendarEntry[]
const invoke = vi.fn(async (channel: string, args: Record<string, unknown>): Promise<unknown> => {
    if (channel === 'spaces:listCalendar') return { entries: listed, occurrences: [] }
    if (channel === 'spaces:updateCalendarEntry') return { entry: { ...listed[0]!, ...args, updatedAt: new Date().toISOString() }, message: { id: 'M9' } }
    if (channel === 'spaces:createCalendarEntry') return { entry: entry({ id: '01HZZZZZZZZZZZZZZZZZZZZZZN', title: String(args.title), start: String(args.start), end: String(args.end) }) }
    if (channel === 'spaces:deleteCalendarEntry') return { entry: { ...listed[0]!, deletedAt: new Date().toISOString() } }
    if (channel === 'spaces:postMessage') return { message: { id: 'M2', threadRoot: 'ROOT' } }
    throw new Error(`unexpected ${channel}`)
})
const calls = (channel: string) => invoke.mock.calls.filter(([c]) => c === channel).map(([, args]) => args)

const onOpenThread = vi.fn()
async function mount(props: Partial<Parameters<typeof SpaceCalendarView>[0]> = {}) {
    render(
        <SpaceMembersProvider members={names}>
            <SpaceCalendarView orgId="org" space={space} spaceLabel="#oss" members={members} selfMemberId="arjun" writable onOpenThread={onOpenThread} {...props} />
        </SpaceMembersProvider>,
    )
    // The grid says which dates it shows; the view asks Harbor for them.
    act(() => (grid.props.datesSet as (info: unknown) => void)({ start: at(1, 0), end: at(8, 0), view: { title: 'December 2026' } }))
    await waitFor(() => expect(calls('spaces:listCalendar')).toHaveLength(1))
}

afterEach(cleanup)
beforeEach(() => {
    resetCalendarStore()
    localStorage.clear()
    // Radix measures the dialog's switch and select with a ResizeObserver, which jsdom does not have.
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
    invoke.mockClear()
    onOpenThread.mockClear()
    vi.mocked(toast).mockClear()
    listed = [entry()]
    ;(window as unknown as { ipc: unknown }).ipc = { invoke, on: () => () => {} }
})

describe('the Calendar tab', () => {
    it('asks for the dates the grid shows and draws what is planned in them', async () => {
        listed = [entry(), entry({ id: '01HZZZZZZZZZZZZZZZZZZZZZZB', title: 'Triage', start: at(1, 9).toISOString(), end: at(1, 9, 30).toISOString(), recurrence: { freq: 'daily', interval: 1 } })]
        await mount()
        expect(calls('spaces:listCalendar')[0]).toEqual({ orgId: 'org', spaceId: 'S1', from: at(1, 0).toISOString(), to: at(8, 0).toISOString() })
        expect(await screen.findByRole('heading', { name: 'December 2026' })).toBeInTheDocument()
        expect(await screen.findAllByRole('button', { name: /^Triage @/ })).toHaveLength(7)
        expect(screen.getAllByRole('button', { name: /^Roadmap review @/ })).toHaveLength(1)
    })

    it('a click on an event shows what it is, who added it, and opens its thread', async () => {
        listed = [entry({ threadRoot: 'ROOT' })]
        await mount()
        fireEvent.click(await screen.findByRole('button', { name: /^Roadmap review @/ }))
        expect(await screen.findByText('Added by Tushar')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Open thread' }))
        expect(onOpenThread).toHaveBeenCalledWith('ROOT')
    })

    it('an event with no thread takes a first update, which starts it and opens it', async () => {
        await mount()
        fireEvent.click(await screen.findByRole('button', { name: /^Roadmap review @/ }))
        fireEvent.change(await screen.findByLabelText('Post an update'), { target: { value: 'moved to the big room' } })
        fireEvent.click(screen.getByRole('button', { name: 'Post' }))
        await waitFor(() => expect(onOpenThread).toHaveBeenCalledWith('ROOT'))
        expect(calls('spaces:postMessage')[0]).toEqual({ orgId: 'org', spaceId: 'S1', calendarEntryId: listed[0]!.id, body: 'moved to the big room' })
    })

    it('dragging a block moves the entry and says Harbor told the people it tags; a refusal puts the block back', async () => {
        await mount()
        const revert = vi.fn()
        const drop = (to: Date) => (grid.props.eventDrop as (info: unknown) => void)({
            event: { start: to, end: new Date(to.getTime() + 3_600_000), allDay: false, extendedProps: { entry: listed[0] } },
            oldEvent: { start: at(1, 15), end: at(1, 16), allDay: false, extendedProps: { entry: listed[0] } },
            revert,
        })
        act(() => drop(at(2, 16)))
        await waitFor(() => expect(toast).toHaveBeenCalledWith('Event moved · posted in #oss', 'success'))
        expect(calls('spaces:updateCalendarEntry')[0]).toEqual({ orgId: 'org', spaceId: 'S1', entryId: listed[0]!.id, start: at(2, 16).toISOString(), end: at(2, 17).toISOString() })
        expect(revert).not.toHaveBeenCalled()

        invoke.mockImplementationOnce(async () => { throw new Error('This space is archived') })
        act(() => drop(at(3, 10)))
        await waitFor(() => expect(revert).toHaveBeenCalled())
        expect(toast).toHaveBeenCalledWith('This space is archived', 'error')
    })

    it('a stretch selected on the grid opens a new event over it; a day clicked in the month starts at nine', async () => {
        await mount()
        act(() => (grid.props.select as (info: unknown) => void)({ start: at(3, 14), end: at(3, 15, 30), allDay: false, view: { type: 'timeGridWeek' } }))
        expect(await screen.findByRole('dialog', { name: 'New event' })).toBeInTheDocument()
        expect(screen.getByLabelText('Start time')).toHaveValue('14:00')
        expect(screen.getByLabelText('End time')).toHaveValue('15:30')
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Planning' } })
        fireEvent.click(screen.getByRole('button', { name: 'Create' }))
        await waitFor(() => expect(calls('spaces:createCalendarEntry')).toHaveLength(1))
        expect(calls('spaces:createCalendarEntry')[0]).toMatchObject({ title: 'Planning', allDay: false, start: at(3, 14).toISOString(), end: at(3, 15, 30).toISOString(), attendees: ['arjun'] })
        expect(calls('spaces:createCalendarEntry')[0]).toHaveProperty('timeZone')
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

        act(() => (grid.props.select as (info: unknown) => void)({ start: at(5, 0), end: at(6, 0), allDay: true, view: { type: 'dayGridMonth' } }))
        expect(await screen.findByLabelText('Start time')).toHaveValue('09:00')
        expect(screen.getByLabelText('Start date')).toHaveValue('2026-12-05')
    })

    it('draws the stretch being selected, which has no event behind it yet, as its times alone', async () => {
        await mount()
        const draw = grid.props.eventContent as (info: unknown) => React.ReactElement
        const { container } = render(draw({ event: { title: '', start: at(3, 14), end: at(3, 15), allDay: false, extendedProps: {} }, isStart: true, isMirror: true }))
        expect(container).toHaveTextContent('2 PM – 3 PM')
    })

    it('remembers the view chosen', async () => {
        await mount()
        fireEvent.click(screen.getByRole('button', { name: 'Week' }))
        expect((grid.props.api as { changeView: ReturnType<typeof vi.fn> }).changeView).toHaveBeenCalledWith('timeGridWeek')
        cleanup()
        invoke.mockClear()
        await mount()
        expect(grid.props.initialView).toBe('timeGridWeek')
    })

    it('is read-only for someone who cannot write here: no new event, no dragging, no edit', async () => {
        listed = [entry({ threadRoot: 'ROOT' })]
        await mount({ writable: false })
        expect(screen.queryByRole('button', { name: 'New event' })).not.toBeInTheDocument()
        expect(grid.props.editable).toBe(false)
        expect(grid.props.selectable).toBe(false)
        fireEvent.click(await screen.findByRole('button', { name: /^Roadmap review @/ }))
        expect(await screen.findByRole('button', { name: 'Open thread' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    })
})
