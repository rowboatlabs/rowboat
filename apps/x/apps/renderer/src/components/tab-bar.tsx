import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

export type ChatTab = {
  id: string
  runId: string | null
}

export type FileTab = {
  id: string
  path: string
}

interface TabBarProps<T> {
  tabs: T[]
  activeTabId: string
  getTabTitle: (tab: T) => string
  getTabId: (tab: T) => string
  isProcessing?: (tab: T) => boolean
  onSwitchTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
}

export function TabBar<T>({
  tabs,
  activeTabId,
  getTabTitle,
  getTabId,
  isProcessing,
  onSwitchTab,
  onCloseTab,
}: TabBarProps<T>) {
  return (
    <div className="titlebar-no-drag flex flex-1 items-center gap-0 overflow-x-auto min-w-0">
      {tabs.map((tab) => {
        const tabId = getTabId(tab)
        const isActive = tabId === activeTabId
        const processing = isProcessing?.(tab) ?? false
        const title = getTabTitle(tab)

        return (
          <button
            key={tabId}
            type="button"
            onClick={() => onSwitchTab(tabId)}
            className={cn(
              "group/tab relative flex items-center gap-1.5 px-3 h-full text-xs max-w-[180px] min-w-[80px] transition-colors",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            {processing && (
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
                onCloseTab(tabId)
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
