import type { spaces } from '@x/shared'
import { MemberAvatar } from '@/components/spaces/atoms'
import { actorLabel, reasonLabel, excerptOf } from '@/lib/spaces-activity'
import { formatFeedTime } from '@/lib/spaces-presentation'
import { cn } from '@/lib/utils'

type Item = spaces.SpacesActivityItem

export function ActivityRow({ item, names, spaceNames, onOpen, compact = false }: { compact?: boolean; item: Item; names: ReadonlyMap<string, string>; spaceNames: ReadonlyMap<string, string>; onOpen: () => void }) {
    const lead = item.actors[0]
    const who = actorLabel(item.actors, names)
    const excerpt = excerptOf(item.message.body, names, spaceNames)
    if (compact) return (
        <button type="button" onClick={onOpen}
            className={cn('group flex w-full items-start gap-1.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-accent/60', item.unread && 'bg-accent/30')}
            title={`${who} ${reasonLabel(item)}\n${excerpt}\n${new Date(item.at).toLocaleString()}`}>
            <span className="mt-[9px] flex w-1.5 shrink-0 justify-center">
                {item.unread && <span className="size-1.5 rounded-full bg-[var(--stream-alert)]" aria-label="unread" />}
            </span>
            <MemberAvatar id={lead?.memberId ?? ''} name={names.get(lead?.memberId ?? '') ?? who} size="sm" className="mt-0.5 size-5 rounded-[5px] text-[8px]" />
            <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                    <span className="min-w-0 truncate text-[13px]"><span className={cn('font-semibold', !item.unread && 'font-medium')}>{who}</span></span>
                    <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatFeedTime(item.at)}</span>
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">{reasonLabel(item)}</span>
                <span className={cn('mt-0.5 block truncate text-xs', item.unread ? 'text-foreground' : 'text-muted-foreground')}>
                    {item.kind === 'reaction' && <span className="text-muted-foreground">You: </span>}
                    {excerpt || <span className="italic text-muted-foreground">(no text)</span>}
                </span>
            </span>
        </button>
    )
    // The Activity page's row (2026-10-21): 14px like the rest of the app, a
    // 32px face, the unread dot in its own gutter so every row's text lines up.
    return (
        <button type="button" onClick={onOpen}
            className={cn('group flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-accent/60',
                item.unread && 'bg-[color-mix(in_srgb,var(--stream-link)_5%,transparent)]')}
            title={`${who} ${reasonLabel(item)}\n${excerpt}\n${new Date(item.at).toLocaleString()}`}>
            <span className="flex h-8 w-1.5 shrink-0 items-center justify-center">
                {item.unread && <span className="size-1.5 rounded-full bg-[var(--stream-alert)]" aria-label="unread" />}
            </span>
            <MemberAvatar id={lead?.memberId ?? ''} name={names.get(lead?.memberId ?? '') ?? who} size="md" className="size-8 shrink-0 text-[11px]" />
            <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-3">
                    <span className="min-w-0 truncate text-sm">
                        <span className={cn('text-foreground', item.unread ? 'font-semibold' : 'font-medium')}>{who}</span>
                        <span className="text-muted-foreground"> {reasonLabel(item)}</span>
                    </span>
                    <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{formatFeedTime(item.at)}</span>
                </span>
                <span className={cn('mt-1 line-clamp-2 block text-sm leading-relaxed', item.unread ? 'text-foreground/90' : 'text-muted-foreground')}>
                    {item.kind === 'reaction' && <span className="text-muted-foreground">You: </span>}
                    {excerpt || <span className="italic text-muted-foreground">(no text)</span>}
                </span>
            </span>
        </button>
    )
}
