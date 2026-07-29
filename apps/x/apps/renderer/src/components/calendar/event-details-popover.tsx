import { ChevronLeft, Clock, ExternalLink, MapPin, Mic, UserRound, UsersRound, Video, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { PopoverContent } from '@/components/ui/popover'
import {
  attendeeLabel,
  formatEventDetailTime,
  parseDescriptionParts,
  personLabel,
  triggerMeetingCapture,
  type UpcomingEvent,
} from '@/lib/calendar-events'

// The popover body on its own so other surfaces (e.g. the month grid's
// "+N more" popover) can swap it in without nesting popovers. `onBack`
// renders a back chevron in the header for that flow.
export function EventDetailsContent({ event, onClose, onBack }: {
  event: UpcomingEvent
  onClose: () => void
  onBack?: () => void
}) {
  const organizer = personLabel(event.organizer) ?? personLabel(event.creator)
  const attendees = event.attendees.map(attendeeLabel).filter((label): label is string => Boolean(label))
  const descriptionParts = event.description ? parseDescriptionParts(event.description) : []
  const handleMeetingCapture = (openConference: boolean) => {
    onClose()
    triggerMeetingCapture(event, openConference)
  }

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
      <div className="space-y-4 px-5 py-4">
        <div className="flex gap-3">
          <span
            aria-hidden
            className="mt-1.5 h-3 w-3 shrink-0 rounded-sm"
            style={{ background: 'var(--primary, #18181b)' }}
          />
          <div className="min-w-0">
            <h4 className="break-words text-[20px] font-normal leading-6" style={{ color: 'var(--foreground, #09090b)' }}>
              {event.summary}
            </h4>
          </div>
        </div>

        <EventDetailRow icon={<Clock className="size-4" />} value={formatEventDetailTime(event)} />
        {event.location ? <EventDetailRow icon={<MapPin className="size-4" />} value={event.location} /> : null}
        {organizer ? <EventDetailRow icon={<UserRound className="size-4" />} value={`Organizer: ${organizer}`} /> : null}
        {attendees.length > 0 ? (
          <EventDetailRow
            icon={<UsersRound className="size-4" />}
            value={attendees.slice(0, 8).join(', ') + (attendees.length > 8 ? `, +${attendees.length - 8} more` : '')}
          />
        ) : null}

        {event.conferenceLink ? (
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

export function EventDetailsPopover({ event, onClose }: { event: UpcomingEvent; onClose: () => void }) {
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
      <EventDetailsContent event={event} onClose={onClose} />
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
