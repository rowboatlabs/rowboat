import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AtSign, Copy, Loader2, Mail, MessageSquare, MoreHorizontal } from 'lucide-react'
import type { spaces } from '@x/shared'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useMemberNames, useSpaceProfiles } from '@/components/spaces/member-text'
import { useSpaceNav, useSpaceRefs } from '@/components/spaces/space-nav'
import { requestComposeInsert } from '@/lib/spaces-compose'
import { mentionToken } from '@x/shared/dist/spaces.js'
import { avatarColorClass, initials, orgMonogram } from '@/lib/spaces-presentation'
import { refreshSpacesAccountState, refreshSpacesOrgs, useSpacesAccountState } from '@/hooks/use-spaces'
import { toast } from '@/lib/toast'

// Shared atoms for the Spaces surfaces: identity visuals, the segmented
// control, the dev add-org dialog, and the @rowboat trigger.

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


export function AddOrgDialog({ open, onOpenChange, onAdded, initialAction }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onAdded: (orgId: string, spaceId?: string) => void
    initialAction?: 'create' | 'join'
}) {
    // One dialog. With no Rowboat session the first door is "Sign in with
    // Rowboat" — one browser trip, then every managed org the person belongs
    // to appears (one session, two uses — the app itself stays signed out).
    // Then two doors that need no browser when a session exists: name a new
    // server on the managed deployment (free for now — the address is
    // generated in core, the user only names it), or paste an invite link
    // (resolved pre-auth, so the card shows what's being joined). A server
    // by address (self-hosted orgs) and a dev org against the stub stay
    // behind the … menu.
    const [mode, setMode] = useState<'main' | 'address' | 'dev'>('main')
    const account = useSpacesAccountState()
    const [serverAddress, setServerAddress] = useState('')
    const [inviteUrl, setInviteUrl] = useState('')
    const [preview, setPreview] = useState<{ org: string; space: string; invitedBy?: string } | null>(null)
    const [orgName, setOrgName] = useState('')
    // The apex (/v1/config via core) gates Create. null = no spaces fleet for
    // this environment; undefined = loading.
    const [apexDomain, setApexDomain] = useState<string | null | undefined>(undefined)

    useEffect(() => {
        if (!open || apexDomain !== undefined) return
        void window.ipc.invoke('spaces:apexInfo', null)
            .then(({ apexDomain: domain }) => setApexDomain(domain))
            .catch(() => setApexDomain(null))
    }, [open, apexDomain])
    const [baseUrl, setBaseUrl] = useState('http://localhost:4272')
    const [memberId, setMemberId] = useState('')
    const [busy, setBusy] = useState(false)
    // Which door fired the browser dance — its button carries the spinner.
    const [waiting, setWaiting] = useState<'join' | 'create' | 'signin' | 'address' | null>(null)

    const signInRowboat = async () => {
        setBusy(true)
        setWaiting('signin')
        try {
            const { orgs } = await window.ipc.invoke('spaces:signInRowboat', null)
            refreshSpacesAccountState()
            void refreshSpacesOrgs()
            toast(orgs.length > 0 ? `Signed in — ${orgs.length} ${orgs.length === 1 ? 'server' : 'servers'} ready` : 'Signed in to Rowboat', 'success')
            if (orgs.length > 0) {
                onOpenChange(false)
                onAdded(orgs[0].id)
            }
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Sign-in failed', 'error')
        } finally {
            setBusy(false)
            setWaiting(null)
        }
    }

    const addByAddress = async () => {
        if (!serverAddress.trim()) return
        setBusy(true)
        setWaiting('address')
        try {
            const { org } = await window.ipc.invoke('spaces:addOrgByAddress', { address: serverAddress.trim() })
            toast(`Signed into ${org.name}`, 'success')
            onOpenChange(false)
            setServerAddress('')
            onAdded(org.id)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not add the server', 'error')
        } finally {
            setBusy(false)
            setWaiting(null)
        }
    }

    const createOrg = async () => {
        if (!orgName.trim()) return
        setBusy(true)
        setWaiting('create')
        try {
            const { org } = await window.ipc.invoke('spaces:createOrg', { name: orgName.trim() })
            toast(`Created ${org.name} — you're the admin`, 'success')
            onOpenChange(false)
            setOrgName('')
            onAdded(org.id)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not create the server', 'error')
        } finally {
            setBusy(false)
            setWaiting(null)
        }
    }

    // Pre-auth resolve as soon as the pasted text parses — show what's being joined.
    const resolvePreview = async (url: string) => {
        setInviteUrl(url)
        setPreview(null)
        if (!/\/join\//.test(url)) return
        try {
            const { resolved } = await window.ipc.invoke('spaces:resolveInviteLink', { url: url.trim() })
            if (resolved.state === 'ok') {
                setPreview({ org: resolved.org.name, space: resolved.space.name, ...(resolved.invitedBy ? { invitedBy: resolved.invitedBy } : {}) })
            } else {
                toast(`This invite is ${resolved.state}`, 'error')
            }
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not resolve the invite', 'error')
        }
    }

    const join = async () => {
        if (!inviteUrl.trim()) return
        setBusy(true)
        setWaiting('join')
        try {
            const { org, space } = await window.ipc.invoke('spaces:joinInvite', { url: inviteUrl.trim() })
            toast(`Joined ${space.name} on ${org.name}`, 'success')
            onOpenChange(false)
            setInviteUrl('')
            setPreview(null)
            onAdded(org.id, space.id)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not join', 'error')
        } finally {
            setBusy(false)
            setWaiting(null)
        }
    }

    const addDev = async () => {
        if (!baseUrl.trim() || !memberId.trim()) return
        setBusy(true)
        try {
            const { org } = await window.ipc.invoke('spaces:addOrg', { baseUrl: baseUrl.trim(), memberId: memberId.trim() })
            toast(`Signed into ${org.name} as ${org.memberId}`, 'success')
            onOpenChange(false)
            onAdded(org.id)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not reach the server', 'error')
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {/* Only the dev and address doors carry a description; without one,
                clear the link so Radix doesn't point at an element that isn't there. */}
            <DialogContent className="max-w-md" {...(mode !== 'main' ? {} : { 'aria-describedby': undefined })}>
                <DialogHeader>
                    <DialogTitle>{mode === 'dev' ? 'Add a dev server' : mode === 'address' ? 'Add a server by address' : initialAction === 'create' ? 'Create a server' : initialAction === 'join' ? 'Join a server' : 'Add a server'}</DialogTitle>
                    {mode !== 'main' && (
                        <DialogDescription>
                            {mode === 'dev'
                                ? 'Dev sign-in against a stub Harbor (run pnpm dev in apps/harbor/packages/server).'
                                : 'A self-hosted server, or one you’re already a member of.'}
                        </DialogDescription>
                    )}
                </DialogHeader>
                {mode === 'main' ? (
                    <div className="space-y-3">
                        {account && !account.hasSession && (
                            <>
                                <div>
                                    <div className="text-sm font-medium">Sign in with Rowboat</div>
                                    <p className="text-xs text-muted-foreground">Your servers appear once you’re signed in.</p>
                                    <Button onClick={() => void signInRowboat()} disabled={busy} className="mt-1.5 w-full">
                                        {waiting === 'signin' && <Loader2 className="size-3.5 mr-1 animate-spin" />} Sign in with Rowboat
                                    </Button>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="h-px flex-1 bg-border" />
                                    <span className="text-xs text-muted-foreground">or</span>
                                    <div className="h-px flex-1 bg-border" />
                                </div>
                            </>
                        )}
                        <div>
                            <div className="text-sm font-medium">Create a new server</div>
                            <p className="text-xs text-muted-foreground">Home for your team and their assistants, with spaces for each project. Free, and you’re its admin.</p>
                            <div className="mt-1.5 flex items-center gap-2">
                                <Input
                                    autoFocus={initialAction !== 'join'}
                                    value={orgName}
                                    onChange={(e) => setOrgName(e.target.value)}
                                    placeholder="Acme, book club, just me…"
                                    className="flex-1"
                                    onKeyDown={(e) => e.key === 'Enter' && void createOrg()}
                                />
                                <Button onClick={() => void createOrg()} disabled={busy || !orgName.trim() || !apexDomain} className="shrink-0">
                                    {waiting === 'create' && <Loader2 className="size-3.5 mr-1 animate-spin" />} Create
                                </Button>
                            </div>
                            {apexDomain === null && (
                                <p className="mt-1.5 text-xs text-muted-foreground">
                                    Spaces isn’t available for this environment yet.
                                </p>
                            )}
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="h-px flex-1 bg-border" />
                            <span className="text-xs text-muted-foreground">or</span>
                            <div className="h-px flex-1 bg-border" />
                        </div>
                        <div>
                            <div className="text-sm font-medium">Join a server</div>
                            <p className="text-xs text-muted-foreground">Paste an invite link someone sent you.</p>
                            <div className="mt-1.5 flex items-center gap-2">
                                <Input
                                    autoFocus={initialAction === 'join'}
                                    value={inviteUrl}
                                    onChange={(e) => void resolvePreview(e.target.value)}
                                    placeholder="https://org.example/join/…"
                                    className="flex-1"
                                    onKeyDown={(e) => e.key === 'Enter' && void join()}
                                />
                                <Button onClick={() => void join()} disabled={busy || !inviteUrl.trim()} className="shrink-0">
                                    {waiting === 'join' && <Loader2 className="size-3.5 mr-1 animate-spin" />} Join
                                </Button>
                            </div>
                            {preview && (
                                <div className="mt-2 rounded-md border px-3 py-2 text-sm">
                                    Join <span className="font-medium">{preview.space}</span> on{' '}
                                    <span className="font-medium">{preview.org}</span>
                                    {preview.invitedBy ? <span className="text-muted-foreground"> — invited by {preview.invitedBy}</span> : null}
                                </div>
                            )}
                        </div>
                        {waiting && (
                            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                                <Loader2 className="size-3 animate-spin" /> Waiting for the browser sign-in…
                            </div>
                        )}
                        <div className="flex items-center justify-between">
                            {/* Dev sign-in stays reachable (Tailscale dogfood runs it in
                                packaged builds) but hides behind … — a visible link here
                                reads as a third way in to people who only have two. */}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        aria-label="More options"
                                        className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
                                    >
                                        <MoreHorizontal className="size-3.5" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                    <DropdownMenuItem onClick={() => setMode('address')}>Add a server by address</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setMode('dev')}>Add a dev server</DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                        </div>
                    </div>
                ) : mode === 'address' ? (
                    <div className="space-y-3">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Server address</label>
                            <Input
                                autoFocus
                                value={serverAddress}
                                onChange={(e) => setServerAddress(e.target.value)}
                                placeholder="acme.spaces.example or just the slug"
                                onKeyDown={(e) => e.key === 'Enter' && void addByAddress()}
                            />
                            <p className="mt-1 text-xs text-muted-foreground">A URL, a host, or a Rowboat server’s slug. You need to already be a member — otherwise ask for an invite link.</p>
                        </div>
                        {waiting === 'address' && (
                            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                                <Loader2 className="size-3 animate-spin" /> Waiting for the browser sign-in…
                            </div>
                        )}
                        <div className="flex items-center justify-between">
                            <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setMode('main')}>
                                back
                            </button>
                            <div className="flex gap-2">
                                <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                                <Button onClick={() => void addByAddress()} disabled={busy || !serverAddress.trim()}>
                                    {waiting === 'address' && <Loader2 className="size-3.5 mr-1 animate-spin" />} Add
                                </Button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Server URL</label>
                            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:4272" />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Member id</label>
                            <Input
                                value={memberId}
                                onChange={(e) => setMemberId(e.target.value)}
                                placeholder="e.g. ramnique"
                                onKeyDown={(e) => e.key === 'Enter' && void addDev()}
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setMode('main')}>
                                back
                            </button>
                            <div className="flex gap-2">
                                <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                                <Button onClick={() => void addDev()} disabled={busy || !baseUrl.trim() || !memberId.trim()}>
                                    {busy && <Loader2 className="size-3.5 mr-1 animate-spin" />} Sign in
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
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
