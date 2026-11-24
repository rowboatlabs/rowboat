import { Lock, Users } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// Who can use an agent (Harbor spec §4 Agent members): a channel agent is
// anyone's in its spaces, a personal one its owner's alone (2026-10-26). Chosen
// on Add and on Create, and its owner switches it from its page (2026-10-27),
// so every agent with an owner shows which it is, channel included.

/** "Channel" or "Personal"; nothing for a built-in agent, which has no owner and is always a channel agent. */
export function accessLabel(agent: Pick<spaces.Member, 'ownerId' | 'personal'>): string | null {
    if (!agent.ownerId) return null
    return agent.personal ? 'Personal' : 'Channel'
}

/**
 * The mark on an agent's card (Agents page, 2026-10-27): just an icon, a lock
 * for personal and people for channel; hovering it names which and says what
 * that means. Personal takes the link colour so it stands out; channel is the
 * usual case and stays quiet.
 */
export function AccessBadge({ agent, ownerName, className }: {
    agent: Pick<spaces.Member, 'ownerId' | 'personal'>
    /** Who it works for when personal; undefined means you. */
    ownerName?: string
    className?: string
}) {
    const label = accessLabel(agent)
    if (!label) return null
    const personal = agent.personal === true
    const explain = personal
        ? `Only ${ownerName ?? 'you'} can use it. Everyone sees it and its replies.`
        : 'Anyone who shares a space with it can mention it or DM it.'
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    role="img"
                    aria-label={`${label}: ${explain}`}
                    className={cn(
                        'relative z-10 flex size-6 shrink-0 cursor-default items-center justify-center rounded-md',
                        personal ? 'text-[var(--rowboat-link)]' : 'text-muted-foreground',
                        className,
                    )}
                >
                    {personal ? <Lock className="size-3.5" /> : <Users className="size-3.5" />}
                </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-60">
                <span className="font-medium">{label}</span>
                <span className="block opacity-80">{explain}</span>
            </TooltipContent>
        </Tooltip>
    )
}

const OPTIONS = [
    { value: false, label: 'Channel', description: 'Anyone in its spaces can mention it.' },
    { value: true, label: 'Personal', description: 'Only you can use it. Others see it and its replies.' },
] as const

/** Channel or personal, as two cards. `note` sits under them. */
export function AccessChoice({ personal, onChange, disabled, note, className }: {
    personal: boolean
    onChange: (personal: boolean) => void
    disabled?: boolean
    note?: string
    className?: string
}) {
    return (
        <div className={cn('flex flex-col gap-1.5', className)}>
            <span className="text-xs font-medium text-foreground">Who can use it</span>
            <div role="radiogroup" aria-label="Who can use it" className="grid grid-cols-2 gap-2">
                {OPTIONS.map((o) => (
                    <button
                        key={o.label}
                        type="button"
                        role="radio"
                        aria-checked={o.value === personal}
                        aria-label={o.label}
                        disabled={disabled}
                        onClick={() => o.value !== personal && onChange(o.value)}
                        className={cn(
                            'flex min-w-0 flex-col items-start rounded-lg border px-2.5 py-2 text-left disabled:opacity-60',
                            o.value === personal ? 'border-foreground/50 bg-accent' : 'border-border hover:bg-accent/50',
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
