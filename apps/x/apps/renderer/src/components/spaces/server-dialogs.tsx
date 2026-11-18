import { avatarColorClass, initials } from '@/lib/spaces-presentation'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2, MoreHorizontal, Hash, Link as LinkIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { refreshSpacesOrgs, useSpacesAccountState } from '@/hooks/use-spaces'
import { consumeServerDialog, subscribeServerDialog, type ServerDialogRequest } from '@/lib/server-dialog'
import { toast } from '@/lib/toast'
import * as analytics from '@/lib/analytics'
import { LOCAL_RUNTIME } from '@/lib/feature-flags'

// The server dialogs, one host for the whole app (lib/server-dialog.ts is
// how anything opens one). One intent: JOIN a group (or a person's DM) you
// were sent a link to. Two rarer ways in — a self-hosted server by address,
// a dev server — are their own small screens reached from Join's ··· menu,
// with a way back. Creating a server went with the orgs (2026-11-09).
//
// Sign-in (one session, two uses) is folded in rather than a door of its
// own: Join needs none up front — the join itself signs the person in, and
// the dialog just says so.

/** What a finished dialog hands back: the server, and the space (or DM) to land in when one is known. */
export type ServerDialogDone = (orgId: string, spaceId?: string) => void

export function ServerDialogs({ onDone }: { onDone: ServerDialogDone }) {
    const [request, setRequest] = useState<ServerDialogRequest | null>(null)
    // A remount per request: each dialog's fields start clean, and a second
    // invite link replaces the first rather than sharing its state.
    const [seq, setSeq] = useState(0)

    useEffect(() => {
        const take = () => {
            const next = consumeServerDialog()
            if (next) {
                setRequest(next)
                setSeq((n) => n + 1)
            }
        }
        take()
        return subscribeServerDialog(take)
    }, [])

    if (!request) return null
    const close = () => setRequest(null)
    const done: ServerDialogDone = (orgId, spaceId) => {
        close()
        void refreshSpacesOrgs().then(() => onDone(orgId, spaceId))
    }
    const swap = (next: ServerDialogRequest) => {
        setRequest(next)
        setSeq((n) => n + 1)
    }
    const key = `${request.kind}-${seq}`
    switch (request.kind) {
        case 'join':
            return (
                <JoinServerDialog
                    key={key}
                    inviteUrl={request.inviteUrl}
                    autoJoin={request.autoJoin === true}
                    onClose={close}
                    onDone={done}
                    onByAddress={() => swap({ kind: 'address' })}
                    onDev={() => swap({ kind: 'dev' })}
                />
            )
        case 'address':
            return <AddressServerDialog key={key} onClose={close} onDone={done} onBack={() => swap({ kind: 'join' })} />
        case 'dev':
            return <DevServerDialog key={key} onClose={close} onDone={done} onBack={() => swap({ kind: 'join' })} />
    }
}

// ---------------------------------------------------------------------------
// The shell every server dialog shares: title, optional one-line description,
// body, and a footer whose left side is the quiet cross-link and whose right
// side holds Cancel plus the one primary action.
// ---------------------------------------------------------------------------

function Shell({ title, description, children, footerLeft, footerRight, onClose }: {
    title: string
    description?: string
    children: ReactNode
    footerLeft?: ReactNode
    footerRight: ReactNode
    onClose: () => void
}) {
    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
            {/* Without a description, clear the aria link so Radix doesn't point at an element that isn't there. */}
            <DialogContent className="max-w-md" {...(description ? {} : { 'aria-describedby': undefined })}>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description && <DialogDescription>{description}</DialogDescription>}
                </DialogHeader>
                <div className="space-y-3">{children}</div>
                <div className="flex items-center justify-between gap-3 pt-1">
                    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">{footerLeft}</div>
                    <div className="flex shrink-0 gap-2">{footerRight}</div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

function FooterLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" onClick={onClick} className="truncate text-xs text-muted-foreground hover:text-foreground hover:underline">
            {children}
        </button>
    )
}

