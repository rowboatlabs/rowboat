import { useEffect, useState } from 'react'

// Whether the Google grant includes the calendar.events write scope (older
// grants were readonly until the user reconnects). null while checking.
// Re-checked when an OAuth connect completes so the UI unlocks immediately.
export function useCalendarWriteAccess(): boolean | null {
  const [canWrite, setCanWrite] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const status = await window.ipc.invoke('calendar:getWriteStatus', {})
        if (!cancelled) setCanWrite(status.connected && status.canWrite)
      } catch {
        if (!cancelled) setCanWrite(false)
      }
    }
    void check()
    const cleanup = window.ipc.on('oauth:didConnect', () => { void check() })
    return () => {
      cancelled = true
      cleanup()
    }
  }, [])

  return canWrite
}
