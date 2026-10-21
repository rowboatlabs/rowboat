import { useCallback, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

// Sidebar redesign (2026-10-21): Spaces and Chats are named sections that fold
// away, the same way in both. Whether each is open is remembered per machine.

const STORAGE_PREFIX = 'x:sidebar-section:'

function readOpen(id: string): boolean {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + id) !== 'closed'
  } catch {
    return true
  }
}

export function SidebarSection({ id, label, tools, tourId, children }: {
  id: string
  label: string
  /** Buttons at the heading's right, shown on hover. */
  tools?: ReactNode
  tourId?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(() => readOpen(id))
  const toggle = useCallback(() => {
    setOpen((was) => {
      const next = !was
      try { window.localStorage.setItem(STORAGE_PREFIX + id, next ? 'open' : 'closed') } catch { /* in-memory only */ }
      return next
    })
  }, [id])
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
