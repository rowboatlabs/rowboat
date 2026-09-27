import { useRef, useState, type ReactNode } from 'react'
import { AtSign, Copy, Link as LinkIcon, Mail, MessageSquare } from 'lucide-react'
import type { spaces } from '@x/shared'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useMemberNames, useSpaceProfiles } from '@/components/spaces/member-text'
import { useSpaceNav, useSpaceRefs } from '@/components/spaces/space-nav'
import { requestComposeInsert } from '@/lib/spaces-compose'
import { memberUrl, mentionToken } from '@x/shared/dist/spaces.js'
import { avatarColorClass, initials, orgMonogram } from '@/lib/spaces-presentation'
import { toast } from '@/lib/toast'
import { copySpacesLink } from '@/lib/spaces-copy-link'

// Shared atoms for the Spaces surfaces: identity visuals, the segmented
// control, and the @rowboat trigger. The server dialogs live in server-dialogs.tsx.

// ---------------------------------------------------------------------------
// Identity atoms
// ---------------------------------------------------------------------------

export function MemberAvatar({ id, name, size = 'md', className }: {
    id: string
    name: string
    size?: 'sm' | 'md' | 'lg' | 'xl'
    className?: string
}) {
    // Stream dialect: people are near-square tiles; circles stay reserved for AI.
    const dims = size === 'sm' ? 'size-5 rounded-[4px] text-[9px]'
        : size === 'lg' ? 'size-8 rounded-[5px] text-xs'
        : size === 'xl' ? 'size-9 rounded-md text-[13px]'
        : 'size-7 rounded-[5px] text-[10.5px]'
    return (
        <span
            title={name}
            className={cn('inline-flex shrink-0 items-center justify-center font-semibold leading-none select-none', dims, avatarColorClass(id), className)}
        >
            {initials(name)}
        </span>
    )
}

/**
 * Click-a-face profile: wraps any avatar/name in a popover with what the org
 * actually knows about the member — name, role, presence, id. Email renders
 * only if the wire record ever carries one (it doesn't today; the IdP claim
 * is discarded at invite binding), so the row lights up the day it exists.
 */
