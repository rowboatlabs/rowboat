import type { spaces } from '@x/shared'
import { threadStatusLabel, useThreadListing } from '@/lib/spaces-my-threads'
import { cn } from '@/lib/utils'

/**
 * Where a thread stands (2026-11-06, "coding session: threads" in Main): grey
 * when idle, amber when it needs you, green and gently pulsing while an agent
 * works (the pulse, so green never reads as "done"). Its words sit beside it
 * or in its label, so the dot is never the only way to tell.
 */
export function ThreadStatusDot({ status, className }: { status: spaces.ThreadStatus; className?: string }) {
    return <span aria-hidden title={threadStatusLabel(status)}
        className={cn('inline-block size-2 shrink-0 rounded-full',
            status === 'needs_you' ? 'bg-amber-500' : status === 'working' ? 'animate-pulse bg-emerald-500' : 'bg-muted-foreground/40',
            className)} />
}

/**
 * A session's pill on its first message's name line (2026-11-06): no line of
 * its own. The dot is where it stands for you when it is one of yours (grey
 * otherwise); an ended one says so.
 */
export function SessionPill({ orgId, message }: { orgId?: string; message: spaces.Message }) {
    const listing = useThreadListing(orgId, message.id)
    if (!message.session) return null
    const ended = !!message.archived
    const status: spaces.ThreadStatus = !ended && listing ? listing.status : 'idle'
    const label = ended ? 'Session, ended' : listing ? `Session, ${threadStatusLabel(status).toLowerCase()}` : 'Session'
    return <span role="img" aria-label={label} title={label}
        className="inline-flex items-center gap-1 self-center rounded-full border border-border px-1.5 text-[11px] font-medium leading-[18px] text-muted-foreground">
        <ThreadStatusDot status={status} className="size-1.5" />
        {ended ? 'Ended' : 'Session'}
    </span>
}
