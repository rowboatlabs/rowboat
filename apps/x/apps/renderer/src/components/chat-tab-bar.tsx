import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

export type ChatTab = {
  id: string
  runId: string | null
}

interface ChatTabBarProps {
  tabs: ChatTab[]
  activeTabId: string
  getTabTitle: (tab: ChatTab) => string
  processingRunIds: Set<string>
  onSwitchTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
}

export function ChatTabBar({
  tabs,
  activeTabId,
  getTabTitle,
  processingRunIds,
  onSwitchTab,
  onCloseTab,
}: ChatTabBarProps) {
  return (
    <div className="titlebar-no-drag flex flex-1 items-center gap-0 overflow-x-auto min-w-0">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        const isProcessing = tab.runId ? processingRunIds.has(tab.runId) : false
        const title = getTabTitle(tab)

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSwitchTab(tab.id)}
            className={cn(
              "group/tab relative flex items-center gap-1.5 px-3 h-full text-xs max-w-[180px] min-w-[80px] transition-colors",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            {isProcessing && (
              <span className="size-1.5 shrink-0 rounded-full bg-emerald-500 animate-pulse" />
            )}
            <span className="truncate flex-1 text-left">{title}</span>
            <span
              role="button"
              className={cn(
                "shrink-0 flex items-center justify-center rounded-sm p-0.5 hover:bg-foreground/10 transition-colors",
                isActive ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover/tab:opacity-60 hover:!opacity-100"
              )}
              onClick={(e) => {
                e.stopPropagation()
                onCloseTab(tab.id)
              }}
              aria-label="Close tab"
            >
              <X className="size-3" />
            </span>
          </button>
        )
      })}
    </div>
  )
}