export function MemberProfilePopover({ id, children }: { id: string; children: ReactNode }) {
    const names = useMemberNames()
    const { byId, here, selfId } = useSpaceProfiles()
    const refs = useSpaceRefs()
    const nav = useSpaceNav()
    const [open, setOpen] = useState(false)
    const member = byId.get(id)
    const name = member?.displayName ?? names.get(id) ?? id
    const email = (member as (spaces.Member & { email?: string }) | undefined)?.email
    const isHere = here.has(id)
    const copyId = () => {
        void navigator.clipboard.writeText(id).then(
            () => toast('Member id copied', 'success'),
            () => toast('Could not copy', 'error'),
        )
    }
    // The token, never the name: the composer's seed path parses it into a pill.
    const mention = () => {
        setOpen(false)
        requestComposeInsert(`${mentionToken({ kind: 'member', id, label: name })} `)
    }
    // The DM with them — the org creates it on first use (the pane navigates).
    const message = refs && nav?.onOpenDirect ? () => {
        setOpen(false)
        nav.onOpenDirect?.(refs.orgId, id)
    } : null
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{children}</PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-0">
                <div className="flex items-center gap-3 border-b border-border p-3">
                    <span className="relative shrink-0">
                        <MemberAvatar id={id} name={name} size="lg" />
                        {isHere && <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-popover" />}
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-semibold">{name}</span>
                            {id === selfId && <span className="shrink-0 text-xs text-muted-foreground">(you)</span>}
                            {member?.role === 'admin' && (
                                <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9.5px] font-medium uppercase tracking-wide text-muted-foreground">admin</span>
                            )}
                        </div>
                        <div className={cn('text-xs', isHere ? 'text-emerald-600' : 'text-muted-foreground')}>
                            {isHere ? 'Here now' : 'Away'}
                        </div>
                    </div>
                </div>
                <div className="flex flex-col gap-1 p-2 text-xs text-muted-foreground">
                    {email && (
                        <div className="flex items-center gap-2 px-1 py-0.5">
                            <Mail className="size-3 shrink-0" />
                            <span className="truncate select-text">{email}</span>
                        </div>
                    )}
                    {id !== selfId && message && (
                        <button
                            type="button"
                            onClick={message}
                            title="Open your direct message with them"
                            className="flex items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-accent hover:text-foreground"
                        >
                            <MessageSquare className="size-3 shrink-0" />
                            <span className="truncate">Message</span>
                        </button>
                    )}
                    {id !== selfId && (
                        <button
                            type="button"
                            onClick={mention}
                            title="Insert an @-mention into the composer"
                            className="flex items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-accent hover:text-foreground"
                        >
                            <AtSign className="size-3 shrink-0" />
                            <span className="truncate">Mention</span>
                        </button>
                    )}
                    {refs && (
                        <button
                            type="button"
                            onClick={() => void copySpacesLink(memberUrl(refs.orgAddress, id))}
                            className="flex items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-accent hover:text-foreground"
                        >
                            <LinkIcon className="size-3 shrink-0" /> Copy member link
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={copyId}
                        title="Copy member id"
                        className="flex items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-accent hover:text-foreground"
                    >
                        <Copy className="size-3 shrink-0" />
                        <span className="truncate font-mono">{id}</span>
                    </button>
                </div>
            </PopoverContent>
        </Popover>
    )
}

export function OrgMonogram({ org, size = 'md', className }: {
    org: { name: string; address: string }
    size?: 'sm' | 'md' | 'xl'
    className?: string
}) {
    const dims = size === 'sm' ? 'size-4 text-[8px] rounded-[3px]'
        : size === 'xl' ? 'size-14 text-xl rounded-2xl'
        : 'size-6 text-[10px] rounded-md'
    return (
        <span
            title={org.address}
            className={cn('inline-flex shrink-0 items-center justify-center bg-foreground text-background font-bold leading-none select-none', dims, className)}
        >
            {orgMonogram(org)}
        </span>
    )
}

export function AvatarStack({ members, max = 5 }: { members: spaces.Member[]; max?: number }) {
    const shown = members.slice(0, max)
    return (
        <div className="flex items-center -space-x-1.5">
            {shown.map((m) => (
                <MemberAvatar key={m.id} id={m.id} name={m.displayName} size="md" className="ring-2 ring-background" />
            ))}
            {members.length > max && (
                <span className="inline-flex size-7 items-center justify-center rounded-[5px] bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background">
                    +{members.length - max}
                </span>
            )}
        </div>
    )
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: {
    value: T
    options: Array<{ value: T; label: string }>
    onChange: (value: T) => void
    size?: 'sm' | 'md'
}) {
    return (
        <div className={cn('inline-flex items-center rounded-lg bg-muted p-0.5', size === 'sm' ? 'text-xs' : 'text-[13px]')}>
            {options.map((opt) => (
                <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChange(opt.value)}
                    className={cn(
                        'rounded-md font-medium transition-colors',
                        size === 'sm' ? 'px-2 py-0.5' : 'px-3 py-1',
                        value === opt.value
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                    )}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    )
}


/**
 * A single-line label that truncates, with a quick tooltip carrying the full
 * text — but only when the text is actually clipped, so rows that fit stay
 * silent on hover. `detail` adds a muted second line (e.g. a blob's size).
 */
export function ClippedText({ text, detail, className, side = 'right' }: {
    text: string
    detail?: string | null
    className?: string
    side?: 'top' | 'right' | 'bottom' | 'left'
}) {
    const ref = useRef<HTMLSpanElement | null>(null)
    const [open, setOpen] = useState(false)
    const clipped = () => !!ref.current && ref.current.scrollWidth > ref.current.clientWidth
    return (
        <Tooltip open={open} onOpenChange={(next) => setOpen(next && (clipped() || !!detail))} delayDuration={300}>
            <TooltipTrigger asChild>
                <span ref={ref} className={cn('min-w-0 truncate', className)}>{text}</span>
            </TooltipTrigger>
            <TooltipContent side={side} align="start" sideOffset={6} className="max-w-[320px] text-left text-wrap break-words">
                <div className="font-medium">{text}</div>
                {detail && <div className="opacity-70">{detail}</div>}
            </TooltipContent>
        </Tooltip>
    )
}
