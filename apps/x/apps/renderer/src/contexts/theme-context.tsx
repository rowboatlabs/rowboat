"use client"

import * as React from "react"

export type Theme = "light" | "dark" | "system"

type ThemeContextProps = {
  theme: Theme
  resolvedTheme: "light" | "dark"
  setTheme: (theme: Theme) => void
}

const ThemeContext = React.createContext<ThemeContextProps | null>(null)

const STORAGE_KEY = "rowboat-theme"

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

  const contextValue = React.useMemo<ThemeContextProps>(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
    }),
    [theme, resolvedTheme, setTheme]
  )

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  )
}
