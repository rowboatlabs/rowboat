import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@/lib/toast'

const LEGACY_KEY = 'browser:railOpen'

export function useBrowserSettings() {
  const [railOpen, setRailOpen] = useState(() => localStorage.getItem(LEGACY_KEY) === '1')
  const current = useRef(railOpen)
  const saved = useRef(railOpen)
  const revision = useRef(0)
  const acknowledged = useRef(-1)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    const legacy = localStorage.getItem(LEGACY_KEY)
    void window.ipc.invoke('browser:getSettings', legacy === null ? null : { legacyTabRailOpen: legacy === '1' })
      .then((result) => {
        if (cancelled) return
        if (!result.ok) throw new Error(result.error)
        if (acknowledged.current < 0) {
          saved.current = result.settings.tabRailOpen
          acknowledged.current = 0
        }
        localStorage.removeItem(LEGACY_KEY)
        if (revision.current === 0) {
          current.current = result.settings.tabRailOpen
          setRailOpen(current.current)
        }
      })
      .catch((error) => {
        if (!cancelled) toast(error instanceof Error ? error.message : 'Could not load browser settings', 'error')
      })
    return () => { cancelled = true; mounted.current = false }
  }, [])

  const toggleRail = useCallback(() => {
    const next = !current.current
    const update = ++revision.current
    current.current = next
    setRailOpen(next)
    void window.ipc.invoke('browser:updateSettings', { tabRailOpen: next })
      .then((result) => {
        if (!result.ok) throw new Error(result.error)
        if (update > acknowledged.current) {
          saved.current = result.settings.tabRailOpen
          acknowledged.current = update
        }
      })
      .catch((error) => {
        if (!mounted.current) return
        if (revision.current === update) {
          current.current = saved.current
          setRailOpen(saved.current)
        }
        toast(error instanceof Error ? error.message : 'Could not save browser settings', 'error')
      })
  }, [])

  return { railOpen, toggleRail }
}
