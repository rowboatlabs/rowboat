import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'

/** The same collapse/lock control for every secondary rail, independent of the main sidebar; the same glyphs and size as the header's "Show sidebar" (2026-11-09). */
export function SecondaryRailToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
    const label = open ? 'Close sidebar' : 'Lock sidebar open'
    return <button
        type="button"
        onClick={onToggle}
        title={label}
        aria-label={label}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
        {open ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
    </button>
}
