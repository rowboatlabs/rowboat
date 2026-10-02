import { useEffect, useState, type ReactNode } from 'react'
import { Loader2, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { refreshSpacesAccountState, refreshSpacesOrgs, useSpacesAccountState } from '@/hooks/use-spaces'
import { consumeServerDialog, subscribeServerDialog, type ServerDialogRequest } from '@/lib/server-dialog'
import { toast } from '@/lib/toast'
import * as analytics from '@/lib/analytics'

// The server dialogs, one host for the whole app (lib/server-dialog.ts is
// how anything opens one). Two intents, two dialogs: CREATE a server, or
// JOIN one you were invited to — each focused on its own single act, each
// carrying a small link to the other in its footer. Two rarer ways in — a
// server by address, a dev server — are their own small screens reached
// from Join's ··· menu, with a way back.
//
// Sign-in (one session, two uses) is folded into the intent rather than a
// door of its own: Create needs a Rowboat session first, so without one it
// offers the sign-in in place of the form; Join needs none up front — the
// join itself signs the person in, and the dialog just says so.

/** What a finished dialog hands back: the org, and the space to land in when one is known. */
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
        case 'create':
            return <CreateServerDialog key={key} onClose={close} onDone={done} onJoinInstead={() => swap({ kind: 'join' })} />
        case 'join':
            return (
                <JoinServerDialog
                    key={key}
                    inviteUrl={request.inviteUrl}
                    onClose={close}
                    onDone={done}
                    onCreateInstead={() => swap({ kind: 'create' })}
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

function BrowserWait() {
    return (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Waiting for the browser sign-in…
        </div>
    )
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

function CreateServerDialog({ onClose, onDone, onJoinInstead }: {
    onClose: () => void
    onDone: ServerDialogDone
    onJoinInstead: () => void
}) {
    const account = useSpacesAccountState()
    const [name, setName] = useState('')
    // The apex (/v1/config via core) gates Create. null = no spaces fleet for
    // this environment; undefined = loading.
    const [apexDomain, setApexDomain] = useState<string | null | undefined>(undefined)
    const [busy, setBusy] = useState<'create' | 'signin' | null>(null)

    useEffect(() => {
        void window.ipc.invoke('spaces:apexInfo', null)
            .then(({ apexDomain: domain }) => setApexDomain(domain))
            .catch(() => setApexDomain(null))
    }, [])

    const signIn = async () => {
        setBusy('signin')
        try {
            const { orgs } = await window.ipc.invoke('spaces:signInRowboat', null)
            refreshSpacesAccountState()
            if (orgs.length > 0) {
                // Signing in surfaced the servers they already belong to — that
                // is the outcome; creating another can wait.
                toast(`Signed in — ${orgs.length} ${orgs.length === 1 ? 'server' : 'servers'} ready`, 'success')
                onDone(orgs[0].id)
            } else {
                toast('Signed in to Rowboat', 'success')
            }
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Sign-in failed', 'error')
        } finally {
            setBusy(null)
        }
    }

    const create = async () => {
        if (!name.trim() || !apexDomain) return
        setBusy('create')
        try {
            const { org } = await window.ipc.invoke('spaces:createOrg', { name: name.trim() })
            analytics.spacesServerCreated()
            toast(`Created ${org.name} — you're the admin`, 'success')
            onDone(org.id)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not create the server', 'error')
        } finally {
            setBusy(null)
        }
    }

    const needsSignIn = account !== null && !account.hasSession
    return (
        <Shell
            title="Create a server"
            description="Home for your team and their assistants, with spaces for each project. Free, and you’re its admin."
            onClose={onClose}
            footerLeft={<FooterLink onClick={onJoinInstead}>Have an invite? Join a server</FooterLink>}
            footerRight={
                <>
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    {needsSignIn ? (
                        <Button onClick={() => void signIn()} disabled={busy !== null}>
                            {busy === 'signin' && <Loader2 className="size-3.5 mr-1 animate-spin" />} Sign in with Rowboat
                        </Button>
                    ) : (
                        <Button onClick={() => void create()} disabled={busy !== null || !name.trim() || !apexDomain}>
                            {busy === 'create' && <Loader2 className="size-3.5 mr-1 animate-spin" />} Create
                        </Button>
                    )}
                </>
            }
        >
            {needsSignIn ? (
                <p className="text-sm text-muted-foreground">
                    Sign in with your Rowboat account first — the server is yours, so it needs to know who you are. Any servers you already belong to appear right after.
                </p>
            ) : (
                <div>
                    <label htmlFor="server-name" className="text-xs font-medium text-muted-foreground">Server name</label>
                    <Input
                        id="server-name"
                        autoFocus
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Acme, book club, just me…"
                        onKeyDown={(e) => e.key === 'Enter' && void create()}
                    />
                    {apexDomain === null && (
                        <p className="mt-1.5 text-xs text-muted-foreground">Spaces isn’t available for this environment yet.</p>
                    )}
                </div>
            )}
            {busy === 'signin' && <BrowserWait />}
        </Shell>
    )
}

// ---------------------------------------------------------------------------
// Join
// ---------------------------------------------------------------------------

interface InvitePreview { org: string; space: string; invitedBy?: string }

function JoinServerDialog({ inviteUrl: initialUrl, onClose, onDone, onCreateInstead, onByAddress, onDev }: {
    inviteUrl?: string
    onClose: () => void
    onDone: ServerDialogDone
    onCreateInstead: () => void
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

    const resolve = async (next: string) => {
        setUrl(next)
        setPreview(null)
        if (!/\/join\//.test(next)) return
        setResolving(true)
        try {
            const { resolved } = await window.ipc.invoke('spaces:resolveInviteLink', { url: next.trim() })
            if (resolved.state === 'ok') {
                setPreview({ org: resolved.org.name, space: resolved.space.name, ...(resolved.invitedBy ? { invitedBy: resolved.invitedBy } : {}) })
            } else {
                toast(`This invite is ${resolved.state}`, 'error')
                setEditing(true)
            }
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not resolve the invite', 'error')
            setEditing(true)
        } finally {
            setResolving(false)
        }
    }

    // Runs once for the link the dialog opened on; typing goes through resolve directly.
    useEffect(() => {
        if (initialUrl) void resolve(initialUrl)
    }, [initialUrl])

    const join = async () => {
        if (!url.trim()) return
        setBusy(true)
        try {
            const { org, space } = await window.ipc.invoke('spaces:joinInvite', { url: url.trim() })
            analytics.spacesSpaceJoined('invite_link')
            toast(`Joined ${space.name} on ${org.name}`, 'success')
            onDone(org.id, space.id)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not join', 'error')
        } finally {
            setBusy(false)
        }
    }

    const signedOut = account !== null && !account.hasSession
    return (
        <Shell
            title="Join a server"
            onClose={onClose}
            footerLeft={
                <>
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
                    <FooterLink onClick={onCreateInstead}>New here? Create a server</FooterLink>
                </>
            }
            footerRight={
                <>
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button onClick={() => void join()} disabled={busy || resolving || !url.trim()}>
                        {busy && <Loader2 className="size-3.5 mr-1 animate-spin" />} Join
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
                        placeholder="https://org.example/join/…"
                        onKeyDown={(e) => e.key === 'Enter' && void join()}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">Paste the link someone sent you.</p>
                </div>
            ) : null}
            {preview ? (
                <div className="rounded-md border px-3 py-2.5 text-sm">
                    <div>
                        You’re invited to <span className="font-medium">{preview.space}</span> on{' '}
                        <span className="font-medium">{preview.org}</span>
                    </div>
                    {preview.invitedBy && <div className="text-xs text-muted-foreground">Invited by {preview.invitedBy}</div>}
                </div>
            ) : resolving ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" /> Checking the invite…
                </div>
            ) : null}
            {!editing && (
                <FooterLink onClick={() => setEditing(true)}>Use a different link</FooterLink>
            )}
            {signedOut && url.trim() && (
                <p className="text-xs text-muted-foreground">Joining signs you in with your Rowboat account in the browser.</p>
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
