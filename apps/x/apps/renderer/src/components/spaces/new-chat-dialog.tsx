import { useEffect, useState } from 'react'
import { ArrowRight, Bot, Hash, Link as LinkIcon, Loader2, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { NewDirectDialog } from '@/components/spaces/new-direct-dialog'
import { refreshSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'
import { openServerDialog } from '@/lib/server-dialog'
import { toast } from '@/lib/toast'
import * as analytics from '@/lib/analytics'

// New chat (spec §10, 2026-11-09): the one sheet behind the sidebar's New
// space button and its section +'s. A space, a message to a contact or one
// of your agents, a new agent, or a space you were sent a link to. It opens
// where the result is; `start` opens it straight on a screen.

type Screen = 'menu' | 'group'
export type NewChatStart = Screen | 'message'

export function NewChatDialog({ org, open, start = 'menu', onOpenChange, onOpenSpace, onOpenAgents }: {
    org: OrgWithSpaces
    open: boolean
    /** The screen to open on: the menu, the space form, or the message picker. */
    start?: NewChatStart
    onOpenChange: (open: boolean) => void
    onOpenSpace: (orgId: string, spaceId: string) => void
    onOpenAgents?: (orgId: string) => void
}) {
    const [screen, setScreen] = useState<Screen>('menu')
    const [messaging, setMessaging] = useState(false)
    const [name, setName] = useState('')
    const [busy, setBusy] = useState(false)
    useEffect(() => {
        if (!open) return
        setScreen(start === 'group' ? 'group' : 'menu')
        setMessaging(start === 'message')
    }, [open, start])
    const close = (next: boolean) => {
        onOpenChange(next)
        if (!next) {
            setScreen('menu')
            setName('')
        }
    }
    const createGroup = async () => {
        const trimmed = name.trim()
        if (!trimmed || busy) return
        setBusy(true)
        try {
            const { space } = await window.ipc.invoke('spaces:createSpace', { orgId: org.id, name: trimmed })
            analytics.spacesSpaceCreated()
            await refreshSpacesOrgs()
            close(false)
            onOpenSpace(org.id, space.id)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not create the space', 'error')
        } finally {
            setBusy(false)
        }
    }
    const option = (icon: React.ReactNode, title: string, hint: string, onClick: () => void) => (
        <button type="button" onClick={onClick}
            className="group flex items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">{icon}</span>
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{title}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{hint}</span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
        </button>
    )
    return <>
        <Dialog open={open && !messaging} onOpenChange={close}>
            <DialogContent className="max-w-md">
                {screen === 'menu' ? <>
                    <DialogHeader>
                        <DialogTitle>New chat</DialogTitle>
                        <DialogDescription>A space for a project, a message to someone, or an agent to work with.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-2 pt-1">
                        {option(<Hash className="size-4" />, 'New space', 'Name it, add people and agents, and share its link.', () => setScreen('group'))}
                        {option(<MessageSquare className="size-4" />, 'New message', 'Someone you share a space with, or one of your agents.', () => setMessaging(true))}
                        {onOpenAgents && option(<Bot className="size-4" />, 'Add an agent', 'Claude Code, Codex, Hermes and more — it becomes yours to bring into groups.', () => { close(false); onOpenAgents(org.id) })}
                        {option(<LinkIcon className="size-4" />, 'Join with a link', 'Paste the link someone sent you.', () => { close(false); openServerDialog({ kind: 'join' }) })}
                    </div>
                </> : <>
                    <DialogHeader>
                        <DialogTitle>New space</DialogTitle>
                        <DialogDescription>You are its first admin. Add people and agents once it exists, or share its invite link.</DialogDescription>
                    </DialogHeader>
                    <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void createGroup() }}>
                        <Input autoFocus maxLength={128} value={name} onChange={(event) => setName(event.target.value)} placeholder="Space name" aria-label="Space name" />
                        <div className="flex items-center justify-between">
                            <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setScreen('menu')}>Back</button>
                            <Button type="submit" disabled={!name.trim() || busy}>{busy && <Loader2 className="size-3.5 animate-spin" />} Create space</Button>
                        </div>
                    </form>
                </>}
            </DialogContent>
        </Dialog>
        <NewDirectDialog org={org} open={open && messaging} onOpenChange={(next) => { setMessaging(next); if (!next) close(false) }} onOpened={(orgId, spaceId) => { setMessaging(false); close(false); onOpenSpace(orgId, spaceId) }} />
    </>
}
