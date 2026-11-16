import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Keys } from '@/components/keys'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ShortcutKeys } from '@/lib/shortcuts'

/** The same collapse/lock control for every secondary rail, independent of the main sidebar; the same glyphs and size as the header's "Show sidebar" (2026-11-09).
 *  A rail with a keyboard toggle passes its `shortcut`, shown on hover (Spaces' ⌘B, 2026-11-13). */
export function SecondaryRailToggle({ open, onToggle, shortcut }: { open: boolean; onToggle: () => void; shortcut?: ShortcutKeys }) {
    const label = open ? 'Close sidebar' : 'Lock sidebar open'
    const button = <button
        type="button"
        onClick={onToggle}
        title={shortcut ? undefined : label}
        aria-label={label}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
        {open ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
    </button>
    if (!shortcut) return button
    return <Tooltip delayDuration={500}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6} className="flex items-center gap-2">{label} <Keys keys={shortcut} tone="dark" /></TooltipContent>
    </Tooltip>
}
