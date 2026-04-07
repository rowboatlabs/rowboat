import { mergeAttributes, Node as TiptapNode } from '@tiptap/react'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { X, Calendar, Video, ChevronDown, Mic } from 'lucide-react'
import { blocks } from '@x/shared'
import { useState, useEffect, useRef } from 'react'

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function getDateParts(dateStr: string): { day: number; month: string; weekday: string; isToday: boolean } {
  const d = new Date(dateStr)
  const now = new Date()
  const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  return {
    day: d.getDate(),
    month: d.toLocaleDateString([], { month: 'short' }).toUpperCase(),
    weekday: d.toLocaleDateString([], { weekday: 'short' }).toUpperCase(),
    isToday,
  }
}

function getEventDate(event: blocks.CalendarEvent): string {
  return event.start?.dateTime || event.start?.date || ''
}

function isAllDay(event: blocks.CalendarEvent): boolean {
  return !event.start?.dateTime && !!event.start?.date
}

function getTimeRange(event: blocks.CalendarEvent): string {
  if (isAllDay(event)) return 'All day'
  const start = event.start?.dateTime
  const end = event.end?.dateTime
  if (!start) return ''
  const startTime = formatTime(start)
  if (!end) return startTime
  const endTime = formatTime(end)
  return `${startTime} \u2013 ${endTime}`
}

/**
 * Extract a video conference link from raw Google Calendar event JSON.
 * Checks conferenceData.entryPoints (video type), hangoutLink, then falls back
 * to conferenceLink if already set.
 */
function extractConferenceLink(raw: Record<string, unknown>): string | undefined {
  // Check conferenceData.entryPoints for video entry
  const confData = raw.conferenceData as { entryPoints?: { entryPointType?: string; uri?: string }[] } | undefined
  if (confData?.entryPoints) {
    const video = confData.entryPoints.find(ep => ep.entryPointType === 'video')
    if (video?.uri) return video.uri
  }
  // Check hangoutLink (Google Meet shortcut)
  if (typeof raw.hangoutLink === 'string') return raw.hangoutLink
  // Fall back to conferenceLink if present
  if (typeof raw.conferenceLink === 'string') return raw.conferenceLink
  return undefined
}

interface ResolvedEvent {
  event: blocks.CalendarEvent
  loaded: blocks.CalendarEvent | null
  conferenceLink?: string
}

const GCAL_EVENT_COLOR = '#039be5'
const GCAL_TODAY_COLOR = '#1a73e8'

