import { Inbox, Mail, PanelLeftClose, PanelLeftOpen, PenLine, Sparkles, Star, Tag } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SecondaryRail, type SecondaryRailContext } from '@/components/secondary-rail'
import { labelNameFor, orderedCategoryIds, type EmailLabelInfo } from '@/lib/email-labels'

// The email section's rail: quick subsetting of the inbox, on the same
// SecondaryRail shell as the Spaces rail (docked + drag-resize, collapsed
// sliver, hover peek drawer). Fixed views on top (All mail / Important /
// Reply ready / Everything else / Drafts), then one row per category with
// mail in it; a category click narrows Everything else the same way the
// pills do (the two stay in sync — both read the same filter state).

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

    const renderBody = ({ togglePin }: SecondaryRailContext) => (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border pl-3 pr-1.5">
                <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">Mail</span>
                {/* Docked: close. Peeked: the lock — dock it. Same spot, flipped glyph. */}
                <button
                    type="button"
                    onClick={togglePin}
                    title={open ? 'Close sidebar' : 'Lock sidebar open'}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                    {open ? <PanelLeftClose className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
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
    )

    return (
        <SecondaryRail open={open} onTogglePin={onTogglePin} widthStorageKey="email:railWidth">
            {renderBody}
        </SecondaryRail>
    )
}
