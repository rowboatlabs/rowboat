import { cn } from '@/lib/utils'
import type { SpaceBadge } from '@/lib/spaces-read-state'

/**
 * The dot-and-count badge (2026-09-10, Ramnique's design). Every row with
 * anything unread shows a dot and a figure: a grey dot means nothing here is
 * for you and the figure is the unread count; a red dot means the figure is
 * how many are for you — mentions, or every message in a DM. Hover gives
 * both. No fill, no pill: the colour carries the meaning.
 */
export function UnreadBadge({ badge, direct = false, className }: { badge: SpaceBadge; direct?: boolean; className?: string }) {
    if (badge.unread <= 0) return null
    const forYou = badge.forYou > 0
    const figure = forYou ? badge.forYou : badge.unread
    const title = direct
        ? `${badge.unread} unread · all for you`
        : forYou
          ? `${badge.unread} unread · ${badge.forYou} for you`
          : `${badge.unread} unread · none for you`
    return (
        <span className={cn('flex shrink-0 items-center gap-[5px] text-[11.5px] leading-4 tabular-nums', className)} title={title} aria-label={title}>
            <span aria-hidden className={cn('size-1.5 rounded-full', forYou ? 'bg-[var(--stream-alert)]' : 'bg-muted-foreground')} />
            <span className={forYou ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground'}>{figure > 999 ? '999+' : figure}</span>
        </span>
    )
}
