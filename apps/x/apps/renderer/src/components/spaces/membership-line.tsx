import { LogOut, UserPlus } from 'lucide-react'
import type { spaces } from '@x/shared'
import { membershipLineText } from '@/lib/spaces-membership'
import { formatFullTimestamp } from '@/lib/spaces-presentation'

// Join and leave lines in the stream (2026-09-29, the Matrix model): a
// membership event from the log, drawn between messages — never a message,
// so nothing that counts or searches messages ever sees one.

export function MembershipLine({ event, at, names }: {
    event: spaces.MembershipEvent
    at: string
    names: ReadonlyMap<string, string>
}) {
    const Icon = event.action === 'joined' ? UserPlus : LogOut
    return (
        <div className="spaces-membership-line flex items-center gap-3 py-1 text-[13px] text-muted-foreground" title={formatFullTimestamp(at)}>
            <span className="flex w-9 shrink-0 justify-center"><Icon className="size-3.5" /></span>
            <span className="min-w-0 truncate">{membershipLineText(event, names)}</span>
        </div>
    )
}
