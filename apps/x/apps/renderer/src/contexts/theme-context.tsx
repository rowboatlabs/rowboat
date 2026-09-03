"use client"

import * as React from "react"

import { getSystemTheme, readStoredTheme, resolveTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme"

export type { Theme }
export type ChatPanePlacement = "right" | "middle"
export type ChatPaneSize = "chat-smaller" | "chat-equal" | "chat-bigger"

type ThemeContextProps = {
  theme: Theme
  resolvedTheme: "light" | "dark"
  setTheme: (theme: Theme) => void
  chatPanePlacement: ChatPanePlacement
  setChatPanePlacement: (placement: ChatPanePlacement) => void
  chatPaneSize: ChatPaneSize
  setChatPaneSize: (size: ChatPaneSize) => void
}

const ThemeContext = React.createContext<ThemeContextProps | null>(null)

const STORAGE_KEY = THEME_STORAGE_KEY
const CHAT_PANE_PLACEMENT_STORAGE_KEY = "rowboat-chat-pane-placement"
const CHAT_PANE_SIZE_STORAGE_KEY = "rowboat-chat-pane-size"

function isChatPanePlacement(value: string | null): value is ChatPanePlacement {
  return value === "right" || value === "middle"
}

function isChatPaneSize(value: string | null): value is ChatPaneSize {
  return value === "chat-smaller" || value === "chat-equal" || value === "chat-bigger"
}

export function useTheme() {
  const context = React.useContext(ThemeContext)
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider.")
  }
  return context
}

export function ThemeProvider({
  defaultTheme = "system",
  children,
}: {
  defaultTheme?: Theme
  children: React.ReactNode
}) {
  const [theme, setThemeState] = React.useState<Theme>(() => readStoredTheme(defaultTheme))
  const [chatPanePlacement, setChatPanePlacementState] = React.useState<ChatPanePlacement>(() => {
    if (typeof window === "undefined") return "right"
    const stored = localStorage.getItem(CHAT_PANE_PLACEMENT_STORAGE_KEY)
    return isChatPanePlacement(stored) ? stored : "right"
  })
  const [chatPaneSize, setChatPaneSizeState] = React.useState<ChatPaneSize>(() => {
    if (typeof window === "undefined") return "chat-smaller"
    const stored = localStorage.getItem(CHAT_PANE_SIZE_STORAGE_KEY)
    return isChatPaneSize(stored) ? stored : "chat-smaller"
  })

  const [resolvedTheme, setResolvedTheme] = React.useState<"light" | "dark">(() => resolveTheme(theme))

  // Apply theme to document
  React.useEffect(() => {
    const root = document.documentElement
    const resolved = resolveTheme(theme)

    root.classList.remove("light", "dark")
    root.classList.add(resolved)
    setResolvedTheme(resolved)

    // Tell the windows that have no provider (the hover companion). The RAW
    // setting goes over the wire, not `resolved` — "system" has to resolve
    // per window, and a companion floating over a second display can sit on
    // a different appearance than this one.
    try {
      void window.ipc?.invoke("theme:set", { theme }).catch(() => {})
    } catch {
      // Stale preload (app not restarted since the channel was added), or a
      // non-Electron host. The setting still applies here; only the
      // cross-window sync is lost, and the companion re-reads on next load.
    }
  }, [theme])

  // Listen for system theme changes
  React.useEffect(() => {
    if (theme !== "system") return

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handleChange = () => {
      const resolved = getSystemTheme()
      document.documentElement.classList.remove("light", "dark")
      document.documentElement.classList.add(resolved)
      setResolvedTheme(resolved)
    }

    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [theme])

  const setTheme = React.useCallback((newTheme: Theme) => {
    localStorage.setItem(STORAGE_KEY, newTheme)
    setThemeState(newTheme)
  }, [])

  const setChatPanePlacement = React.useCallback((placement: ChatPanePlacement) => {
    localStorage.setItem(CHAT_PANE_PLACEMENT_STORAGE_KEY, placement)
    setChatPanePlacementState(placement)
  }, [])

  const setChatPaneSize = React.useCallback((size: ChatPaneSize) => {
    localStorage.setItem(CHAT_PANE_SIZE_STORAGE_KEY, size)
    setChatPaneSizeState(size)
  }, [])

  const contextValue = React.useMemo<ThemeContextProps>(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      chatPanePlacement,
      setChatPanePlacement,
      chatPaneSize,
      setChatPaneSize,
    }),
    [theme, resolvedTheme, setTheme, chatPanePlacement, setChatPanePlacement, chatPaneSize, setChatPaneSize]
  )

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  )
}