function JoinMeetingSplitButton({ onJoinAndNotes, onNotesOnly }: {
  onJoinAndNotes: () => void
  onNotesOnly: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target
      if (ref.current && target instanceof globalThis.Node && !ref.current.contains(target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="calendar-block-split-btn" ref={ref}>
      <button
        className="calendar-block-split-main"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onJoinAndNotes() }}
      >
        <Video size={13} />
        Join meeting & take notes
      </button>
      <div className="calendar-block-split-chevron-wrap">
        <button
          className={`calendar-block-split-chevron ${open ? 'calendar-block-split-chevron-open' : ''}`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        >
          <ChevronDown size={12} />
        </button>
        {open && (
          <div className="calendar-block-split-dropdown">
            <button
              className="calendar-block-split-option"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); setOpen(false); onNotesOnly() }}
            >
              <Mic size={13} />
              Take notes only
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// Shared global to pass calendar event data to App.tsx when joining a meeting.
// Set before dispatching the custom event, read by the handler in App.tsx.
declare global {
  interface Window {
    __pendingCalendarEvent?: {
      summary?: string
      start?: { dateTime?: string; date?: string }
      end?: { dateTime?: string; date?: string }
      location?: string
      htmlLink?: string
      conferenceLink?: string
      source?: string
    }
  }
}

function CalendarBlockView({ node, deleteNode }: { node: { attrs: Record<string, unknown> }; deleteNode: () => void }) {
  const raw = node.attrs.data as string
  let config: blocks.CalendarBlock | null = null

  try {
    config = blocks.CalendarBlockSchema.parse(JSON.parse(raw))
  } catch {
    // fallback below
  }

  const [resolvedEvents, setResolvedEvents] = useState<ResolvedEvent[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!config) return

    const eventsWithSources = config.events.filter(e => e.source)
    if (eventsWithSources.length === 0) {
      setResolvedEvents(config.events.map(e => ({ event: e, loaded: null })))
      return
    }

    setLoading(true)
    const ipc = (window as unknown as { ipc: { invoke: (channel: string, args: Record<string, string>) => Promise<{ data: string }> } }).ipc

    Promise.all(
      config.events.map(async (event): Promise<ResolvedEvent> => {
        if (!event.source) return { event, loaded: null }
        try {
          const result = await ipc.invoke('workspace:readFile', { path: event.source, encoding: 'utf8' })
          const content = typeof result === 'string' ? result : result.data
          const rawEvent = JSON.parse(content) as Record<string, unknown>
          const parsed = blocks.CalendarEventSchema.parse(rawEvent)
          const conferenceLink = extractConferenceLink(rawEvent)
          return { event, loaded: parsed, conferenceLink }
        } catch {
          return { event, loaded: null }
        }
      })
    ).then(results => {
      setResolvedEvents(results)
      setLoading(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw])

  if (!config) {
    return (
      <NodeViewWrapper className="calendar-block-wrapper" data-type="calendar-block">
        <div className="calendar-block-card calendar-block-error">
          <Calendar size={16} />
          <span>Invalid calendar block</span>
        </div>
      </NodeViewWrapper>
    )
  }

  const showJoinButton = config.showJoinButton === true

  const events = resolvedEvents.map(r => {
    const e = r.loaded || r.event
    return {
      ...e,
      htmlLink: e.htmlLink || r.event.htmlLink,
      conferenceLink: r.conferenceLink || e.conferenceLink || r.event.conferenceLink,
    }
  })

  // Group events by date
  const dateGroups: { dateKey: string; dateStr: string; events: (blocks.CalendarEvent & { _idx: number; conferenceLink?: string })[] }[] = []

  let globalIdx = 0
  for (const event of events) {
    const dateStr = getEventDate(event)
    const dateKey = dateStr ? new Date(dateStr).toDateString() : 'Unknown'

    let group = dateGroups.find(g => g.dateKey === dateKey)
    if (!group) {
      group = { dateKey, dateStr, events: [] }
      dateGroups.push(group)
    }
    group.events.push({ ...event, _idx: globalIdx++ })
  }

  const handleEventClick = (event: blocks.CalendarEvent) => {
    if (event.htmlLink) {
      window.open(event.htmlLink, '_blank')
    }
  }

  const handleJoinMeeting = (event: blocks.CalendarEvent & { conferenceLink?: string }, resolvedIdx: number, joinCall: boolean) => {
    if (joinCall) {
      const meetingUrl = event.conferenceLink
      if (meetingUrl) {
        window.open(meetingUrl, '_blank')
      }
    }

    // Find the original source path from config
    const originalEvent = config!.events[resolvedIdx]

    // Set calendar event data on window so App.tsx handler can read it
    window.__pendingCalendarEvent = {
      summary: event.summary,
      start: event.start,
      end: event.end,
      location: event.location,
      htmlLink: event.htmlLink,
      conferenceLink: event.conferenceLink,
      source: originalEvent?.source,
    }
    // Dispatch custom event so App.tsx can start meeting transcription
    window.dispatchEvent(new Event('calendar-block:join-meeting'))
  }

  return (
    <NodeViewWrapper className="calendar-block-wrapper" data-type="calendar-block">
      <div className="calendar-block-card">
        <button
          className="calendar-block-delete"
          onClick={deleteNode}
          aria-label="Delete calendar block"
        >
          <X size={14} />
        </button>
        {config.title && <div className="calendar-block-title">{config.title}</div>}
        {loading ? (
          <div className="calendar-block-loading">Loading events...</div>
        ) : events.length === 0 ? (
          <div className="calendar-block-empty">No events</div>
        ) : (
          <div className="calendar-block-list">
            {dateGroups.map((group, groupIdx) => {
              const parts = group.dateStr ? getDateParts(group.dateStr) : null
              return (
                <div key={group.dateKey} className="calendar-block-date-group">
                  {groupIdx > 0 && <div className="calendar-block-separator" />}
                  <div className="calendar-block-date-row">
                    <div className="calendar-block-date-left">
                      {parts ? (
                        <>
                          <span className="calendar-block-weekday" style={parts.isToday ? { color: GCAL_TODAY_COLOR } : undefined}>{parts.weekday}</span>
                          <span className={`calendar-block-day${parts.isToday ? ' calendar-block-day-today' : ''}`}>{parts.day}</span>
                        </>
                      ) : (
                        <span className="calendar-block-day">?</span>
                      )}
                    </div>
                    <div className="calendar-block-events">
                      {group.events.map(event => (
                        <div
                          key={event._idx}
                          className={`calendar-block-event ${event.htmlLink ? 'calendar-block-event-clickable' : ''}`}
                          style={{ backgroundColor: GCAL_EVENT_COLOR }}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); handleEventClick(event) }}
                        >
                          <div className="calendar-block-event-content">
                            <div className="calendar-block-event-title">
                              {event.summary || '(No title)'}
                            </div>
                            <div className="calendar-block-event-time">
                              {getTimeRange(event)}
                            </div>
                            {showJoinButton && event.conferenceLink && (
                              <JoinMeetingSplitButton
                                onJoinAndNotes={() => handleJoinMeeting(event, event._idx, true)}
                                onNotesOnly={() => handleJoinMeeting(event, event._idx, false)}
                              />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export const CalendarBlockExtension = TiptapNode.create({
  name: 'calendarBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      data: {
        default: '{}',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'pre',
        priority: 60,
        getAttrs(element) {
          const code = element.querySelector('code')
          if (!code) return false
          const cls = code.className || ''
          if (cls.includes('language-calendar')) {
            return { data: code.textContent || '{}' }
          }
          return false
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'calendar-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalendarBlockView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void; closeBlock: (node: unknown) => void }, node: { attrs: { data: string } }) {
          state.write('```calendar\n' + node.attrs.data + '\n```')
          state.closeBlock(node)
        },
        parse: {
          // handled by parseHTML
        },
      },
    }
  },
})
