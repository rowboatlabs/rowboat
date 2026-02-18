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
  layout?: 'fill' | 'scroll'
}

export function TabBar<T>({
  tabs,
  activeTabId,
  getTabTitle,
  getTabId,
  isProcessing,
  onSwitchTab,
  onCloseTab,
  layout = 'fill',
}: TabBarProps<T>) {
  return (
    <div
      className={cn(
        'flex flex-1 self-stretch min-w-0',
        layout === 'scroll'
          ? 'overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          : 'overflow-hidden'
      )}
    >
      {tabs.map((tab, index) => {
        const tabId = getTabId(tab)
        const isActive = tabId === activeTabId
        const processing = isProcessing?.(tab) ?? false
        const title = getTabTitle(tab)

        return (
          <React.Fragment key={tabId}>
            {index > 0 && (
              <div className="self-stretch w-px bg-border/70 shrink-0" aria-hidden="true" />
            )}
            <button
              type="button"
              onClick={() => onSwitchTab(tabId)}
              className={cn(
                'titlebar-no-drag group/tab relative flex items-center gap-1.5 px-3 self-stretch text-xs transition-colors',
                layout === 'scroll' ? 'min-w-[140px] max-w-[240px]' : 'min-w-0 max-w-[220px]',
                isActive
                  ? 'bg-background text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              )}
              style={layout === 'scroll' ? { flex: '0 0 auto' } : { flex: '1 1 0px' }}
            >
              {processing && (
                <span className="size-1.5 shrink-0 rounded-full bg-emerald-500 animate-pulse" />
              )}
              <span className="truncate flex-1 text-left">{title}</span>
              {tabs.length > 1 && (
                <span
                  role="button"
                  className="shrink-0 flex items-center justify-center rounded-sm p-0.5 opacity-0 group-hover/tab:opacity-60 hover:opacity-100! hover:bg-foreground/10 transition-all"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseTab(tabId)
                  }}
                  aria-label="Close tab"
                >
                  <X className="size-3" />
                </span>
              )}
            </button>
            {/* Right edge divider after last tab to close off the section */}
            {index === tabs.length - 1 && (
              <div className="self-stretch w-px bg-border/70 shrink-0" aria-hidden="true" />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}
