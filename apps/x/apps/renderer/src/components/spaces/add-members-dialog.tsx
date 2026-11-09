import { invokeSpace } from '@/lib/spaces-invoke'
import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { AgentBadge, MemberAvatar } from '@/components/spaces/atoms'
import { SeatChoice, type Seat } from '@/components/spaces/agent-access'
import { refreshMembers, useOrgRoster } from '@/hooks/use-space-members'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { isDeparted, isOwnAgent } from '@/lib/spaces-direct'

// "Add people" (2026-09-29): any member adds their contacts, people or their
// own agents, to a space they are in (2026-11-09: only an agent's owner adds
// it, choosing who may ask it there). The candidates are your contacts minus
// who is already here. They learn of it by their sidebar and the stream's
// join line; no notification in v1.

export function AddMembersDialog({ org, space, members, open, onOpenChange }: {
    org: OrgWithSpaces
    space: spaces.Space
    /** Who is in the space now — never offered. */
    members: readonly spaces.Member[]
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const spaceIds = useMemo(() => org.spaces.map((s) => s.id), [org.spaces])
    const roster = useOrgRoster(org.id, spaceIds)
    const [query, setQuery] = useState('')
    const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())
    const [seat, setSeat] = useState<Seat>('members')
    const [adding, setAdding] = useState(false)

    const inSpace = useMemo(() => new Set(members.map((m) => m.id)), [members])
    const candidates = useMemo(() => {
        const q = query.trim().toLowerCase()
        // A deleted account is never offered (2026-10-13), nor an agent that is not yours (2026-11-09): Harbor refuses the add.
        return roster.filter((m) => !inSpace.has(m.id) && !isDeparted(m) && (m.kind !== 'agent' || isOwnAgent(m, org.memberId)) && (!q || m.displayName.toLowerCase().includes(q)))
    }, [roster, inSpace, query, org.memberId])
    const pickedAgents = useMemo(() => roster.filter((m) => picked.has(m.id) && m.kind === 'agent').length, [roster, picked])

    useEffect(() => {
        if (!open) return
        setQuery('')
        setPicked(new Set())
        setSeat('members')
        setAdding(false)
    }, [open])

    const toggle = (id: string) => setPicked((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
    })

    const add = async () => {
        if (picked.size === 0 || adding) return
        setAdding(true)
        try {
            await invokeSpace('spaces:addMembers', { orgId: org.id, spaceId: space.id, memberIds: [...picked], ...(pickedAgents > 0 ? { invocableBy: seat } : {}) })
            refreshMembers(org.id, space.id, { force: true })
            toast(picked.size === 1 ? `Added to #${space.name}` : `Added ${picked.size} to #${space.name}`, 'success')
            onOpenChange(false)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not add them', 'error')
        } finally {
            setAdding(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-sm gap-0 p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
                <DialogHeader className="px-4 pb-2 pt-4">
                    <DialogTitle className="text-sm">Add people to #{space.name}</DialogTitle>
                    <DialogDescription className="text-xs">People you share a space with, and your own agents. They’ll see #{space.name} in their sidebar.</DialogDescription>
                </DialogHeader>
                <div className="px-3 pb-2">
                    <Input
                        autoFocus
                        value={query}
                        placeholder="Search by name"
                        className="h-8 text-sm"
                        onChange={(e) => setQuery(e.target.value)}
                    />
                </div>
                <div className="max-h-72 overflow-y-auto border-t border-border p-1.5">
                    {candidates.length === 0 ? (
                        <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                            {query.trim() ? 'No one matches.' : `Everyone you know is already in #${space.name}. Invite someone new with the group’s link.`}
                        </div>
                    ) : (
                        candidates.map((m) => {
                            const on = picked.has(m.id)
                            return (
                                <button
                                    key={m.id}
                                    type="button"
                                    role="checkbox"
                                    aria-checked={on}
                                    onClick={() => toggle(m.id)}
                                    className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/60', on && 'bg-accent')}
                                >
                                    <MemberAvatar orgId={org.id} avatarUrl={m.avatarUrl} id={m.id} name={m.displayName} size="md" agent={m.kind === 'agent'} agentKind={m.agentKind} />
                                    <span className="min-w-0 flex-1 truncate">{m.displayName}</span>
                                    {m.kind === 'agent' && <AgentBadge agentKind={m.agentKind} agentConnection={m.agentConnection} />}
                                    <span className={cn('inline-flex size-4 shrink-0 items-center justify-center rounded border', on ? 'border-foreground bg-foreground text-background' : 'border-border')}>
                                        {on && <Check className="size-3" />}
                                    </span>
                                </button>
                            )
                        })
                    )}
                </div>
                {pickedAgents > 0 && (
                    <div className="border-t border-border px-3 py-2">
                        <SeatChoice seat={seat} onChange={setSeat} note={pickedAgents === 1 ? 'For the agent you picked. You can change it later from the member list.' : 'For the agents you picked. You can change each later from the member list.'} />
                    </div>
                )}
                <DialogFooter className="border-t border-border px-3 py-2">
                    <Button size="sm" disabled={picked.size === 0 || adding} onClick={() => void add()}>
                        {adding && <Loader2 className="size-3.5 animate-spin" />}
                        {picked.size > 1 ? `Add ${picked.size}` : 'Add'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
