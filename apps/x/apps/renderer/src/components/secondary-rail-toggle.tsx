import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'

/** The same collapse/lock control for every secondary rail, independent of the main sidebar. */
export function SecondaryRailToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
    const label = open ? 'Close sidebar' : 'Lock sidebar open'
    return <button
        type="button"
        onClick={onToggle}
        title={label}
        aria-label={label}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
        {open ? <PanelLeftClose className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
    </button>
}
