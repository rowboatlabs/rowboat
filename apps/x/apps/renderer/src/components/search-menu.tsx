import { Globe } from 'lucide-react'
import { useOpenBrowser } from '@/contexts/browser-context'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function SearchMenuItems({
  searchAvailable,
  searchEnabled,
  onSearchEnabledChange,
}: {
  searchAvailable: boolean
  searchEnabled: boolean
  onSearchEnabledChange: (enabled: boolean) => void
}) {
  const openBrowser = useOpenBrowser()
  return (
    <>
      {searchAvailable && (
        <DropdownMenuCheckboxItem
          checked={searchEnabled}
          onSelect={(event) => event.preventDefault()}
          onCheckedChange={onSearchEnabledChange}
        >
          Web search
        </DropdownMenuCheckboxItem>
      )}
      {openBrowser && (
        <DropdownMenuItem onSelect={openBrowser}>
          <Globe className="size-4" />
          Open browser
        </DropdownMenuItem>
      )}
    </>
  )
}

export function SearchMenu({
  searchAvailable,
  searchEnabled,
  onSearchEnabledChange,
  showLabel = true,
}: {
  searchAvailable: boolean
  searchEnabled: boolean
  onSearchEnabledChange: (enabled: boolean) => void
  showLabel?: boolean
}) {
  const openBrowser = useOpenBrowser()
  if (!searchAvailable && !openBrowser) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Search"
          className={cn(
            'flex h-7 shrink-0 items-center rounded-full border px-1.5 transition-colors duration-150 ease-out',
            searchAvailable && searchEnabled
              ? 'border-transparent bg-secondary text-foreground hover:bg-secondary/80'
              : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <Globe className="h-4 w-4 shrink-0" />
          {searchAvailable && searchEnabled && showLabel && (
            <span className="ml-1.5 whitespace-nowrap text-xs font-medium">Search</span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="min-w-44">
        <SearchMenuItems
          searchAvailable={searchAvailable}
          searchEnabled={searchEnabled}
          onSearchEnabledChange={onSearchEnabledChange}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
