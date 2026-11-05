import { Timer } from 'lucide-react'
import type { spaces } from '@x/shared'
import { sessionStatusLabel, useSessionListing } from '@/lib/spaces-sessions'
import { cn } from '@/lib/utils'

/**
 * Where a session stands (2026-11-05, harbor mySessions): amber when it needs
 * you, a pulsing accent while an agent works, quiet when idle. The label
 * rides the title, so the dot is never the only way to tell.
 */
export function SessionStatusDot({ status, className }: { status: spaces.SessionStatus; className?: string }) {
    return <span role="img" aria-label={sessionStatusLabel(status)} title={sessionStatusLabel(status)}
        className={cn('inline-block size-2 shrink-0 rounded-full',
            status === 'needs_you' ? 'bg-amber-500' : status === 'working' ? 'animate-pulse bg-[var(--stream-link)]' : 'bg-muted-foreground/40',
            className)} />
}

/**
 * The line over a session's first message (2026-11-05): that it is a session,
 * and where it stands for you when it is one of yours, or that it ended.
 */
export function SessionLine({ orgId, message }: { orgId?: string; message: spaces.Message }) {
    const listing = useSessionListing(orgId, message.id)
    if (!message.session) return null
    return <div className="mb-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Timer className="size-3.5 shrink-0" aria-hidden />
        <span className="font-medium">Session</span>
        {message.archived
            ? <span>· ended</span>
            : listing && <span className="inline-flex items-center gap-1">· <SessionStatusDot status={listing.status} /> {sessionStatusLabel(listing.status)}</span>}
    </div>
}
