import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAllTabMeta } from "@/lib/tab-meta"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

export type ChatTab = {
  id: string
  runId: string | null
  // Identity of the CHAT this tab currently shows. Minted fresh on every
  // rebinding (new chat, opening a history item into this tab) and kept
  // stable when a draft chat's first send binds its runId — so components
  // keyed by it remount exactly when the tab starts showing a different
  // chat, never mid-send. Chat sessions behave like self-sufficient
  // component instances; tabs stay dumb containers.
  chatId: string
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
  allowSingleTabClose?: boolean
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
  allowSingleTabClose = false,
}: TabBarProps<T>) {
  // Content-reported meta (see lib/tab-meta.ts): a tab whose content reports
  // its own title/busy wins over the strip's derivation props; the props stay
  // as the fallback for unmigrated content (file tabs, draft chats).
  const tabMeta = useAllTabMeta()
  return (
    <div
      className={cn(
        'rowboat-tabbar flex flex-1 self-stretch min-w-0',
        layout === 'scroll'
          ? 'overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          : 'overflow-hidden'
      )}
    >
      {tabs.map((tab, index) => {
        const tabId = getTabId(tab)
        const isActive = tabId === activeTabId
        const meta = tabMeta.get(tabId)
        const title = meta?.title ?? getTabTitle(tab)
        // The strip currently renders no busy indicator (the green dot was
        // removed deliberately); the effective value is still resolved
        // content-first and exposed as data-busy for styling/tests.
        const busy = meta?.busy ?? isProcessing?.(tab) ?? false

        // Close Others / Close to the Right funnel through onCloseTab per id,
        // so parents (local tab state, browser IPC) need no new callbacks.
        const closeOthers = () => {
          for (const t of tabs) {
            const id = getTabId(t)
            if (id !== tabId) onCloseTab(id)
          }
        }
        const closeToTheRight = () => {
          for (const t of tabs.slice(index + 1)) onCloseTab(getTabId(t))
        }
        const canClose = allowSingleTabClose || tabs.length > 1

        return (
          <React.Fragment key={tabId}>
            {index > 0 && (
              <div className="self-stretch w-px bg-border/70 shrink-0" aria-hidden="true" />
            )}
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <button
                  type="button"
                  onClick={() => onSwitchTab(tabId)}
                  data-busy={busy || undefined}
                  className={cn(
                    'rowboat-tab titlebar-no-drag group/tab relative flex items-center gap-1.5 px-3 self-stretch text-xs transition-colors',
                    layout === 'scroll' ? 'min-w-[140px] max-w-[240px]' : 'min-w-0 max-w-[220px]',
                    isActive
                      ? 'bg-background text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  )}
                  style={layout === 'scroll' ? { flex: '0 0 auto' } : { flex: '1 1 0px' }}
                >
                  <span className="truncate flex-1 text-left">{title}</span>
                  {(allowSingleTabClose || tabs.length > 1) && (
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
              </ContextMenuTrigger>
              <ContextMenuContent className="w-48">
                <ContextMenuItem disabled={!canClose} onClick={() => onCloseTab(tabId)}>
                  Close Tab
                </ContextMenuItem>
                <ContextMenuItem disabled={tabs.length <= 1} onClick={closeOthers}>
                  Close Other Tabs
                </ContextMenuItem>
                <ContextMenuItem disabled={index >= tabs.length - 1} onClick={closeToTheRight}>
                  Close Tabs to the Right
                </ContextMenuItem>
                {allowSingleTabClose && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onClick={() => {
                        for (const t of tabs) onCloseTab(getTabId(t))
                      }}
                    >
                      Close All Tabs
                    </ContextMenuItem>
                  </>
                )}
              </ContextMenuContent>
            </ContextMenu>
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
