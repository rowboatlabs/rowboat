'use client'

import { Moon, Sun } from "lucide-react"
import { useTheme } from "@/app/providers/theme-provider"
import { Button } from "@nextui-org/react"

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()

  return (
    <Button
      variant="light"
      isIconOnly
      onClick={toggleTheme}
      aria-label="Toggle theme"
      className="text-foreground"
    >
      {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
    </Button>
  )
}