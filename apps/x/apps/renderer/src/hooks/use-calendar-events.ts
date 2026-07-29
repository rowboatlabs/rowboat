import { useCallback, useEffect, useState } from 'react'

import {
  CALENDAR_DIR,
  isCalendarPath,
  normalizeEvent,
  type RawCalendarEvent,
  type UpcomingEvent,
} from '@/lib/calendar-events'

// Loads every synced calendar event from `calendar_sync/`, kept fresh via the
// workspace file watcher (debounced) and a 1-minute tick. Consumers apply their
// own time-window filtering and sorting.
export function useCalendarEvents(): {
  events: UpcomingEvent[]
  loading: boolean
  error: string | null
  connected: boolean | null
  refresh: () => void
} {
  const [events, setEvents] = useState<UpcomingEvent[]>([])
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

  const loadEvents = useCallback(async () => {
    setLoading(true)
    try {
      const exists = await window.ipc.invoke('workspace:exists', { path: CALENDAR_DIR })
      if (!exists.exists) {
        setEvents([])
        setError(null)
        return
      }
      const entries = await window.ipc.invoke('workspace:readdir', {
        path: CALENDAR_DIR,
        opts: { recursive: false, includeHidden: false, includeStats: false },
      })
      const jsonEntries = entries.filter((e) => e.kind === 'file' && e.name.endsWith('.json'))

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

      const collected: UpcomingEvent[] = []
      for (const r of settled) {
        if (r.status === 'fulfilled' && r.value) collected.push(r.value)
      }
      setEvents(collected)
      setError(null)
    } catch (err) {
      console.error('Failed to load calendar events:', err)
      setError('Could not load calendar events.')
    } finally {
      setLoading(false)
    }
  }, [])

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

  return { events, loading, error, connected, refresh }
}
