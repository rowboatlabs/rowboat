import { startTransition, useMemo, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { EMOJI, frequentEmoji, noteEmojiUsed, searchEmoji } from '@/lib/emoji-data'

// The full emoji picker — search + a frequently-used row over the curated
// set. Replaces the fixed 12-emoji palette everywhere reactions are picked;
// usage feeds back into the frequent row (per install).
//
// The "All" grid (~340 buttons) is the popover's whole mount cost — rendered
// inside the opening click it froze the frame for ~120ms (measured), which
// read as a sluggish open animation. So the popover pops with just the
// search box and the frequent row (cheap), and the full grid fills in on a
// transition one beat later — interruptible, off the click's frame.

function EmojiButton({ emoji, title, onPick }: { emoji: string; title?: string; onPick: (emoji: string) => void }) {
    return (
        <button
            type="button"
            title={title}
            onClick={() => onPick(emoji)}
            className="inline-flex size-8 items-center justify-center rounded-md text-lg transition-transform duration-100 hover:bg-accent hover:scale-125 active:scale-95"
        >
            {emoji}
        </button>
    )
}

export function EmojiPickerPopover({ onPick, onOpenChange, children }: {
    onPick: (emoji: string) => void
    onOpenChange?: (open: boolean) => void
    children: ReactNode
}) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    /** The heavy grid mounts one transition after the popover shell. */
    const [gridReady, setGridReady] = useState(false)
    const setBoth = (next: boolean) => {
        setOpen(next)
        if (next) {
            setQuery('')
            startTransition(() => setGridReady(true))
        } else {
            setGridReady(false)
        }
        onOpenChange?.(next)
    }
    const pick = (emoji: string) => {
        noteEmojiUsed(emoji)
        setBoth(false)
        onPick(emoji)
    }
    // Snapshot the frequent row per open — reacting must not reshuffle the
    // grid under the cursor.
    const frequent = useMemo(() => (open ? frequentEmoji(16) : []), [open])
    const q = query.trim().toLowerCase()
    const results = q ? searchEmoji(q, 64) : null
    return (
        <Popover open={open} onOpenChange={setBoth}>
            <PopoverTrigger asChild>{children}</PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-2">
                <label className="mb-1.5 flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground focus-within:border-foreground/30">
                    <Search className="size-3" />
                    <input
                        autoFocus
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search emoji"
                        className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault()
                                const first = results?.[0]
                                if (first) pick(first.e)
                            }
                        }}
                    />
                </label>
                <div className="max-h-64 overflow-y-auto">
                    {results ? (
                        results.length > 0 ? (
                            <div className="grid grid-cols-8 gap-0.5">
                                {results.map((entry) => (
                                    <EmojiButton key={entry.n} emoji={entry.e} title={`:${entry.n}:`} onPick={pick} />
                                ))}
                            </div>
                        ) : (
                            <div className="px-1 py-3 text-xs text-muted-foreground">No emoji match.</div>
                        )
                    ) : (
                        <>
                            <div className="px-1 pb-0.5 pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Frequently used
                            </div>
                            <div className="grid grid-cols-8 gap-0.5">
                                {frequent.map((e) => (
                                    <EmojiButton key={e} emoji={e} onPick={pick} />
                                ))}
                            </div>
                            <div className="px-1 pb-0.5 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">All</div>
                            {gridReady ? (
                                <div className="grid grid-cols-8 gap-0.5">
                                    {EMOJI.map((entry) => (
                                        <EmojiButton key={entry.n} emoji={entry.e} title={`:${entry.n}:`} onPick={pick} />
                                    ))}
                                </div>
                            ) : (
                                // Reserve roughly the grid's height so the popper
                                // doesn't reposition when it fills in.
                                <div className="h-56" />
                            )}
                        </>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}
