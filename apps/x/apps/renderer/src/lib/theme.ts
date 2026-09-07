/**
 * The theme setting itself — storage key, reading, and resolution — with no
 * React in it.
 *
 * Separate from theme-context because the windows that need it most are the
 * ones with no provider: main.tsx renders the hover companion and the other
 * hash-route utility windows outside the ThemeProvider tree, and they read
 * this very key rather than keeping a second copy of the setting that could
 * drift. (It also keeps theme-context a components-only module, which is what
 * Fast Refresh wants.)
 */

export type Theme = 'light' | 'dark' | 'system'

/** Shared across every window: one origin, one Electron session, one key. */
export const THEME_STORAGE_KEY = 'rowboat-theme'

export function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** The stored setting, or `fallback` if nothing valid is stored yet. */
export function readStoredTheme(fallback: Theme = 'system'): Theme {
  if (typeof window === 'undefined') return fallback
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : fallback
}

/**
 * "system" resolved against THIS window's matchMedia — per window on purpose:
 * a companion floating over a second display can sit on a different
 * appearance than the app window.
 */
export function resolveTheme(theme: Theme): 'light' | 'dark' {
  return theme === 'system' ? getSystemTheme() : theme
}
