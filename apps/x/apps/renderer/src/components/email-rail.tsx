import { Inbox, Mail, PanelLeftClose, PenLine, Sparkles, Star, Tag } from 'lucide-react'
import { cn } from '@/lib/utils'
import { labelNameFor, orderedCategoryIds, type EmailLabelInfo } from '@/lib/email-labels'

// The email section's edge rail: quick subsetting of the inbox. Modeled on the
// Spaces rail — a plain 280px sidebar collapsible to a 28px edge strip via the
// header button; clicking the strip reopens it. No hover behavior — the rail
// moves only on explicit clicks. Fixed views on top (All mail / Important /
// Everything else / Drafts), then one row per category with mail in it; a
// category click narrows Everything else the same way the pills do (the two
// stay in sync — both read the same filter state).

export type EmailRailSelection =
    | { kind: 'all' }
    | { kind: 'important' }
    | { kind: 'reply-ready' }
    | { kind: 'other'; category?: string | null }
    | { kind: 'drafts' }

export function EmailRail({
    view, inboxFilter, otherCategory, categoryCounts, labels, draftCount, replyReadyCount, open, onTogglePin, onSelect,
}: {
    view: 'inbox' | 'drafts'
    inboxFilter: 'all' | 'important' | 'reply-ready' | 'other'
    otherCategory: string | null
    /** Whole-'other'-section counts from the last backend response (pre-filter). */
    categoryCounts: Record<string, number>
    labels: EmailLabelInfo[]
    /** Drafts are fetched lazily — 0 until the Drafts view first loads. */
    draftCount: number
    /** Threads with a classifier-drafted reply, across the loaded sections. */
    replyReadyCount: number
    open: boolean
    onTogglePin: () => void
    onSelect: (selection: EmailRailSelection) => void
}) {
    const categories = orderedCategoryIds(labels, categoryCounts)
    const otherTotal = Object.values(categoryCounts).reduce((sum, n) => sum + n, 0)
    const inInbox = view === 'inbox'

    const viewRow = (
        active: boolean,
        icon: React.ReactNode,
        label: string,
        count: number | null,
        select: () => void,
    ) => (
        <button
            type="button"
            onClick={select}
            className={cn(
                'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13.5px]',
                active ? 'bg-accent font-medium text-foreground' : 'text-foreground/90 hover:bg-accent/50',
            )}
        >
            {icon}
            <span className="flex-1 truncate">{label}</span>
            {count !== null && count > 0 && (
                <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span>
            )}
        </button>
    )

    return (
        <aside
            style={{ width: open ? 280 : 28, transition: 'width 200ms cubic-bezier(0.2,0,0,1)' }}
            className={cn(
                'relative z-10 shrink-0 min-h-0 overflow-hidden flex flex-col',
                // A step lighter than the main sidebar so the two rails read as
                // distinct layers (same treatment as the Spaces rail).
                open ? 'border-r border-border bg-[var(--rowboat-panel-soft)]' : 'border-r border-border bg-background',
            )}
        >
            {!open ? (
                // The collapsed edge strip: click to reopen. Deliberately not
                // hover-triggered — the rail appears only on an explicit act.
                <button
                    type="button"
                    onClick={onTogglePin}
                    title="Show mail filters"
                    className="flex flex-1 flex-col items-center gap-2.5 py-3.5 hover:bg-accent/50"
                >
                    <Mail className="size-[15px] text-muted-foreground" />
                    <Tag className="size-[15px] text-muted-foreground" />
                    <div className="w-px flex-1 bg-border/70" />
                </button>
            ) : (
                // Inner content is fixed at the open width so text doesn't reflow mid-slide.
                <div className="flex h-full w-[280px] flex-col">
                    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border pl-3 pr-1.5">
                        <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">Mail</span>
                        <button
                            type="button"
                            onClick={onTogglePin}
                            title="Collapse — reopen from the edge strip"
                            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                            <PanelLeftClose className="size-3.5" />
                        </button>
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col">
                        <div className="flex flex-col gap-0.5 px-2 pt-2">
                            {viewRow(
                                inInbox && inboxFilter === 'all',
                                <Mail className="size-3.5 shrink-0 text-muted-foreground" />,
                                'All mail', null,
                                () => onSelect({ kind: 'all' }),
                            )}
                            {viewRow(
                                inInbox && inboxFilter === 'important',
                                <Star className="size-3.5 shrink-0 text-muted-foreground" />,
                                'Important', null,
                                () => onSelect({ kind: 'important' }),
                            )}
                            {viewRow(
                                inInbox && inboxFilter === 'reply-ready',
                                <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />,
                                'Reply ready', replyReadyCount,
                                () => onSelect({ kind: 'reply-ready' }),
                            )}
                            {viewRow(
                                inInbox && inboxFilter === 'other' && !otherCategory,
                                <Inbox className="size-3.5 shrink-0 text-muted-foreground" />,
                                'Everything else', otherTotal,
                                () => onSelect({ kind: 'other' }),
                            )}
                            {viewRow(
                                view === 'drafts',
                                <PenLine className="size-3.5 shrink-0 text-muted-foreground" />,
                                'Drafts', draftCount,
                                () => onSelect({ kind: 'drafts' }),
                            )}
                        </div>

                        {categories.length > 0 && (
                            <>
                                <div className="mt-3 flex items-center gap-2 px-3 pr-2">
                                    <span className="text-[13px] text-muted-foreground">Categories</span>
                                    <span className="text-[11px] text-muted-foreground/70">{categories.length}</span>
                                </div>
                                <div className="mt-1 flex-1 min-h-0 overflow-y-auto px-2 pb-2">
                                    <div className="flex flex-col gap-0.5">
                                        {categories.map((cat) => {
                                            const active = inInbox && otherCategory === cat
                                            return (
                                                <button
                                                    key={cat}
                                                    type="button"
                                                    // Clicking the active category clears it back to all of Everything else.
                                                    onClick={() => onSelect({ kind: 'other', category: active ? null : cat })}
                                                    className={cn(
                                                        'flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]',
                                                        active ? 'bg-accent font-medium text-foreground' : 'text-foreground/90 hover:bg-accent/50',
                                                    )}
                                                >
                                                    <Tag className="size-3.5 shrink-0 text-muted-foreground" />
                                                    <span className="flex-1 truncate">{labelNameFor(labels, cat)}</span>
                                                    <span className="text-[11px] tabular-nums text-muted-foreground">{categoryCounts[cat]}</span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </aside>
    )
}
