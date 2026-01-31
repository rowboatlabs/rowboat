"use client"

import * as React from "react"

export type ActiveSection = "knowledge" | "tasks"

type SidebarSectionContextProps = {
  activeSection: ActiveSection
  setActiveSection: (section: ActiveSection) => void
}

const SidebarSectionContext = React.createContext<SidebarSectionContextProps | null>(null)

export function useSidebarSection() {
  const context = React.useContext(SidebarSectionContext)
  if (!context) {
    throw new Error("useSidebarSection must be used within a SidebarSectionProvider.")
  }
  return context
}

export function SidebarSectionProvider({
  defaultSection = "tasks",
  onSectionChange,
  children,
}: {
  defaultSection?: ActiveSection
  onSectionChange?: (section: ActiveSection) => void
  children: React.ReactNode
}) {
  const [activeSection, setActiveSectionState] = React.useState<ActiveSection>(defaultSection)

  const setActiveSection = React.useCallback((section: ActiveSection) => {
    setActiveSectionState(section)
    onSectionChange?.(section)
  }, [onSectionChange])

  const contextValue = React.useMemo<SidebarSectionContextProps>(
    () => ({
      activeSection,
      setActiveSection,
    }),
    [activeSection, setActiveSection]
  )

  return (
    <SidebarSectionContext.Provider value={contextValue}>
      {children}
    </SidebarSectionContext.Provider>
  )
}
