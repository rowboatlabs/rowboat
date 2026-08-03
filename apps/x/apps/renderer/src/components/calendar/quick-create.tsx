import { useState } from 'react'
import { Clock, ExternalLink, Loader2, Video, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { PopoverContent } from '@/components/ui/popover'
import { localDateKey } from '@/lib/calendar-events'
import { toast } from '@/lib/toast'
import { useCalendarWriteAccess } from '@/hooks/use-calendar-write'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// Google Calendar template URLs want UTC "basic" timestamps.
function toGoogleUtc(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`
}

// The next half-hour boundary from now — default slot for the header button.
export function nextHalfHour(from: Date): { start: Date; end: Date } {
  const start = new Date(from)
  start.setSeconds(0, 0)
  start.setMinutes(start.getMinutes() + 30 - (start.getMinutes() % 30))
  const end = new Date(start.getTime() + 30 * 60 * 1000)
  return { start, end }
}

export function toTimeInputValue(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function composeDateTime(dateStr: string, timeStr: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  const tm = /^(\d{2}):(\d{2})$/.exec(timeStr)
  if (!dm || !tm) return null
  return new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]))
}

/**
 * Draft-event popover for empty-slot clicks/drags, month-cell clicks, and the
 * header's "New event". Saves directly to Google Calendar (optionally with a
 * Meet link); when the grant predates the write scope, falls back to a
 * prefilled Google Calendar template URL and points at reconnecting.
 */
export function QuickCreatePopover({ start, end, onClose }: {
  start: Date
  end: Date
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [dateStr, setDateStr] = useState(() => localDateKey(start))
  const [startStr, setStartStr] = useState(() => toTimeInputValue(start))
  const [endStr, setEndStr] = useState(() => toTimeInputValue(end))
  const [withMeet, setWithMeet] = useState(true)
  const [saving, setSaving] = useState(false)
  const canWrite = useCalendarWriteAccess()

  const draftStart = composeDateTime(dateStr, startStr)
  const draftEnd = composeDateTime(dateStr, endStr)
  const isValid = draftStart !== null && draftEnd !== null && draftEnd.getTime() > draftStart.getTime()

  // Changing the start keeps the duration, like Google Calendar's editor.
  const handleStartChange = (next: string) => {
    const oldStart = composeDateTime(dateStr, startStr)
    const oldEnd = composeDateTime(dateStr, endStr)
    const newStart = composeDateTime(dateStr, next)
    setStartStr(next)
    if (oldStart && oldEnd && newStart && oldEnd.getTime() > oldStart.getTime()) {
      const shifted = new Date(newStart.getTime() + (oldEnd.getTime() - oldStart.getTime()))
      if (localDateKey(shifted) === dateStr) setEndStr(toTimeInputValue(shifted))
    }
  }

  const openInGoogle = () => {
    if (!draftStart || !draftEnd) return
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: title.trim() || 'New event',
      dates: `${toGoogleUtc(draftStart)}/${toGoogleUtc(draftEnd)}`,
    })
    if (withMeet) params.set('details', 'Created from Rowboat — add a Meet link before saving.')
    window.open(`https://calendar.google.com/calendar/render?${params.toString()}`, '_blank')
    onClose()
  }

  const save = async () => {
    if (!draftStart || !draftEnd || !isValid || saving) return
    setSaving(true)
    try {
      const result = await window.ipc.invoke('calendar:createEvent', {
        summary: title.trim() || 'New event',
        startISO: draftStart.toISOString(),
        endISO: draftEnd.toISOString(),
        addMeet: withMeet,
      })
      if (result.ok) {
        toast('Event created', 'success')
        onClose()
      } else if (result.needsReconnect) {
        toast(result.error ?? 'Reconnect Google in Settings to save events directly.', 'info')
      } else {
        toast(result.error ?? 'Could not create the event.', 'error')
      }
    } catch {
      toast('Could not create the event.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const primaryIsSave = canWrite !== false
  const submit = () => { if (primaryIsSave) void save(); else openInGoogle() }

  const fieldStyle = { borderColor: 'var(--border, #e4e4e7)', color: 'var(--foreground, #09090b)' }

  return (
    <PopoverContent
      align="start"
      side="bottom"
      sideOffset={6}
      className="w-[min(320px,calc(100vw-32px))] rounded-lg p-0 shadow-xl"
      style={{
        backgroundColor: 'var(--muted, #f4f4f5)',
        borderColor: 'var(--border, #e4e4e7)',
        color: 'var(--popover-foreground, #09090b)',
      }}
    >
      <div className="flex items-center justify-between gap-1 border-b px-3 py-2" style={{ borderColor: 'var(--border, #e4e4e7)' }}>
        <span className="pl-1 text-xs font-semibold" style={{ color: 'var(--foreground, #09090b)' }}>New event</span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-background"
          style={{ color: 'var(--muted-foreground, #71717a)' }}
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="space-y-3 px-4 py-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          placeholder="Add a title"
          aria-label="Event title"
          autoFocus
          className="w-full border-0 border-b bg-transparent px-0.5 pb-1.5 pt-1 text-[15px] font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground/60 focus:border-foreground"
          style={{ borderBottomWidth: 1.5, ...fieldStyle }}
        />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] tabular-nums" style={{ color: 'var(--foreground, #27272a)' }}>
          <Clock className="size-3.5 shrink-0" style={{ color: 'var(--muted-foreground, #71717a)' }} />
          <input
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            aria-label="Event date"
            className="rounded border bg-transparent px-1 py-0.5 outline-none focus:border-foreground"
            style={fieldStyle}
          />
          <span className="flex items-center gap-1">
            <input
              type="time"
              value={startStr}
              onChange={(e) => handleStartChange(e.target.value)}
              aria-label="Start time"
              className="rounded border bg-transparent px-1 py-0.5 outline-none focus:border-foreground"
              style={fieldStyle}
            />
            –
            <input
              type="time"
              value={endStr}
              onChange={(e) => setEndStr(e.target.value)}
              aria-label="End time"
              className={isValid ? 'rounded border bg-transparent px-1 py-0.5 outline-none focus:border-foreground' : 'rounded border border-red-500 bg-transparent px-1 py-0.5 outline-none'}
              style={isValid ? fieldStyle : { color: 'var(--foreground, #09090b)' }}
            />
          </span>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs" style={{ color: 'var(--foreground, #27272a)' }}>
          <input type="checkbox" checked={withMeet} onChange={(e) => setWithMeet(e.target.checked)} />
          <Video className="size-3.5" style={{ color: 'var(--muted-foreground, #71717a)' }} />
          Add Google Meet link
        </label>
        {canWrite === false ? (
          <p className="text-[11px] leading-4" style={{ color: 'var(--muted-foreground, #71717a)' }}>
            Reconnect Google in Settings to save events (and Meet links) directly from here.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2 pt-0.5">
          {primaryIsSave ? (
            <>
              <Button type="button" size="sm" disabled={!isValid || saving} onClick={() => void save()}>
                {saving ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
                Save
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={!isValid} onClick={openInGoogle}>
                <ExternalLink className="mr-1.5 size-3.5" />
                Open in Google Calendar
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" disabled={!isValid} onClick={openInGoogle}>
              <ExternalLink className="mr-1.5 size-3.5" />
              Open in Google Calendar
            </Button>
          )}
        </div>
      </div>
    </PopoverContent>
  )
}
