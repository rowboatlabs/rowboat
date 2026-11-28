import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import { CalendarEventDialog } from './calendar-event-dialog'
import { draftForRange, draftFromEntry, type EventDraft } from '@/lib/spaces-calendar'

// Creating and changing a calendar event (2026-11-28).

const member = (id: string, displayName: string, kind: 'human' | 'agent' = 'human'): spaces.Member => ({ id, displayName, kind, role: 'member' } as spaces.Member)
const members = [member('arjun', 'Arjun'), member('tushar', 'Tushar'), member('pm', 'OSS PM', 'agent')]
const fresh = (): EventDraft => draftForRange(new Date(2026, 11, 1, 9, 0), new Date(2026, 11, 1, 10, 0), false, 'arjun')

afterEach(cleanup)
// Radix measures its switch and select with a ResizeObserver, which jsdom does not have.
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} }) })

function mount(props: Partial<Parameters<typeof CalendarEventDialog>[0]> = {}) {
    const onSave = vi.fn<(draft: EventDraft) => Promise<void>>(async () => {})
    const onClose = vi.fn()
    render(<CalendarEventDialog orgId="org" spaceLabel="#oss" members={members} selfMemberId="arjun" initial={fresh()} onClose={onClose} onSave={onSave} {...props} />)
    return { onSave, onClose }
}

describe('the event dialog', () => {
    it('needs a title, then saves what was typed and closes', async () => {
        const { onSave, onClose } = mount()
        expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Triage sync' } })
        fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'New issues' } })
        fireEvent.click(screen.getByRole('button', { name: 'Create' }))
        await waitFor(() => expect(onClose).toHaveBeenCalled())
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Triage sync', description: 'New issues', startDate: '2026-12-01', startTime: '09:00', endTime: '10:00', attendees: ['arjun'] }))
    })

    it('says who will be told only when someone other than you is tagged, and that nothing is sent at the start', () => {
        mount()
        expect(screen.queryByText(/will get a message/)).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Add people or agents' }))
        fireEvent.click(screen.getByRole('option', { name: /OSS PM/ }))
        expect(screen.getByText(/OSS PM will get a message in #oss about this event\. Nothing is sent when the event starts\./)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('option', { name: /Tushar/ }))
        expect(screen.getByText(/OSS PM and Tushar will get a message/)).toBeInTheDocument()
    })

    it('moving the start keeps the length, and an end before the start cannot be saved', () => {
        mount()
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'x' } })
        fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-12-04' } })
        expect(screen.getByLabelText('End date')).toHaveValue('2026-12-04')
        fireEvent.change(screen.getByLabelText('End time'), { target: { value: '08:00' } })
        expect(screen.getByRole('alert')).toHaveTextContent('The end must be after the start')
        expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    })

    it('all day hides the times; a repeat offers an end date', () => {
        mount()
        fireEvent.click(screen.getByRole('switch', { name: 'All day' }))
        expect(screen.queryByLabelText('Start time')).not.toBeInTheDocument()
        expect(screen.queryByLabelText('Repeat until')).not.toBeInTheDocument()
    })

    it('keeps the dialog and what was typed when saving fails', async () => {
        const onSave = vi.fn(async () => { throw new Error('tushar is not a member of this space') })
        const { onClose } = mount({ onSave })
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Triage sync' } })
        fireEvent.click(screen.getByRole('button', { name: 'Create' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('not a member of this space')
        expect(onClose).not.toHaveBeenCalled()
        expect(screen.getByLabelText('Title')).toHaveValue('Triage sync')
    })

    it('editing asks before deleting, and says a repeat goes whole', async () => {
        const editing: spaces.CalendarEntry = {
            id: '01HZZZZZZZZZZZZZZZZZZZZZZA', spaceId: 'S1', title: 'Weekly triage', allDay: false,
            start: new Date(2026, 11, 1, 9, 0).toISOString(), end: new Date(2026, 11, 1, 9, 30).toISOString(), timeZone: 'UTC',
            recurrence: { freq: 'weekly', interval: 1 }, attendees: ['arjun', 'pm'],
            createdBy: { memberId: 'arjun', actingMode: 'direct' }, createdAt: '2026-11-28T10:00:00.000Z',
        }
        const onDelete = vi.fn(async () => {})
        const { onClose } = mount({ initial: draftFromEntry(editing), editing, onDelete })
        expect(screen.getByLabelText('Title')).toHaveValue('Weekly triage')
        expect(screen.getByText(/OSS PM will get a message in #oss if the time changes or they are newly added/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
        expect(onDelete).not.toHaveBeenCalled()
        expect(screen.getByText('Delete every occurrence?')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
        await waitFor(() => expect(onClose).toHaveBeenCalled())
        expect(onDelete).toHaveBeenCalledTimes(1)
    })
})
