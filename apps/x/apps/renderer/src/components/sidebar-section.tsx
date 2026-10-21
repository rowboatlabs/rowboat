import { useCallback, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'

// Sidebar redesign (2026-10-21): Spaces and Chats are sections that fold away,
// the same way in both. Whether each is open is remembered per machine.

const STORAGE_PREFIX = 'x:sidebar-section:'

function readOpen(id: string): boolean {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + id) !== 'closed'
  } catch {
    return true
  }
}

function useSectionOpen(id: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => readOpen(id))
  const toggle = useCallback(() => {
    setOpen((was) => {
      const next = !was
      try { window.localStorage.setItem(STORAGE_PREFIX + id, next ? 'open' : 'closed') } catch { /* in-memory only */ }
      return next
    })
  }, [id])
  return [open, toggle]
}

/** A quiet text heading over a list (Chats). */
export function SidebarSection({ id, label, tools, tourId, children }: {
  id: string
  label: string
  /** Buttons at the heading's right, shown on hover. */
  tools?: ReactNode
  tourId?: string
  children: ReactNode
}) {
  const [open, toggle] = useSectionOpen(id)
  return (
    <section className="sb-section px-2" data-open={open} aria-label={label}>
      <div className="sb-section-head">
        <button type="button" className="sb-section-toggle" aria-expanded={open} data-tour-id={tourId} onClick={toggle}>
          {label}
          <ChevronDown className="sb-chevron" strokeWidth={2.5} aria-hidden="true" />
        </button>
        {tools && <div className="sb-section-tools">{tools}</div>}
      </div>
      <div className="sb-collapse" inert={!open}>
        <div>{children}</div>
      </div>
    </section>
  )
}

/** A nav row (icon + label, like Email or Apps) whose children nest under it
 *  on a guide line (Spaces). The row opens the destination; the chevron at its
 *  right folds the children. */
export function SidebarNavSection({ id, label, icon, active, onOpen, tools, foldedBadge, tourId, children }: {
  id: string
  label: string
  icon: ReactNode
  active?: boolean
  onOpen?: () => void
  /** Buttons before the chevron, shown on hover. */
  tools?: ReactNode
  /** Shown at the row's right while folded (e.g. unread across the children). */
  foldedBadge?: ReactNode
  tourId?: string
  children: ReactNode
}) {
  const [open, toggle] = useSectionOpen(id)
  return (
    <section className="sb-section sb-nav-section px-2" data-open={open} aria-label={label}>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton isActive={active} data-tour-id={tourId} onClick={onOpen ?? toggle}>
            {icon}
            <span className="flex-1 truncate">{label}</span>
            {!open && foldedBadge && <span className="sb-meta flex items-center">{foldedBadge}</span>}
          </SidebarMenuButton>
          <div className="sb-row-actions">
            {tools}
            <button type="button" className="sb-row-action" aria-expanded={open}
              aria-label={open ? `Hide ${label.toLowerCase()} list` : `Show ${label.toLowerCase()} list`} onClick={toggle}>
              <ChevronDown className="sb-chevron" strokeWidth={2.25} aria-hidden="true" />
            </button>
          </div>
        </SidebarMenuItem>
      </SidebarMenu>
      <div className="sb-collapse" inert={!open}>
        <div><div className="sb-tree">{children}</div></div>
      </div>
    </section>
  )
}