// The desktop signs in through the system browser and waits for it; the web
// app (no core beside the page, so LOCAL_RUNTIME is off) signs in by leaving
// the page, and comes back to it.
function BrowserWait() {
    return (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> {LOCAL_RUNTIME ? 'Waiting for the browser sign-in…' : 'Taking you to sign in…'}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/** What the card says: the group the link joins, or the person it opens a DM with (2026-11-09). */
type InvitePreview = { space?: string; person?: string; invitedBy?: string }

function JoinServerDialog({ inviteUrl: initialUrl, autoJoin = false, onClose, onDone, onByAddress, onDev }: {
    inviteUrl?: string
    autoJoin?: boolean
    onClose: () => void
    onDone: ServerDialogDone
    onByAddress: () => void
    onDev: () => void
}) {
    const account = useSpacesAccountState()
    const [url, setUrl] = useState(initialUrl ?? '')
    // Arrived with a link: the card is the whole dialog; the field stays out
    // of the way until they ask for it.
    const [editing, setEditing] = useState(!initialUrl)
    const [preview, setPreview] = useState<InvitePreview | null>(null)
    const [resolving, setResolving] = useState(false)
    const [busy, setBusy] = useState(false)

    /** True when the invite is live and its card is showing. */
    const resolve = async (next: string): Promise<boolean> => {
        setUrl(next)
        setPreview(null)
        if (!/\/join\//.test(next)) return false
        setResolving(true)
        try {
            const { resolved } = await window.ipc.invoke('spaces:resolveInviteLink', { url: next.trim() })
            if (resolved.state === 'ok') {
                setPreview({
                    ...(resolved.space ? { space: resolved.space.name } : {}),
                    ...(resolved.direct ? { person: resolved.direct.displayName } : {}),
                    ...(resolved.invitedBy ? { invitedBy: resolved.invitedBy } : {}),
                })
                return true
            }
            toast(`This invite is ${resolved.state}`, 'error')
            setEditing(true)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not resolve the invite', 'error')
            setEditing(true)
        } finally {
            setResolving(false)
        }
        return false
    }

    // Runs once for the link the dialog opened on; typing goes through resolve
    // directly. With autoJoin, Join was clicked before a sign-in, so the card
    // goes straight on to joining, once.
    const autoJoined = useRef(false)
    useEffect(() => {
        if (!initialUrl) return
        void resolve(initialUrl).then((live) => {
            if (!live || !autoJoin || autoJoined.current) return
            autoJoined.current = true
            void join(initialUrl)
        })
    }, [initialUrl])

    const join = async (target = url) => {
        if (!target.trim()) return
        setBusy(true)
        try {
            const { org, space } = await window.ipc.invoke('spaces:joinInvite', { url: target.trim() })
            analytics.spacesSpaceJoined('invite_link')
            toast(space ? `Joined ${space.name} on ${org.name}` : `Joined ${org.name}`, 'success')
            onDone(org.id, space?.id)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not join', 'error')
        } finally {
            setBusy(false)
        }
    }

    const signedOut = account !== null && !account.hasSession
    return (
        <Shell
            title={preview?.person ? "You're invited to chat" : "You're invited"}
            onClose={onClose}
            footerLeft={
                <>
                    {/* The rarer doors reach servers the web app can't (another host, a dev Harbor), so the browser offers neither. */}
                    {LOCAL_RUNTIME && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    type="button"
                                    aria-label="More ways to join"
                                    className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
                                >
                                    <MoreHorizontal className="size-3.5" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                                <DropdownMenuItem onClick={onByAddress}>Add a server by address</DropdownMenuItem>
                                <DropdownMenuItem onClick={onDev}>Add a dev server</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </>
            }
            footerRight={
                <>
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button onClick={() => void join()} disabled={busy || resolving || !url.trim()}>
                        {busy && <Loader2 className="size-3.5 mr-1 animate-spin" />}
                        {preview?.space ? `Join #${preview.space}` : preview?.person ? `Message ${preview.person}` : 'Join'}
                    </Button>
                </>
            }
        >
            {editing ? (
                <div>
                    <label htmlFor="invite-link" className="text-xs font-medium text-muted-foreground">Invite link</label>
                    <Input
                        id="invite-link"
                        autoFocus
                        value={url}
                        onChange={(e) => void resolve(e.target.value)}
                        placeholder="https://spaces.example/join/…"
                        onKeyDown={(e) => e.key === 'Enter' && void join()}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">Paste the link someone sent you.</p>
                </div>
            ) : null}
            {/* The card (2026-11-09, the web app's look): the space or the person as the headline, who sent it beneath. */}
            {preview ? (
                <div className="flex items-center gap-3.5 rounded-xl border border-border bg-accent/30 p-4">
                    <span aria-hidden="true" className={cn('flex size-11 shrink-0 items-center justify-center rounded-lg text-lg font-semibold', preview.person ? avatarColorClass(preview.person) : 'bg-primary/10 text-primary')}>
                        {preview.space ? <Hash className="size-5" /> : preview.person ? initials(preview.person) : <LinkIcon className="size-5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-base font-semibold">
                            {preview.space ? `#${preview.space}` : preview.person ?? 'This invite no longer leads anywhere'}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                            {preview.space
                                ? preview.invitedBy ? `${preview.invitedBy} invited you to this space` : 'You\u2019re invited to this space'
                                : preview.person ? 'Opens a direct message with them' : 'Ask whoever sent it for a new link.'}
                        </div>
                    </div>
                </div>
            ) : resolving ? (
                <div className="flex items-center gap-3.5 rounded-xl border border-border bg-accent/30 p-4" aria-busy="true" aria-label="Checking the invite">
                    <Skeleton className="size-11 shrink-0 rounded-lg" />
                    <div className="flex min-w-0 flex-1 flex-col gap-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-56" /></div>
                </div>
            ) : null}
            {!editing && (
                <FooterLink onClick={() => setEditing(true)}>Use a different link</FooterLink>
            )}
            {signedOut && url.trim() && (
                <p className="text-xs text-muted-foreground">
                    {LOCAL_RUNTIME ? 'Joining signs you in with your Rowboat account in the browser.' : 'Joining signs you in with your Rowboat account first.'}
                </p>
            )}
            {busy && signedOut && <BrowserWait />}
        </Shell>
    )
}

// ---------------------------------------------------------------------------
// The rarer doors, reached from Join's ··· menu
// ---------------------------------------------------------------------------

function AddressServerDialog({ onClose, onDone, onBack }: { onClose: () => void; onDone: ServerDialogDone; onBack: () => void }) {
    const [address, setAddress] = useState('')
    const [busy, setBusy] = useState(false)
    const add = async () => {
        if (!address.trim()) return
        setBusy(true)
        try {
            const { org } = await window.ipc.invoke('spaces:addOrgByAddress', { address: address.trim() })
            analytics.spacesSpaceJoined('server_address')
            toast(`Signed into ${org.name}`, 'success')
            onDone(org.id)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not add the server', 'error')
        } finally {
            setBusy(false)
        }
    }
    return (
        <Shell
            title="Add a server by address"
            description="A self-hosted server, or one you’re already a member of."
            onClose={onClose}
            footerLeft={<FooterLink onClick={onBack}>Back</FooterLink>}
            footerRight={
                <>
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button onClick={() => void add()} disabled={busy || !address.trim()}>
                        {busy && <Loader2 className="size-3.5 mr-1 animate-spin" />} Add
                    </Button>
                </>
            }
        >
            <div>
                <label htmlFor="server-address" className="text-xs font-medium text-muted-foreground">Server address</label>
                <Input
                    id="server-address"
                    autoFocus
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="acme.spaces.example or just the slug"
                    onKeyDown={(e) => e.key === 'Enter' && void add()}
                />
                <p className="mt-1 text-xs text-muted-foreground">A URL, a host, or a Rowboat server’s slug. You need to already be a member — otherwise ask for an invite link.</p>
            </div>
            {busy && <BrowserWait />}
        </Shell>
    )
}

function DevServerDialog({ onClose, onDone, onBack }: { onClose: () => void; onDone: ServerDialogDone; onBack: () => void }) {
    const [baseUrl, setBaseUrl] = useState('http://localhost:4272')
    const [memberId, setMemberId] = useState('')
    const [busy, setBusy] = useState(false)
    const add = async () => {
        if (!baseUrl.trim() || !memberId.trim()) return
        setBusy(true)
        try {
            const { org } = await window.ipc.invoke('spaces:addOrg', { baseUrl: baseUrl.trim(), memberId: memberId.trim() })
            analytics.spacesSpaceJoined('dev_server')
            toast(`Signed into ${org.name} as ${org.memberId}`, 'success')
            onDone(org.id)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not reach the server', 'error')
        } finally {
            setBusy(false)
        }
    }
    return (
        <Shell
            title="Add a dev server"
            description="Dev sign-in against a stub Harbor (run pnpm dev in apps/harbor/packages/server)."
            onClose={onClose}
            footerLeft={<FooterLink onClick={onBack}>Back</FooterLink>}
            footerRight={
                <>
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button onClick={() => void add()} disabled={busy || !baseUrl.trim() || !memberId.trim()}>
                        {busy && <Loader2 className="size-3.5 mr-1 animate-spin" />} Sign in
                    </Button>
                </>
            }
        >
            <div>
                <label htmlFor="dev-server-url" className="text-xs font-medium text-muted-foreground">Server URL</label>
                <Input id="dev-server-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:4272" />
            </div>
            <div>
                <label htmlFor="dev-member-id" className="text-xs font-medium text-muted-foreground">Member id</label>
                <Input
                    id="dev-member-id"
                    value={memberId}
                    onChange={(e) => setMemberId(e.target.value)}
                    placeholder="e.g. ramnique"
                    onKeyDown={(e) => e.key === 'Enter' && void add()}
                />
            </div>
        </Shell>
    )
}
