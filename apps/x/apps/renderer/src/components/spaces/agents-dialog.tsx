import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, KeyRound, Loader2 } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { MemberAvatar } from '@/components/spaces/atoms'
import { refreshOrgRoster, useOrgRoster } from '@/hooks/use-space-members'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { toast } from '@/lib/toast'

// Agents (Harbor spec §4 Agent members, 2026-09-29): add an agent you own,
// hand its key to whatever runs it (a Hermes or OpenClaw gateway, any MCP
// client), rotate and revoke keys. A key's secret is shown once, right after
// it is made, and never again — the org keeps only its hash. You see the
// agents you own; an admin sees every one and can revoke, never mint.

interface Minted {
    agentName: string
    secret: string
}

function when(iso: string | undefined): string {
    return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'never'
}

export function AgentsDialog({ org, open, onOpenChange }: {
    org: OrgWithSpaces
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const spaceIds = useMemo(() => org.spaces.map((s) => s.id), [org.spaces])
    const roster = useOrgRoster(org.id, spaceIds)
    const names = useMemo(() => new Map(roster.map((m) => [m.id, m.displayName])), [roster])
    const isAdmin = roster.find((m) => m.id === org.memberId)?.role === 'admin'
    const [agents, setAgents] = useState<spaces.AgentListing[] | null>(null)
    const [name, setName] = useState('')
    const [busy, setBusy] = useState(false)
    const [minted, setMinted] = useState<Minted | null>(null)
    const [confirming, setConfirming] = useState<string | null>(null)

    const load = useCallback(async () => {
        try {
            setAgents((await window.ipc.invoke('spaces:listAgents', { orgId: org.id })).agents)
        } catch (err) {
            setAgents([])
            toast(err instanceof Error ? err.message : 'Could not load agents', 'error')
        }
    }, [org.id])

    useEffect(() => {
        if (!open) return
        setName('')
        setMinted(null)
        setConfirming(null)
        setAgents(null)
        void load()
    }, [open, load])

    const run = async (work: () => Promise<void>, failure: string) => {
        if (busy) return
        setBusy(true)
        try {
            await work()
            await load()
        } catch (err) {
            toast(err instanceof Error ? err.message : failure, 'error')
        } finally {
            setBusy(false)
        }
    }

    const add = () => run(async () => {
        const { agent, key } = await window.ipc.invoke('spaces:addAgent', { orgId: org.id, displayName: name.trim() })
        // Your new agent is on your roster (and so in Add people) right away.
        refreshOrgRoster(org.id)
        setName('')
        setMinted({ agentName: agent.displayName, secret: key.secret })
    }, 'Could not add the agent')

    const newKey = (agent: spaces.Member) => run(async () => {
        const { key } = await window.ipc.invoke('spaces:createAgentKey', { orgId: org.id, agentId: agent.id })
        setMinted({ agentName: agent.displayName, secret: key.secret })
    }, 'Could not create a key')

    const revoke = (agent: spaces.Member, keyId: string) => run(async () => {
        await window.ipc.invoke('spaces:revokeAgentKey', { orgId: org.id, agentId: agent.id, keyId })
        setConfirming(null)
        toast('Key revoked', 'success')
    }, 'Could not revoke the key')

    const copy = (text: string) => void navigator.clipboard.writeText(text).then(
        () => toast('Copied', 'success'),
        () => toast('Could not copy', 'error'),
    )

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md gap-0 p-0">
                <DialogHeader className="px-4 pb-2 pt-4">
                    <DialogTitle className="text-sm">Agents in {org.name}</DialogTitle>
                    <DialogDescription className="text-xs">
                        An agent is a member of its own, with its own key. Give the key to what runs it, then add it to Spaces with Add people.
                    </DialogDescription>
                </DialogHeader>

                {minted ? (
                    <div className="flex flex-col gap-2 border-t border-border px-4 py-3 text-xs">
                        <div className="font-medium text-foreground">Key for {minted.agentName}. Copy it now: it won’t be shown again.</div>
                        <div className="flex items-center gap-2">
                            <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted px-2 py-1.5 font-mono text-[11px] select-all">{minted.secret}</code>
                            <Button size="sm" variant="outline" onClick={() => copy(minted.secret)} aria-label="Copy key"><Copy className="size-3.5" /></Button>
                        </div>
                        <div className="text-muted-foreground">
                            Server <code className="font-mono">{org.baseUrl}</code> · MCP <code className="font-mono">{org.baseUrl}/mcp</code> · send the key as <code className="font-mono">Authorization: Bearer</code>.
                        </div>
                        <div className="flex justify-end">
                            <Button size="sm" onClick={() => setMinted(null)}>Done</Button>
                        </div>
                    </div>
                ) : (
                    <form
                        className="flex items-center gap-2 border-t border-border px-4 py-3"
                        onSubmit={(e) => {
                            e.preventDefault()
                            if (name.trim()) void add()
                        }}
                    >
                        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Hermes" className="h-8 text-sm" maxLength={128} />
                        <Button type="submit" size="sm" disabled={!name.trim() || busy}>
                            {busy && <Loader2 className="size-3.5 animate-spin" />}
                            Add agent
                        </Button>
                    </form>
                )}

                <div className="max-h-80 overflow-y-auto border-t border-border p-1.5">
                    {agents === null ? (
                        <div className="flex items-center gap-2 px-2 py-4 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading agents…</div>
                    ) : agents.length === 0 ? (
                        <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                            {isAdmin ? 'No agents in this server yet.' : 'You have no agents yet.'}
                        </div>
                    ) : (
                        agents.map(({ agent, keys }) => {
                            const mine = agent.ownerId === org.memberId
                            const live = keys.filter((k) => !k.revokedAt)
                            return (
                                <div key={agent.id} className="rounded-md px-2 py-2">
                                    <div className="flex items-center gap-2">
                                        <MemberAvatar id={agent.id} name={agent.displayName} size="md" agent />
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-medium">{agent.displayName}</div>
                                            <div className="truncate text-[11px] text-muted-foreground">
                                                {agent.ownerId ? (mine ? 'Yours' : `Owned by ${names.get(agent.ownerId) ?? 'another member'}`) : 'Managed by admins'}
                                            </div>
                                        </div>
                                        {mine && (
                                            <Button size="sm" variant="outline" disabled={busy} onClick={() => void newKey(agent)}>
                                                <KeyRound className="size-3.5" /> New key
                                            </Button>
                                        )}
                                    </div>
                                    {live.length === 0 ? (
                                        <div className="mt-1.5 pl-11 text-[11px] text-muted-foreground">No active keys.</div>
                                    ) : (
                                        live.map((k) => (
                                            <div key={k.id} className="mt-1.5 flex items-center gap-2 pl-11 text-[11px] text-muted-foreground">
                                                <span className="min-w-0 flex-1 truncate">Key made {when(k.createdAt)} · last used {when(k.lastUsedAt)}</span>
                                                {(mine || isAdmin) && (
                                                    <button
                                                        type="button"
                                                        disabled={busy}
                                                        onClick={() => (confirming === k.id ? void revoke(agent, k.id) : setConfirming(k.id))}
                                                        className="shrink-0 rounded px-1.5 py-0.5 text-destructive hover:bg-destructive/10"
                                                    >
                                                        {confirming === k.id ? 'Confirm revoke' : 'Revoke'}
                                                    </button>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            )
                        })
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
