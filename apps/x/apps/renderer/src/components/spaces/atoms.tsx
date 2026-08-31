import { useEffect, useState, type ReactNode } from 'react'
import { AtSign, Copy, Loader2, Mail } from 'lucide-react'
import type { spaces } from '@x/shared'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useMemberNames, useSpaceProfiles } from '@/components/spaces/member-text'
import { requestComposeInsert } from '@/lib/spaces-compose'
import { avatarColorClass, initials, orgMonogram } from '@/lib/spaces-presentation'
import { toast } from '@/lib/toast'

// Shared atoms for the Spaces surfaces: identity visuals, the segmented
// control, the dev add-org dialog, and the @rowboat trigger.

// ---------------------------------------------------------------------------
// Identity atoms
// ---------------------------------------------------------------------------

export function MemberAvatar({ id, name, size = 'md', className }: {
    id: string
    name: string
    size?: 'sm' | 'md' | 'lg'
    className?: string
}) {
    const dims = size === 'sm' ? 'size-5 text-[9px]' : size === 'lg' ? 'size-8 text-xs' : 'size-7 text-[10.5px]'
    return (
        <span
            title={name}
            className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none select-none', dims, avatarColorClass(id), className)}
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
    const mention = () => {
        setOpen(false)
        requestComposeInsert(`@${name} `)
    }
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
    size?: 'sm' | 'md'
    className?: string
}) {
    const dims = size === 'sm' ? 'size-4 text-[8px] rounded-[3px]' : 'size-6 text-[10px] rounded-md'
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
                <span className="inline-flex size-7 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background">
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


export function AddOrgDialog({ open, onOpenChange, onAdded }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onAdded: () => void
}) {
    // Three ways in: create your own org on the managed deployment (free for
    // now), paste an invite link (resolve pre-auth, then join with a
    // system-browser sign-in), or a dev org against the stub.
    const [mode, setMode] = useState<'invite' | 'create' | 'dev'>('invite')
    const [inviteUrl, setInviteUrl] = useState('')
    const [preview, setPreview] = useState<{ org: string; space: string; invitedBy?: string } | null>(null)
    const [orgName, setOrgName] = useState('')
    const [slug, setSlug] = useState('')
    const [slugEdited, setSlugEdited] = useState(false)
    // The org-address suffix comes from the configured apex (/v1/config via
    // core). null = no spaces fleet for this environment; undefined = loading.
    const [apexDomain, setApexDomain] = useState<string | null | undefined>(undefined)

    useEffect(() => {
        if (mode !== 'create' || apexDomain !== undefined) return
        void window.ipc.invoke('spaces:apexInfo', null)
            .then(({ apexDomain: domain }) => setApexDomain(domain))
            .catch(() => setApexDomain(null))
    }, [mode, apexDomain])
    const [baseUrl, setBaseUrl] = useState('http://localhost:4272')
    const [memberId, setMemberId] = useState('')
    const [busy, setBusy] = useState(false)
    const [waitingBrowser, setWaitingBrowser] = useState(false)

    const suggestSlug = (name: string) =>
        name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

    const createOrg = async () => {
        if (!orgName.trim() || !slug.trim()) return
        setBusy(true)
        setWaitingBrowser(true)
        try {
            const { org } = await window.ipc.invoke('spaces:createOrg', { name: orgName.trim(), slug: slug.trim() })
            toast(`Created ${org.name} — you're the admin`, 'success')
            onOpenChange(false)
            setOrgName('')
            setSlug('')
            setSlugEdited(false)
            onAdded()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not create the org', 'error')
        } finally {
            setBusy(false)
            setWaitingBrowser(false)
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
        setWaitingBrowser(true)
        try {
            const { org, space } = await window.ipc.invoke('spaces:joinInvite', { url: inviteUrl.trim() })
            toast(`Joined ${space.name} on ${org.name}`, 'success')
            onOpenChange(false)
            setInviteUrl('')
            setPreview(null)
            onAdded()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not join', 'error')
        } finally {
            setBusy(false)
            setWaitingBrowser(false)
        }
    }

    const addDev = async () => {
        if (!baseUrl.trim() || !memberId.trim()) return
        setBusy(true)
        try {
            const { org } = await window.ipc.invoke('spaces:addOrg', { baseUrl: baseUrl.trim(), memberId: memberId.trim() })
            toast(`Signed into ${org.name} as ${org.memberId}`, 'success')
            onOpenChange(false)
            onAdded()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not reach the org', 'error')
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {mode === 'invite' ? 'Join a space' : mode === 'create' ? 'Create an org' : 'Add a dev org'}
                    </DialogTitle>
                    <DialogDescription>
                        {mode === 'invite'
                            ? 'Paste an invite link. Signing in opens your browser.'
                            : mode === 'create'
                              ? 'Your team’s own corner — you’ll be its admin. Signing in opens your browser.'
                              : 'Dev sign-in against a stub Harbor (run pnpm dev in apps/harbor/packages/server).'}
                    </DialogDescription>
                </DialogHeader>
                {mode === 'create' ? (
                    <div className="space-y-3">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Org name</label>
                            <Input
                                autoFocus
                                value={orgName}
                                onChange={(e) => {
                                    setOrgName(e.target.value)
                                    if (!slugEdited) setSlug(suggestSlug(e.target.value))
                                }}
                                placeholder="Acme Inc"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Address</label>
                            <div className="flex items-center gap-1">
                                <Input
                                    value={slug}
                                    onChange={(e) => {
                                        setSlugEdited(true)
                                        setSlug(suggestSlug(e.target.value))
                                    }}
                                    placeholder="acme"
                                    className="flex-1"
                                    onKeyDown={(e) => e.key === 'Enter' && void createOrg()}
                                />
                                <span className="text-xs text-muted-foreground shrink-0">
                                    {apexDomain ? `.${apexDomain}` : '.…'}
                                </span>
                            </div>
                        </div>
                        {apexDomain === null && (
                            <p className="text-xs text-muted-foreground">
                                Spaces isn’t available for this environment yet.
                            </p>
                        )}
                        {waitingBrowser && (
                            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                                <Loader2 className="size-3 animate-spin" /> Waiting for the browser sign-in…
                            </div>
                        )}
                        <div className="flex items-center justify-between">
                            <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setMode('invite')}>
                                have an invite link?
                            </button>
                            <div className="flex gap-2">
                                <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                                <Button onClick={() => void createOrg()} disabled={busy || !orgName.trim() || !slug.trim() || !apexDomain}>
                                    {busy && <Loader2 className="size-3.5 mr-1 animate-spin" />} Create
                                </Button>
                            </div>
                        </div>
                    </div>
                ) : mode === 'invite' ? (
                    <div className="space-y-3">
                        <Input
                            autoFocus
                            value={inviteUrl}
                            onChange={(e) => void resolvePreview(e.target.value)}
                            placeholder="https://org.example/join/…"
                            onKeyDown={(e) => e.key === 'Enter' && void join()}
                        />
                        {preview && (
                            <div className="rounded-md border px-3 py-2 text-sm">
                                Join <span className="font-medium">{preview.space}</span> on{' '}
                                <span className="font-medium">{preview.org}</span>
                                {preview.invitedBy ? <span className="text-muted-foreground"> — invited by {preview.invitedBy}</span> : null}
                            </div>
                        )}
                        {waitingBrowser && (
                            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                                <Loader2 className="size-3 animate-spin" /> Waiting for the browser sign-in…
                            </div>
                        )}
                        <div className="flex items-center justify-between">
                            <div className="flex gap-3">
                                <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setMode('create')}>
                                    create an org
                                </button>
                                <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setMode('dev')}>
                                    dev org
                                </button>
                            </div>
                            <div className="flex gap-2">
                                <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                                <Button onClick={() => void join()} disabled={busy || !inviteUrl.trim()}>
                                    {busy && <Loader2 className="size-3.5 mr-1 animate-spin" />} Join
                                </Button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Org address</label>
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
                            <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setMode('invite')}>
                                invite link instead
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

