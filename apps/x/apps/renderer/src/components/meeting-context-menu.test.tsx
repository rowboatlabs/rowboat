import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { MeetingEventContextMenu, MeetingNoteContextMenu } from './meeting-context-menu'
import { toast } from '@/lib/toast'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
  else Reflect.deleteProperty(navigator, 'clipboard')
})

function clipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  return writeText
}

function eventMenu({ links = true, captureDisabled = false } = {}) {
  const onCapture = vi.fn()
  render(<Popover>
    <MeetingEventContextMenu
      conferenceLink={links ? 'https://meet.google.com/example' : null}
      calendarLink={links ? 'https://calendar.google.com/event' : null}
      captureDisabled={captureDisabled}
      onCapture={onCapture}
    >
      <PopoverTrigger asChild><button>Meeting</button></PopoverTrigger>
    </MeetingEventContextMenu>
    <PopoverContent>Meeting details</PopoverContent>
  </Popover>)
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Meeting' }), { button: 2 })
  return onCapture
}

describe('meeting context menus', () => {
  it.each([['Join & take notes', true], ['Take notes', false]] as const)('routes %s without opening the details popover', (name, openConference) => {
    const onCapture = eventMenu()
    expect(screen.queryByText('Meeting details')).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name }))
    expect(onCapture).toHaveBeenCalledExactlyOnceWith(openConference)
    expect(screen.queryByText('Meeting details')).toBeNull()
  })

  it('omits link actions for an event without links', () => {
    eventMenu({ links: false })
    expect(screen.getAllByRole('menuitem')).toHaveLength(1)
    expect(screen.getByRole('menuitem', { name: 'Take notes' })).toBeTruthy()
  })

  it('disables capture while busy but keeps links usable', () => {
    const onCapture = eventMenu({ captureDisabled: true })
    for (const name of ['Join & take notes', 'Take notes']) {
      const item = screen.getByRole('menuitem', { name })
      expect(item).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(item)
    }
    expect(onCapture).not.toHaveBeenCalled()
    expect(screen.getByRole('menuitem', { name: 'Open in Google Calendar' })).not.toHaveAttribute('aria-disabled')
  })

  it('opens the event calendar URL', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    eventMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in Google Calendar' }))
    expect(open).toHaveBeenCalledExactlyOnceWith('https://calendar.google.com/event', '_blank')
  })

  it('copies the conference URL', async () => {
    const writeText = clipboard()
    eventMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy meeting link' }))
    expect(writeText).toHaveBeenCalledExactlyOnceWith('https://meet.google.com/example')
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Copied to clipboard', 'success'))
  })

  it.each(['Open note', 'Copy path'])('supports %s on saved note table rows', (name) => {
    const onOpen = vi.fn()
    const writeText = clipboard()
    const path = 'knowledge/Meetings/2026-09-08/Standup.md'
    render(<table><tbody><MeetingNoteContextMenu path={path} onOpen={onOpen}>
      <tr><td><button onClick={onOpen}>Standup</button></td></tr>
    </MeetingNoteContextMenu></tbody></table>)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Standup' }), { button: 2 })
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('menuitem', { name }))
    if (name === 'Copy path') {
      expect(writeText).toHaveBeenCalledExactlyOnceWith(path)
      expect(onOpen).not.toHaveBeenCalled()
    } else {
      expect(onOpen).toHaveBeenCalledTimes(1)
      expect(writeText).not.toHaveBeenCalled()
    }
  })
})
