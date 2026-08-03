import { useEffect, useState } from 'react'
import { ChevronLeft, Clock, ExternalLink, FileText, Loader2, MapPin, Mic, Pencil, Trash2, UserRound, UsersRound, Video, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { PopoverContent } from '@/components/ui/popover'
import {
  attendeeLabel,
  formatEventDetailTime,
  localDateKey,
  parseDescriptionParts,
  personLabel,
  triggerMeetingCapture,
  type UpcomingEvent,
} from '@/lib/calendar-events'
import { findMeetingNoteForEvent } from '@/lib/meeting-note-match'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { useCalendarWriteAccess } from '@/hooks/use-calendar-write'
import { composeDateTime, toTimeInputValue } from './quick-create'

type RsvpAnswer = 'yes' | 'no' | 'maybe'

const RSVP_TO_API = { yes: 'accepted', no: 'declined', maybe: 'tentative' } as const

function currentRsvp(event: UpcomingEvent): RsvpAnswer | null {
  switch (event.attendees.find((a) => a.self)?.responseStatus) {
    case 'accepted': return 'yes'
    case 'declined': return 'no'
    case 'tentative': return 'maybe'
    default: return null
  }
}

function writeFailureToast(result: { error?: string; needsReconnect?: boolean }, fallback: string) {
  if (result.needsReconnect) {
    toast(result.error ?? 'Reconnect Google in Settings to make calendar changes.', 'info')
  } else {
    toast(result.error ?? fallback, 'error')
  }
}

// The popover body on its own so other surfaces (e.g. the month grid's
// "+N more" popover) can swap it in without nesting popovers. `onBack`
// renders a back chevron in the header for that flow; `onOpenNote` enables
// the "View meeting notes" action on past events.
export function EventDetailsContent({ event, onClose, onBack, onOpenNote }: {
  event: UpcomingEvent
  onClose: () => void
  onBack?: () => void
  onOpenNote?: (path: string) => void
}) {
  const organizer = personLabel(event.organizer) ?? personLabel(event.creator)
  const attendees = event.attendees.map(attendeeLabel).filter((label): label is string => Boolean(label))
  const descriptionParts = event.description ? parseDescriptionParts(event.description) : []
  const handleMeetingCapture = (openConference: boolean) => {
    onClose()
    triggerMeetingCapture(event, openConference)
  }

  const canWrite = useCalendarWriteAccess()
  const isPast = (event.end ?? event.start).getTime() < Date.now()
  const showRsvp = !isPast && event.attendees.some((a) => a.self) && event.attendees.length > 1

  // RSVP — optimistic chip state; the sync refresh catches up moments later.
  const [rsvpOverride, setRsvpOverride] = useState<RsvpAnswer | null>(null)
  const [rsvpPending, setRsvpPending] = useState<RsvpAnswer | null>(null)
  const rsvp = rsvpOverride ?? currentRsvp(event)
  const handleRsvp = async (answer: RsvpAnswer) => {
    if (rsvpPending || answer === rsvp) return
    if (canWrite === false) {
      toast('Reconnect Google in Settings to change your RSVP.', 'info')
      return
    }
    setRsvpPending(answer)
    try {
      const result = await window.ipc.invoke('calendar:respond', {
        eventId: event.id,
        response: RSVP_TO_API[answer],
      })
      if (result.ok) {
        setRsvpOverride(answer)
        // normalizeEvent hides declined events, so warn before it vanishes.
        if (answer === 'no') toast('Declined — the event will drop off your calendar.', 'info')
      } else {
        writeFailureToast(result, 'Could not update your RSVP.')
      }
    } catch {
      toast('Could not update your RSVP.', 'error')
    } finally {
      setRsvpPending(null)
    }
  }

  // Inline edit — title always; date/times for timed events only (all-day
  // spans keep their dates, which quick edits shouldn't reshape).
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editStart, setEditStart] = useState('')
  const [editEnd, setEditEnd] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const startEditing = () => {
    setEditTitle(event.summary)
    setEditDate(localDateKey(event.start))
    setEditStart(toTimeInputValue(event.start))
    setEditEnd(toTimeInputValue(event.end ?? new Date(event.start.getTime() + 30 * 60 * 1000)))
    setEditing(true)
  }
  const newStart = composeDateTime(editDate, editStart)
  const newEnd = composeDateTime(editDate, editEnd)
  const editTimesValid = event.isAllDay || (newStart !== null && newEnd !== null && newEnd.getTime() > newStart.getTime())
  const saveEdit = async () => {
    if (!editTimesValid || savingEdit) return
    const trimmed = editTitle.trim()
    const titleChanged = Boolean(trimmed) && trimmed !== event.summary
    const timesChanged = !event.isAllDay && newStart !== null && newEnd !== null && (
      newStart.getTime() !== event.start.getTime() ||
      newEnd.getTime() !== (event.end?.getTime() ?? 0)
    )
    if (!titleChanged && !timesChanged) {
      setEditing(false)
      return
    }
    setSavingEdit(true)
    try {
      const result = await window.ipc.invoke('calendar:updateEvent', {
        eventId: event.id,
        ...(titleChanged ? { summary: trimmed } : {}),
        // Start and end travel together so a partial patch can't cross them.
        ...(timesChanged && newStart && newEnd
          ? { startISO: newStart.toISOString(), endISO: newEnd.toISOString() }
          : {}),
      })
      if (result.ok) {
        toast('Event updated', 'success')
        setEditing(false)
      } else {
        writeFailureToast(result, 'Could not update the event.')
      }
    } catch {
      toast('Could not update the event.', 'error')
    } finally {
      setSavingEdit(false)
    }
  }

  // Delete — inline confirm so a stray click can't remove an event.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const isOrganizer = Boolean(event.organizer?.self)
  const handleDelete = async () => {
    if (deleting) return
    setDeleting(true)
    try {
      const result = await window.ipc.invoke('calendar:deleteEvent', { eventId: event.id })
      if (result.ok) {
        toast('Event deleted', 'success')
        onClose()
      } else {
        writeFailureToast(result, 'Could not delete the event.')
      }
    } catch {
      toast('Could not delete the event.', 'error')
    } finally {
      setDeleting(false)
    }
  }

  // Past events link to their captured note when one exists on disk.
  const [notePath, setNotePath] = useState<string | null>(null)
  useEffect(() => {
    if (!isPast || !onOpenNote) return
    let cancelled = false
    void findMeetingNoteForEvent(event).then((path) => {
      if (!cancelled) setNotePath(path)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id])

  const fieldStyle = { borderColor: 'var(--border, #e4e4e7)', color: 'var(--foreground, #09090b)' }

  return (
    <>
      <div
        className={`flex items-center gap-1 border-b px-3 py-2 ${onBack ? 'justify-between' : 'justify-end'}`}
        style={{ borderColor: 'var(--border, #e4e4e7)' }}
      >
        {onBack ? (
          <HeaderIconButton onClick={onBack} label="Back to day events">
            <ChevronLeft className="size-4" />
          </HeaderIconButton>
        ) : null}
        <div className="flex items-center gap-1">
          {canWrite && !editing ? (
            <HeaderIconButton onClick={startEditing} label="Edit event">
              <Pencil className="size-4" />
            </HeaderIconButton>
          ) : null}
          {canWrite && !confirmingDelete ? (
            <HeaderIconButton onClick={() => setConfirmingDelete(true)} label="Delete event">
              <Trash2 className="size-4" />
            </HeaderIconButton>
          ) : null}
          {event.htmlLink ? (
            <HeaderIconButton onClick={() => window.open(event.htmlLink!, '_blank')} label="Open in Google Calendar">
              <ExternalLink className="size-4" />
            </HeaderIconButton>
          ) : null}
          <HeaderIconButton onClick={onClose} label="Close event details">
            <X className="size-4" />
          </HeaderIconButton>
        </div>
      </div>
      {confirmingDelete ? (
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2" style={{ borderColor: 'var(--border, #e4e4e7)' }}>
          <span className="text-xs" style={{ color: 'var(--foreground, #27272a)' }}>
            {isOrganizer ? 'Cancel this event for all attendees?' : 'Remove this event from your calendar?'}
          </span>
          <div className="flex shrink-0 gap-1.5">
            <Button type="button" size="sm" variant="destructive" disabled={deleting} onClick={() => void handleDelete()}>
              {deleting ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
              Delete
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={deleting} onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      <div className="space-y-4 px-5 py-4">
        <div className="flex gap-3">
          <span
            aria-hidden
            className="mt-1.5 h-3 w-3 shrink-0 rounded-sm"
            style={{ background: 'var(--primary, #18181b)' }}
          />
          <div className="min-w-0 flex-1">
            {editing ? (
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void saveEdit() }}
                aria-label="Event title"
                autoFocus
                className="w-full border-0 border-b bg-transparent px-0.5 pb-1 text-[18px] font-normal outline-none focus:border-foreground"
                style={{ borderBottomWidth: 1.5, ...fieldStyle }}
              />
            ) : (
              <h4 className="break-words text-[20px] font-normal leading-6" style={{ color: 'var(--foreground, #09090b)' }}>
                {event.summary}
              </h4>
            )}
          </div>
        </div>

        {editing && !event.isAllDay ? (
          <div className="flex gap-3 text-sm leading-5">
            <span className="mt-0.5 shrink-0" style={{ color: 'var(--muted-foreground, #71717a)' }}><Clock className="size-4" /></span>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] tabular-nums" style={{ color: 'var(--foreground, #27272a)' }}>
              <input
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                aria-label="Event date"
                className="rounded border bg-transparent px-1 py-0.5 outline-none focus:border-foreground"
                style={fieldStyle}
              />
              <span className="flex items-center gap-1">
                <input
                  type="time"
                  value={editStart}
                  onChange={(e) => setEditStart(e.target.value)}
                  aria-label="Start time"
                  className="rounded border bg-transparent px-1 py-0.5 outline-none focus:border-foreground"
                  style={fieldStyle}
                />
                –
                <input
                  type="time"
                  value={editEnd}
                  onChange={(e) => setEditEnd(e.target.value)}
                  aria-label="End time"
                  className={cn('rounded border bg-transparent px-1 py-0.5 outline-none', editTimesValid ? 'focus:border-foreground' : 'border-red-500')}
                  style={editTimesValid ? fieldStyle : { color: 'var(--foreground, #09090b)' }}
                />
              </span>
            </div>
          </div>
        ) : (
          <EventDetailRow icon={<Clock className="size-4" />} value={formatEventDetailTime(event)} />
        )}

        {editing ? (
          <div className="flex gap-3">
            <span className="size-4 shrink-0" />
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={!editTimesValid || savingEdit} onClick={() => void saveEdit()}>
                {savingEdit ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
                Save changes
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={savingEdit} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {event.location ? <EventDetailRow icon={<MapPin className="size-4" />} value={event.location} /> : null}
        {organizer ? <EventDetailRow icon={<UserRound className="size-4" />} value={`Organizer: ${organizer}`} /> : null}
        {attendees.length > 0 ? (
          <EventDetailRow
            icon={<UsersRound className="size-4" />}
            value={attendees.slice(0, 8).join(', ') + (attendees.length > 8 ? `, +${attendees.length - 8} more` : '')}
          />
        ) : null}

        {showRsvp ? (
          <div className="flex items-center gap-1.5 text-sm">
            <span className="mr-1 text-xs" style={{ color: 'var(--muted-foreground, #71717a)' }}>Going?</span>
            {(['yes', 'no', 'maybe'] as const).map((answer) => (
              <button
                key={answer}
                type="button"
                disabled={rsvpPending !== null}
                onClick={() => void handleRsvp(answer)}
                aria-pressed={rsvp === answer}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors',
                  rsvp === answer
                    ? 'border-transparent bg-primary text-primary-foreground'
                    : 'bg-background text-foreground hover:bg-accent',
                  rsvpPending === answer && 'opacity-60',
                )}
              >
                {answer}
              </button>
            ))}
          </div>
        ) : null}

        {isPast && notePath && onOpenNote ? (
          <div className="flex gap-3">
            <FileText className="mt-1 size-4 shrink-0" style={{ color: 'var(--muted-foreground, #71717a)' }} />
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onClose()
                onOpenNote(notePath)
              }}
            >
              View meeting notes
            </Button>
          </div>
        ) : event.conferenceLink ? (
          <div className="flex gap-3">
            <Video className="mt-1 size-4 shrink-0" style={{ color: 'var(--muted-foreground, #71717a)' }} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => handleMeetingCapture(true)}>
                Join & take notes
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => handleMeetingCapture(false)}>
                Take notes only
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-3">
            <Mic className="mt-1 size-4 shrink-0" style={{ color: 'var(--muted-foreground, #71717a)' }} />
            <Button type="button" size="sm" variant="outline" onClick={() => handleMeetingCapture(false)}>
              Take notes
            </Button>
          </div>
        )}

        {descriptionParts.length > 0 ? (
          <div className="flex gap-3">
            <span className="mt-1 size-4 shrink-0" />
            <div className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-sm leading-5" style={{ color: 'var(--foreground, #27272a)' }}>
              {descriptionParts.map((part, index) => {
                if (part.type === 'text') return <span key={index}>{part.text}</span>
                return (
                  <a
                    key={index}
                    href={part.href}
                    onClick={(e) => {
                      e.preventDefault()
                      window.open(part.href, '_blank')
                    }}
                    className="underline underline-offset-2"
                    style={{ color: 'var(--primary, #18181b)' }}
                  >
                    {part.text}
                  </a>
                )
              })}
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}

export function EventDetailsPopover({ event, onClose, onOpenNote }: {
  event: UpcomingEvent
  onClose: () => void
  onOpenNote?: (path: string) => void
}) {
  return (
    <PopoverContent
      align="start"
      side="bottom"
      sideOffset={6}
      className="w-[min(380px,calc(100vw-32px))] rounded-lg p-0 shadow-xl"
      style={{
        backgroundColor: 'var(--muted, #f4f4f5)',
        borderColor: 'var(--border, #e4e4e7)',
        color: 'var(--popover-foreground, #09090b)',
      }}
    >
      <EventDetailsContent event={event} onClose={onClose} onOpenNote={onOpenNote} />
    </PopoverContent>
  )
}

function HeaderIconButton({ onClick, label, children }: {
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex size-8 items-center justify-center rounded-md transition-colors"
      style={{ color: 'var(--muted-foreground, #71717a)' }}
      aria-label={label}
      title={label}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--background, #ffffff)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
    >
      {children}
    </button>
  )
}

function EventDetailRow({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="flex gap-3 text-sm leading-5">
      <span className="mt-0.5 shrink-0" style={{ color: 'var(--muted-foreground, #71717a)' }}>{icon}</span>
      <span className="min-w-0 break-words" style={{ color: 'var(--foreground, #27272a)' }}>{value}</span>
    </div>
  )
}
