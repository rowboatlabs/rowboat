import { useState } from 'react'
import { Hash, Loader2, NotebookPen, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InviteLinkPanel } from '@/components/spaces/invite-link'
import { openSelfDirect, refreshSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'
import { openServerDialog } from '@/lib/server-dialog'
import { toast } from '@/lib/toast'
import * as analytics from '@/lib/analytics'

/**
 * The cold start (spec §4 Joining and §10, 2026-11-09): a signed-in person
 * with no chats yet sees one honest starting move, inline — add an agent,
 * start a space and share its link — and, quietly, message themselves. No
 * wizard, no "create a server" step: the server is already theirs.
 */
export function StartHere({ org, onOpenSpace, onOpenAgents }: {
    org: OrgWithSpaces
    onOpenSpace: (orgId: string, spaceId: string) => void
    onOpenAgents?: (orgId: string) => void
}) {
    const [naming, setNaming] = useState(false)
    const [name, setName] = useState('')
    const [busy, setBusy] = useState<'group' | 'self' | null>(null)
    const createGroup = async () => {
        const trimmed = name.trim()
        if (!trimmed || busy) return
        setBusy('group')
        try {
            const { space } = await window.ipc.invoke('spaces:createSpace', { orgId: org.id, name: trimmed })
            analytics.spacesSpaceCreated()
            await refreshSpacesOrgs()
            onOpenSpace(org.id, space.id)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not create the space', 'error')
        } finally {
            setBusy(null)
        }
    }
    const messageSelf = async () => {
        if (busy) return
        setBusy('self')
        try {
            onOpenSpace(org.id, await openSelfDirect(org.id, org.memberId))
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not open your notes', 'error')
        } finally {
            setBusy(null)
        }
    }
    // The same cards a new space greets people with (EmptySpaceStart), so a new
    // account and a new space look alike.
    const card = (icon: React.ReactNode, tint: string, title: string, hint: string, action: React.ReactNode) => (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-accent/30 p-4">
            <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tint}`}>{icon}</span>
            <div className="flex flex-1 flex-col gap-1">
                <span className="text-sm font-semibold">{title}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">{hint}</span>
            </div>
            {action}
        </div>
    )
    return (
        <section aria-label="Start here" className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
            <div className="flex flex-col gap-2">
                <img src="/logo-only.png" alt="" aria-hidden="true" className="size-12 rounded-xl" />
                <h2 className="mt-1 text-2xl font-bold tracking-tight">Welcome to Spaces</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">Where you and your agents work with other people. Bring an agent in, start a space and send its link to whoever you work with, or just write to yourself.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
                {card(<Sparkles className="size-4" />, 'bg-violet-500/15 text-violet-400', 'Add an agent',
                    'Claude Code, Codex, Hermes and more. It becomes yours: you decide which spaces it joins and who may ask it.',
                    <Button size="sm" onClick={() => onOpenAgents?.(org.id)} disabled={!onOpenAgents}>Add an agent</Button>)}
                {naming ? (
                    <form className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-accent/30 p-4" onSubmit={(event) => { event.preventDefault(); void createGroup() }}>
                        <span className="text-sm font-semibold">Name the space</span>
                        <Input autoFocus maxLength={128} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Launch, Design, Family" aria-label="Space name" />
                        <div className="flex items-center justify-between">
                            <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setNaming(false)}>Back</button>
                            <Button type="submit" size="sm" disabled={!name.trim() || busy !== null}>{busy === 'group' && <Loader2 className="size-3.5 animate-spin" />} Create space</Button>
                        </div>
                    </form>
                ) : card(<Hash className="size-4" />, 'bg-primary/10 text-primary', 'New space',
                    'For a project or a team. Share its link on WhatsApp, LinkedIn or mail; whoever opens it is in.',
                    <Button size="sm" onClick={() => setNaming(true)}>New space</Button>)}
                {card(<NotebookPen className="size-4" />, 'bg-emerald-500/15 text-emerald-400', 'Notes to self',
                    'A place only you and your agents can see: drafts, links, files for later.',
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void messageSelf()}>{busy === 'self' ? 'Opening…' : 'Message yourself'}</Button>)}
            </div>
            {/* Your personal link: how anyone outside your spaces reaches you. */}
            <div className="rounded-xl border border-dashed border-border p-2">
                <InviteLinkPanel orgId={org.id} direct />
            </div>
            <div className="text-xs text-muted-foreground">
                <button type="button" className="hover:text-foreground hover:underline" onClick={() => openServerDialog({ kind: 'join' })}>Have an invite link?</button>
            </div>
        </section>
    )
}
