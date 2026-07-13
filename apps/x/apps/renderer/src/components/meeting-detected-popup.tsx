import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

type PopupPayload = {
  title: string
  message: string
  hasCalendarEvent: boolean
}

const dragRegion = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDragRegion = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

// Rowboat sail glyph (black on transparent, same asset as the tray icon) —
// rendered on a white chip inside the "Take notes" pill.
const SAIL_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACfUlEQVR4nMSXO2gUURSGz8yuYuGjsBHFBza+UGwULUxjoY0iWPnA0lZQURDsFC1E7Owt7JQ0SZGQLk2SNoQEQhICCXlUCXk/ZvOf3HM2Z2/uZDM7m90fPnbm3jn3P/e5M0VqsorUZBWocYqogQnEhj1VzwTUsOTBOgJOg1WwYYMiyqdITDe9RK6CW+A2uAYugOPgBhiXuO3kal2E1pg5BO6BJ+A+uEK7OzcJpuVaR6amBArG+Bx4BZ6LqZUOdSI+I+SmoEJZEoilMTa+CN6Cl+CEMUrkuUgS5d91+e33OpApAQ06Cj6CN+CY1G14pqryPMt1b6jhagloI2z+EPwCl4xxgXabqnQXFCW+R8oTaxDvw5z1DbSL+Zpp2D4bpcTz7zAYMomVVaxizkP+FzwydYfJ9Uh3QskYWXGZrolOiamY/7QE1Pwk6AaXwTzoA7OghdyhQtJY7PVWzcnU/fPKK8xC5mdBB1gGv6UHY/IMr/rH4D25gyUtCS3n4efDaJ1Seuvf8xC/BhPgv1dnTz1+7qskogvSrhsu4wPqM/hCgeEPJUC0s99VBbkveWXa2A/wzktC45fILdxJL7kKM1+JV7cZCNRFyIYfwICXqA7/HzGPA22Ue5KmElWXjtYceCrXuiVXwDOp27OBPNJpaAVT5HaVTsVPcv98qb0nqs/7ABvw4XQTXJf7UfBCEkyqBeeV9u6UXHObvIsW9xOcNwFd2WfAHWnvO+iinUV5oAlo/ANyx3Yb+EQpez6keryS8QgMkjvp7oIFStnzIeX5LtAtyK9h3OOWrOZ5E9C/5PPk3gdnspoT5Z8Ce2xnNtegeqgmc1YjP82CavrHadMT2AIAAP//JKuLxQAAAAZJREFUAwAJ75pCeqjxVQAAAABJRU5ErkJggg=='

/**
 * Content of the "Meeting detected" always-on-top popup panel (see
 * `showMeetingPopup` in the main process). Granola-style consent prompt —
 * a lean horizontal bar: dashed rule (ad-hoc) or solid accent (calendar
 * match), "Meeting detected" + platform, and a "Take notes" pill. The ×
 * floats on the card's top-left corner; the window itself is transparent.
 * Detection never records — the user has to click "Take notes".
 */
// Opened directly in a browser (vite only, no Electron) there is no IPC
// bridge — render sample data so the popup can be styled with plain HMR.
// `?variant=calendar` previews the calendar-linked look.
const isPreview = typeof window.ipc === 'undefined'

export function MeetingDetectedPopup() {
  const [payload, setPayload] = useState<PopupPayload | null>(null)

  useEffect(() => {
    if (isPreview) {
      const calendar = new URLSearchParams(window.location.search).get('variant') === 'calendar'
      setPayload(
        calendar
          ? { title: 'Weekly design sync', message: 'Chrome', hasCalendarEvent: true }
          : { title: 'Meeting detected', message: 'Chrome', hasCalendarEvent: false },
      )
      return
    }
    const cleanup = window.ipc.on('meetingDetect:payload', (next) => setPayload(next))
    // The main process pushes on did-finish-load, but that can race this
    // listener's registration — fetch explicitly too.
    window.ipc
      .invoke('meetingDetect:getPayload', null)
      .then(({ payload: cached }) => {
        if (cached) setPayload(cached)
      })
      .catch(() => {})
    return cleanup
  }, [])

  const act = (action: 'take-notes' | 'dismiss') => {
    if (isPreview) {
      console.log(`[preview] action: ${action}`)
      return
    }
    void window.ipc.invoke('meetingDetect:action', { action }).catch(() => {})
  }

  // In the browser preview, reproduce the real popup window's exact size
  // (448×96) on a desktop-ish backdrop; in Electron the window IS that size.
  const popup = (
    <div
      className={`group ${isPreview ? 'relative' : 'h-screen w-screen relative bg-transparent'}`}
      style={isPreview ? { width: 400, height: 84 } : dragRegion}
    >
      {/* Close — floats over the card's top-left corner, revealed on hover */}
      <button
        onClick={() => act('dismiss')}
        className="absolute left-0.5 top-0.5 z-10 flex size-6 items-center justify-center rounded-full bg-neutral-800 border border-neutral-600 text-neutral-200 shadow-md hover:bg-neutral-700 opacity-0 group-hover:opacity-100 transition-opacity"
        style={noDragRegion}
        aria-label="Dismiss"
      >
        <X className="size-3.5" strokeWidth={2.5} />
      </button>

      {/* Card */}
      <div className="absolute left-3 right-3 top-3 h-14 rounded-2xl bg-[#1d1d1d] shadow-[0_8px_28px_rgba(0,0,0,0.55)] flex items-center gap-3 pl-4 pr-2.5">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white leading-tight truncate">
            {payload?.title ?? 'Meeting detected'}
          </div>
          <div className="text-[13px] text-neutral-400 leading-tight truncate mt-0.5">
            {payload?.message ?? ''}
          </div>
        </div>
        <button
          onClick={() => act('take-notes')}
          className="flex h-9.5 shrink-0 items-center gap-2 rounded-xl bg-neutral-800/90 border border-neutral-700 pl-2 pr-3 hover:bg-neutral-700 transition-colors"
          style={noDragRegion}
        >
          <span className="flex size-6 items-center justify-center">
            <img src={SAIL_ICON} alt="" className="size-4.5 invert" />
          </span>
          <span className="text-[13px] font-semibold text-white">Take notes</span>
        </button>
      </div>
    </div>
  )

  if (!isPreview) return popup
  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-sky-200 via-indigo-200 to-rose-200 p-6">
      {popup}
    </div>
  )
}
