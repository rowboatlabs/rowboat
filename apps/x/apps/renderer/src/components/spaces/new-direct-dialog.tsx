import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { MemberAvatar } from '@/components/spaces/atoms'
import { useOrgRoster } from '@/hooks/use-space-members'
import { refreshSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'
import { otherParticipant } from '@/lib/spaces-direct'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

// "New message": pick a person, land in the DM. Get-or-create on the org, so
// picking someone you already talk to just opens that conversation. The
// candidates are everyone you share a space with on this org.

export function NewDirectDialog({ org, open, onOpenChange, onOpened }: {
    org: OrgWithSpaces
    open: boolean
    onOpenChange: (open: boolean) => void
    onOpened: (orgId: string, spaceId: string) => void
}) {
    const spaceIds = useMemo(() => org.spaces.map((s) => s.id), [org.spaces])
    const roster = useOrgRoster(org.id, spaceIds)
    const [query, setQuery] = useState('')
    const [active, setActive] = useState(0)
    const [opening, setOpening] = useState<string | null>(null)
    const listRef = useRef<HTMLDivElement>(null)

    // Who already has a DM with you floats up; then A–Z (the roster's order).
    const existing = useMemo(() => {
        const set = new Set<string>()
        for (const dm of org.directs) {
            const other = otherParticipant(dm, org.memberId)
            if (other) set.add(other)
        }
        return set
    }, [org.directs, org.memberId])
    const candidates = useMemo(() => {
        const q = query.trim().toLowerCase()
        return roster
            .filter((m) => m.id !== org.memberId && (!q || m.displayName.toLowerCase().includes(q)))
            .sort((a, b) => Number(existing.has(b.id)) - Number(existing.has(a.id)))
    }, [roster, org.memberId, query, existing])

    useEffect(() => {
        if (!open) return
        setQuery('')
        setActive(0)
        setOpening(null)
    }, [open])
    useEffect(() => {
        setActive((i) => Math.min(i, Math.max(0, candidates.length - 1)))
    }, [candidates.length])
    useEffect(() => {
        listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
    }, [active])

    const pick = async (memberId: string) => {
        if (opening) return
        setOpening(memberId)
        try {
            const { space } = await window.ipc.invoke('spaces:openDirect', { orgId: org.id, memberId })
            // The listing carries the label the sidebar renders — refresh
            // before landing so the new row paints with a name, not an id.
            await refreshSpacesOrgs()
            onOpenChange(false)
            onOpened(org.id, space.id)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not open the conversation', 'error')
        } finally {
            setOpening(null)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-sm gap-0 p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
                <DialogHeader className="px-4 pb-2 pt-4">
                    <DialogTitle className="text-sm">New message</DialogTitle>
                    <DialogDescription className="text-xs">A private conversation with someone in {org.name}.</DialogDescription>
                </DialogHeader>
                <div className="px-3 pb-2">
                    <Input
                        autoFocus
                        value={query}
                        placeholder="To: a teammate's name"
                        className="h-8 text-sm"
                        onChange={(e) => {
                            setQuery(e.target.value)
                            setActive(0)
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'ArrowDown') {
                                e.preventDefault()
                                setActive((i) => Math.min(i + 1, candidates.length - 1))
                            } else if (e.key === 'ArrowUp') {
                                e.preventDefault()
                                setActive((i) => Math.max(i - 1, 0))
                            } else if (e.key === 'Enter') {
                                e.preventDefault()
                                const m = candidates[active]
                                if (m) void pick(m.id)
                            }
                        }}
                    />
                </div>
                <div ref={listRef} className="max-h-72 overflow-y-auto border-t border-border p-1.5">
                    {candidates.length === 0 ? (
                        <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                            {roster.length <= 1
                                ? 'Nobody to message yet — you can DM anyone you share a space with.'
                                : 'No one matches.'}
                        </div>
                    ) : (
                        candidates.map((m, i) => (
                            <button
                                key={m.id}
                                type="button"
                                data-index={i}
                                onMouseEnter={() => setActive(i)}
                                onClick={() => void pick(m.id)}
                                className={cn(
                                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                                    i === active && 'bg-accent',
                                )}
                            >
                                <MemberAvatar id={m.id} name={m.displayName} size="md" />
                                <span className="min-w-0 flex-1 truncate">{m.displayName}</span>
                                {opening === m.id ? (
                                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                                ) : existing.has(m.id) ? (
                                    <span className="shrink-0 text-[10.5px] text-muted-foreground">open</span>
                                ) : null}
                            </button>
                        ))
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
