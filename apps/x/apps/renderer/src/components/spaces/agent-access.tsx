import { Lock, Users } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// An agent's seat in a space (Harbor spec §4 Agent members, 2026-11-09:
// `Membership.invocableBy`): who may ask it there — everyone in the space,
// or its owner alone. Chosen by the owner when adding it to a space (the
// default is everyone: you chose to bring it into the group) and changed any
// time from the member list or the agent's page. It replaced the global
// personal flag of 2026-10-26.

export type Seat = 'owner' | 'members'

/** "Everyone here" or "Only <owner>". */
export function seatLabel(seat: Seat, ownerName?: string): string {
    return seat === 'owner' ? `Only ${ownerName ?? 'its owner'}` : 'Everyone here'
}

/**
 * The mark beside an agent in a member list: a lock for an owner-only seat,
 * people for one everyone may use; hovering it says what that means.
 */
export function SeatBadge({ seat, ownerName, className }: { seat: Seat; ownerName?: string; className?: string }) {
    const ownerOnly = seat === 'owner'
    const explain = ownerOnly
        ? `Only ${ownerName ?? 'its owner'} can ask it here. Everyone sees it and its replies.`
        : 'Anyone in this group can mention it.'
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    role="img"
                    aria-label={`${seatLabel(seat, ownerName)}: ${explain}`}
                    className={cn('relative z-10 flex size-6 shrink-0 cursor-default items-center justify-center rounded-md', ownerOnly ? 'text-[var(--rowboat-link)]' : 'text-muted-foreground', className)}
                >
                    {ownerOnly ? <Lock className="size-3.5" /> : <Users className="size-3.5" />}
                </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-60">
                <span className="font-medium">{seatLabel(seat, ownerName)}</span>
                <span className="block opacity-80">{explain}</span>
            </TooltipContent>
        </Tooltip>
    )
}

const OPTIONS: ReadonlyArray<{ value: Seat; label: string; description: string }> = [
    { value: 'members', label: 'Everyone here', description: 'Anyone in the group can mention it.' },
    { value: 'owner', label: 'Only me', description: 'Only you can ask it. Others see it and its replies.' },
]

/** The seat, as two cards. `note` sits under them. */
export function SeatChoice({ seat, onChange, disabled, note, className }: {
    seat: Seat
    onChange: (seat: Seat) => void
    disabled?: boolean
    note?: string
    className?: string
}) {
    return (
        <div className={cn('flex flex-col gap-1.5', className)}>
            <span className="text-xs font-medium text-foreground">Who can ask it</span>
            <div role="radiogroup" aria-label="Who can ask it" className="grid grid-cols-2 gap-2">
                {OPTIONS.map((o) => (
                    <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={o.value === seat}
                        aria-label={o.label}
                        disabled={disabled}
                        onClick={() => o.value !== seat && onChange(o.value)}
                        className={cn(
                            'flex min-w-0 flex-col items-start rounded-lg border px-2.5 py-2 text-left disabled:opacity-60',
                            o.value === seat ? 'border-foreground/50 bg-accent' : 'border-border hover:bg-accent/50',
                        )}
                    >
                        <span className="text-xs font-medium text-foreground">{o.label}</span>
                        <span className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{o.description}</span>
                    </button>
                ))}
            </div>
            {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
        </div>
    )
}
