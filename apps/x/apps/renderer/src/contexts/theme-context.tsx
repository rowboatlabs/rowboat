"use client"

import * as React from "react"

export type Theme = "light" | "dark" | "system"
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

const STORAGE_KEY = "rowboat-theme"
const CHAT_PANE_PLACEMENT_STORAGE_KEY = "rowboat-chat-pane-placement"
const CHAT_PANE_SIZE_STORAGE_KEY = "rowboat-chat-pane-size"

function isChatPanePlacement(value: string | null): value is ChatPanePlacement {
  return value === "right" || value === "middle"
}

function isChatPaneSize(value: string | null): value is ChatPaneSize {
  return value === "chat-smaller" || value === "chat-equal" || value === "chat-bigger"
}

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light"
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
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
  const [theme, setThemeState] = React.useState<Theme>(() => {
    if (typeof window === "undefined") return defaultTheme
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
    return stored || defaultTheme
  })
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

  const [resolvedTheme, setResolvedTheme] = React.useState<"light" | "dark">(() => {
    if (theme === "system") return getSystemTheme()
    return theme
  })

  // Apply theme to document
  React.useEffect(() => {
    const root = document.documentElement
    const resolved = theme === "system" ? getSystemTheme() : theme

    root.classList.remove("light", "dark")
    root.classList.add(resolved)
    setResolvedTheme(resolved)
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
