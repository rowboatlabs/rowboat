import { useEffect, useState } from 'react'

import { readStoredTheme, resolveTheme, type Theme } from '@/lib/theme'

/**
 * Light/dark for the utility windows that render OUTSIDE the ThemeProvider —
 * the hover companion and the other hash-route windows in main.tsx. Applies
 * the resolved class to `documentElement` and returns it.
 *
 * Three inputs, in the order they matter:
 *
 * 1. localStorage, read on mount. Every window shares one origin and one
 *    Electron session, so the setting is already there and the FIRST paint is
 *    correct — no IPC round trip, no flash of the wrong skin.
 * 2. The `theme:changed` push. A localStorage write in the app window raises
 *    no cross-window event we can rely on, so when the user flips the toggle
 *    in Settings the app window tells main and main relays it here.
 * 3. matchMedia, while the setting is "system". Resolved per window on
 *    purpose: a companion floating over a second display can sit on a
 *    different appearance than the app window.
 */
export function useWindowTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme())
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolveTheme(readStoredTheme()))

  // Live changes from the app window.
  useEffect(() => {
    let off: (() => void) | undefined
    try {
      off = window.ipc.on('theme:changed', (next) => setTheme(next.theme))
    } catch {
      // Stale preload (app not restarted since the channel was added) throws
      // synchronously from schema validation — the mount-time read still
      // holds, so the window is correct, just not live.
    }
    return () => off?.()
  }, [])

  // Resolve + paint. Removing BOTH classes matters: this window persists
  // across HMR and across theme flips, so a leftover class would keep the old
  // skin's tokens on the new one.
  useEffect(() => {
    const apply = () => {
      const next = resolveTheme(theme)
      const root = document.documentElement
      root.classList.remove('light', 'dark')
      root.classList.add(next)
      setResolved(next)
    }
    apply()
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  return resolved
}
