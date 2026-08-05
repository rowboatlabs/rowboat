import { useCallback, useEffect, useState } from 'react'

import {
  CALENDAR_DIR,
  isCalendarPath,
  normalizeEvent,
  type CalendarMeta,
  type RawCalendarEvent,
  type UpcomingEvent,
} from '@/lib/calendar-events'

// Files in calendar_sync/ that aren't event JSONs.
const NON_EVENT_FILES = new Set(['calendars.json', 'sync_state.json', 'composio_state.json'])

const HIDDEN_CALENDARS_KEY = 'calendar-hidden-calendars'
// Fired whenever a hook instance changes visibility, so every other instance
// (calendar view, agenda) re-reads localStorage and stays in sync.
const VISIBILITY_EVENT = 'calendar-visibility-changed'

function loadHiddenCalendarIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(HIDDEN_CALENDARS_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

function isReadOnlyRole(accessRole: string | undefined): boolean {
  return accessRole === 'reader' || accessRole === 'freeBusyReader'
}

// Loads every synced calendar event from `calendar_sync/` (primary flat,
// secondary calendars in subdirectories), kept fresh via the workspace file
// watcher (debounced) and a 1-minute tick. Events are decorated with their
// calendar's color/permissions, deduped (an invite can live on several
// calendars — the primary copy wins), and filtered by the visibility toggles.
// Consumers apply their own time-window filtering and sorting.
export function useCalendarEvents(): {
  events: UpcomingEvent[]
  calendars: CalendarMeta[]
  hiddenCalendarIds: Set<string>
  setCalendarHidden: (calendarId: string, hidden: boolean) => void
  loading: boolean
  error: string | null
  connected: boolean | null
  refresh: () => void
} {
  const [events, setEvents] = useState<UpcomingEvent[]>([])
  const [calendars, setCalendars] = useState<CalendarMeta[]>([])
  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<Set<string>>(loadHiddenCalendarIds)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  // Calendar sync uses the native Google OAuth connection.
  const [connected, setConnected] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const oauthState = await window.ipc.invoke('oauth:getState', null)
        if (!cancelled) setConnected(oauthState.config?.google?.connected ?? false)
      } catch {
        if (!cancelled) setConnected(false)
      }
    }
    void check()
    const cleanupOAuthConnect = window.ipc.on('oauth:didConnect', () => { void check() })
    return () => {
      cancelled = true
      cleanupOAuthConnect()
    }
  }, [])

  useEffect(() => {
    const sync = () => setHiddenCalendarIds(loadHiddenCalendarIds())
    window.addEventListener(VISIBILITY_EVENT, sync)
    return () => window.removeEventListener(VISIBILITY_EVENT, sync)
  }, [])

  const setCalendarHidden = useCallback((calendarId: string, hidden: boolean) => {
    const next = loadHiddenCalendarIds()
    if (hidden) next.add(calendarId)
    else next.delete(calendarId)
    try {
      window.localStorage.setItem(HIDDEN_CALENDARS_KEY, JSON.stringify([...next]))
    } catch {
      // localStorage unavailable — visibility just won't persist.
    }
    window.dispatchEvent(new Event(VISIBILITY_EVENT))
  }, [])

  const loadEvents = useCallback(async () => {
    setLoading(true)
    try {
      const exists = await window.ipc.invoke('workspace:exists', { path: CALENDAR_DIR })
      if (!exists.exists) {
        setEvents([])
        setCalendars([])
        setError(null)
        return
      }
      const entries = await window.ipc.invoke('workspace:readdir', {
        path: CALENDAR_DIR,
        opts: { recursive: true, includeHidden: false, includeStats: false },
      })
      const jsonEntries = entries.filter(
        (e) => e.kind === 'file' && e.name.endsWith('.json') && !NON_EVENT_FILES.has(e.name),
      )

      let calendarMeta: CalendarMeta[] = []
      try {
        const metaFile = await window.ipc.invoke('workspace:readFile', {
          path: `${CALENDAR_DIR}/calendars.json`,
          encoding: 'utf8',
        })
        const parsed = JSON.parse(metaFile.data) as { calendars?: CalendarMeta[] }
        if (Array.isArray(parsed.calendars)) calendarMeta = parsed.calendars
      } catch {
        // No calendar list synced (older grant) — primary-only, no toggles.
      }

      const settled = await Promise.allSettled(
        jsonEntries.map(async (entry): Promise<UpcomingEvent | null> => {
          const result = await window.ipc.invoke('workspace:readFile', {
            path: entry.path,
            encoding: 'utf8',
          })
          const raw = JSON.parse(result.data) as RawCalendarEvent
          return normalizeEvent(raw, entry.path)
        }),
      )

      const metaById = new Map(calendarMeta.map((c) => [c.id, c]))
      const byId = new Map<string, UpcomingEvent>()
      for (const r of settled) {
        if (r.status !== 'fulfilled' || !r.value) continue
        let ev = r.value
        if (ev.calendarId !== 'primary') {
          const meta = metaById.get(ev.calendarId)
          ev = {
            ...ev,
            color: meta?.backgroundColor ?? null,
            readOnly: meta ? isReadOnlyRole(meta.accessRole) : false,
          }
        }
        const existing = byId.get(ev.id)
        if (!existing || (existing.calendarId !== 'primary' && ev.calendarId === 'primary')) {
          byId.set(ev.id, ev)
        }
      }

      setCalendars(calendarMeta)
      setEvents([...byId.values()].filter((ev) => !hiddenCalendarIds.has(ev.calendarId)))
      setError(null)
    } catch (err) {
      console.error('Failed to load calendar events:', err)
      setError('Could not load calendar events.')
    } finally {
      setLoading(false)
    }
  }, [hiddenCalendarIds])

  useEffect(() => {
    void loadEvents()
  }, [loadEvents, refreshTick])

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null
    const scheduleReload = () => {
      if (timeout) clearTimeout(timeout)
      timeout = setTimeout(() => {
        timeout = null
        setRefreshTick((t) => t + 1)
      }, 250)
    }
    const cleanup = window.ipc.on('workspace:didChange', (event) => {
      switch (event.type) {
        case 'created':
        case 'changed':
        case 'deleted':
          if (isCalendarPath(event.path)) scheduleReload()
          break
        case 'moved':
          if (isCalendarPath(event.from) || isCalendarPath(event.to)) scheduleReload()
          break
        case 'bulkChanged':
          if (!event.paths || event.paths.some(isCalendarPath)) scheduleReload()
          break
      }
    })
    // Refresh every minute so "now"-dependent consumers (highlights, day
    // labels, "ended" filtering) stay current without waiting on a sync.
    const tick = setInterval(() => setRefreshTick((t) => t + 1), 60 * 1000)
    return () => {
      cleanup()
      clearInterval(tick)
      if (timeout) clearTimeout(timeout)
    }
  }, [])

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), [])

  return { events, calendars, hiddenCalendarIds, setCalendarHidden, loading, error, connected, refresh }
}
