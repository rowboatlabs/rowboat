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
    return (
        <button type="button" onClick={onOpen}
            className={cn('group flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent/60', item.unread && 'bg-accent/30', compact && 'gap-1.5 px-1.5 py-1.5')}
            title={`${who} ${reasonLabel(item)}\n${excerpt}\n${new Date(item.at).toLocaleString()}`}>
            <span className="mt-[9px] flex w-1.5 shrink-0 justify-center">
                {item.unread && <span className="size-1.5 rounded-full bg-[var(--stream-alert)]" aria-label="unread" />}
            </span>
            <MemberAvatar id={lead?.memberId ?? ''} name={names.get(lead?.memberId ?? '') ?? who} size="sm" className={cn("mt-0.5 size-6 rounded-[5px] text-[9px]", compact && "size-5 text-[8px]")} />
            <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                    <span className="min-w-0 truncate text-[13px]">
                        <span className={cn('font-semibold', !item.unread && 'font-medium')}>{who}</span>
                        {!compact && <span className="text-muted-foreground"> {reasonLabel(item)}</span>}
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatFeedTime(item.at)}</span>
                </span>
                {compact && <span className="block truncate text-[11px] text-muted-foreground">{reasonLabel(item)}</span>}
                <span className={cn('mt-0.5 block text-[13px]', compact ? 'truncate text-xs' : 'line-clamp-2', item.unread ? 'text-foreground' : 'text-muted-foreground')}>
                    {item.kind === 'reaction' && <span className="text-muted-foreground">You: </span>}
                    {excerpt || <span className="italic text-muted-foreground">(no text)</span>}
                </span>
            </span>
        </button>
    )
}
