"use client"

import * as React from "react"

export type ActiveSection = "ask-ai" | "knowledge" | "agents"

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
  defaultSection = "ask-ai",
  children,
}: {
  defaultSection?: ActiveSection
  children: React.ReactNode
}) {
  const [activeSection, setActiveSection] = React.useState<ActiveSection>(defaultSection)

  const contextValue = React.useMemo<SidebarSectionContextProps>(
    () => ({
      activeSection,
      setActiveSection,
    }),
    [activeSection]
  )

  return (
    <SidebarSectionContext.Provider value={contextValue}>
      {children}
    </SidebarSectionContext.Provider>
  )
}
