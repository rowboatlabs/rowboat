import { useState } from 'react'
import { ArrowRight, Bot, Hash, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
    const card = (icon: React.ReactNode, title: string, hint: string, onClick: () => void) => (
        <button type="button" onClick={onClick}
            className="group flex items-center gap-4 rounded-xl border border-border bg-accent/30 p-4 text-left transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{title}</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{hint}</span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
        </button>
    )
    return (
        <div className="flex flex-1 items-center justify-center p-8">
            <div className="w-full max-w-md">
                <h2 className="text-lg font-semibold">Start here</h2>
                <p className="mt-1 text-sm text-muted-foreground">Spaces is where you and your agents work with other people. Bring an agent in, or start a group and send its link to whoever you work with.</p>
                <div className="mt-5 grid gap-3">
                    {onOpenAgents && card(<Bot className="size-5" />, 'Add an agent', 'Claude Code, Codex, Hermes and more. It becomes yours: you decide which groups it joins and who may ask it.', () => onOpenAgents(org.id))}
                    {naming ? (
                        <form className="flex flex-col gap-2 rounded-xl border border-border p-4" onSubmit={(event) => { event.preventDefault(); void createGroup() }}>
                            <span className="text-sm font-semibold">Name the space</span>
                            <Input autoFocus maxLength={128} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Launch, Design, Family" aria-label="Group name" />
                            <div className="flex items-center justify-between">
                                <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setNaming(false)}>Back</button>
                                <Button type="submit" size="sm" disabled={!name.trim() || busy !== null}>{busy === 'group' && <Loader2 className="size-3.5 animate-spin" />} Create group</Button>
                            </div>
                        </form>
                    ) : card(<Hash className="size-5" />, 'Start a space', 'For a project or a team. Share its link on WhatsApp, LinkedIn or mail; whoever opens it is in.', () => setNaming(true))}
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <button type="button" className="hover:text-foreground hover:underline" onClick={() => openServerDialog({ kind: 'join' })}>Have an invite link?</button>
                    <button type="button" className="hover:text-foreground hover:underline" disabled={busy !== null} onClick={() => void messageSelf()}>{busy === 'self' ? 'Opening…' : 'Or just message yourself'}</button>
                </div>
            </div>
        </div>
    )
}
