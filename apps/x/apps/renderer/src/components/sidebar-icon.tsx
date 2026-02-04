"use client"

import * as React from "react"
import {
  Brain,
  HelpCircle,
  MessageSquare,
  Plug,
  Settings,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { type ActiveSection, useSidebarSection } from "@/contexts/sidebar-context"
import { ConnectorsPopover } from "@/components/connectors-popover"
import { HelpPopover } from "@/components/help-popover"
import { SettingsDialog } from "@/components/settings-dialog"

type NavItem = {
  id: ActiveSection
  title: string
  icon: React.ElementType
}

const navItems: NavItem[] = [
  { id: "tasks", title: "Chats", icon: MessageSquare },
  { id: "knowledge", title: "Knowledge", icon: Brain },
]

export function SidebarIcon() {
  const { activeSection, setActiveSection } = useSidebarSection()

  return (
    <div className="bg-sidebar border-r border-sidebar-border flex h-svh w-14 flex-col items-center py-2 fixed left-0 top-0 z-50 shrink-0">
      {/* Main navigation */}
      <nav className="flex flex-1 flex-col items-center gap-1">
        {navItems.map((item) => (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setActiveSection(item.id)}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-md transition-colors",
                  activeSection === item.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <item.icon className="size-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {item.title}
            </TooltipContent>
          </Tooltip>
        ))}
      </nav>

      {/* Secondary navigation (bottom) */}
      <nav className="flex flex-col items-center gap-1">
        {/* Connectors */}
        <ConnectorsPopover tooltip="Connectors">
          <button
            className="flex h-10 w-10 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            <Plug className="size-5" />
          </button>
        </ConnectorsPopover>

        {/* Settings */}
        <SettingsDialog>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            <Settings className="size-5" />
          </button>
        </SettingsDialog>

        {/* Help */}
        <HelpPopover tooltip="Help">
          <button
            className="flex h-10 w-10 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            <HelpCircle className="size-5" />
          </button>
        </HelpPopover>
      </nav>
    </div>
  )
}
