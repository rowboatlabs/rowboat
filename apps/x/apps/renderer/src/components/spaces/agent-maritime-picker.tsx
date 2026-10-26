import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { InstanceChoice } from '@/components/spaces/agent-instance-picker'
import { AgentLogo } from '@/components/spaces/agent-setup'
import { kindInfo } from '@/lib/agent-kinds'
import { cn } from '@/lib/utils'

// Which Maritime agent a new agent is (Harbor spec §8 Connectors, Maritime,
// 2026-10-26). A Maritime agent is one VM with a persistent volume, so a
// Rowboat agent is exactly one: the person picks one of the agents their key
// reaches. The app talks to Maritime with the key being pasted, then adds the
// agent with the Maritime agent's id; its template decides the kind, and an
// agent made from an image, whose record names no runtime, takes the kind the
// person picks. Creating agents on Maritime from here is the managed flow,
// which comes next; this screen only connects ones that exist.

export interface FoundAgent {
    id: string
    name: string
    framework: string
    templateId: string | null
    status: string
    kind?: string
}

const KINDS = ['hermes', 'claude-code', 'codex']

export function MaritimeAgentPicker({ credential, choice, onChoice }: {
    /** The Maritime key being pasted; the picker lists what it reaches. */
    credential: string
    choice: InstanceChoice | null
    onChoice: (choice: InstanceChoice | null) => void
}) {
    const [found, setFound] = useState<{ key: string; agents: FoundAgent[] } | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const key = credential.trim()
    // A different key reaches different agents: what was found is for the key it was found with.
    const agents = found?.key === key ? found.agents : null
    const picked = choice?.type === 'existing' ? agents?.find((a) => a.id === choice.id) : undefined

    const find = async () => {
        if (!key || loading) return
        setLoading(true)
        setError(null)
        onChoice(null)
        try {
            const { agents: list } = await window.ipc.invoke('spaces:maritimeAgents', { key })
            setFound({ key, agents: list })
            if (list.length === 1) onChoice({ type: 'existing', id: list[0]!.id, kind: list[0]!.kind ?? 'hermes', name: list[0]!.name })
        } catch (err) {
            setFound(null)
            setError(err instanceof Error ? err.message : 'Could not list the agents')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="mt-4 flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">Maritime agent</span>
            <span className="text-[11px] text-muted-foreground">
                The agent is one Maritime agent, a VM with its own files and memory. Pick one this key reaches. It can’t be changed later.
            </span>
            {agents === null ? (
                <div className="flex items-center gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => void find()} disabled={!key || loading}>
                        {loading && <Loader2 className="size-3.5 animate-spin" />}
                        Find agents
                    </Button>
                    {!key && <span className="text-[11px] text-muted-foreground">Paste the key first.</span>}
                </div>
            ) : agents.length === 0 ? (
                <span className="text-[11px] text-muted-foreground">This key reaches no agents. Create one on Maritime first.</span>
            ) : (
                <div role="radiogroup" aria-label="Maritime agent" className="flex flex-col gap-1">
                    {agents.map((a) => (
                        <button
                            key={a.id}
                            type="button"
                            role="radio"
                            aria-checked={choice?.type === 'existing' && choice.id === a.id}
                            aria-label={a.name || a.id}
                            onClick={() => onChoice({ type: 'existing', id: a.id, kind: a.kind ?? (choice?.type === 'existing' ? choice.kind : 'hermes'), name: a.name })}
                            className={cn(
                                'flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs',
                                choice?.type === 'existing' && choice.id === a.id ? 'border-foreground/50 bg-accent font-medium' : 'border-border hover:bg-accent/50',
                            )}
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                <AgentLogo logo={a.kind ? kindInfo(a.kind).logo : undefined} className="size-4" />
                                <span className="min-w-0 truncate">{a.name || a.id}</span>
                            </span>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                                {a.kind ? `${kindInfo(a.kind).label} · ${a.status}` : `${a.templateId ?? a.framework} · ${a.status}`}
                            </span>
                        </button>
                    ))}
                </div>
            )}
            {picked && !picked.kind && (
                <div className="mt-1 flex flex-col gap-1.5 rounded-lg border border-border p-2.5">
                    <span className="text-[11px] text-muted-foreground">Maritime doesn’t say what this agent runs. Which is it?</span>
                    <div role="radiogroup" aria-label="Runs" className="flex gap-1.5">
                        {KINDS.map((k) => (
                            <button
                                key={k}
                                type="button"
                                role="radio"
                                aria-checked={choice?.type === 'existing' && choice.kind === k}
                                aria-label={kindInfo(k).label}
                                onClick={() => onChoice({ type: 'existing', id: picked.id, kind: k, name: picked.name })}
                                className={cn('rounded-md border px-2 py-1 text-xs', choice?.type === 'existing' && choice.kind === k ? 'border-foreground/50 bg-accent font-medium' : 'border-border')}
                            >
                                {kindInfo(k).label}
                            </button>
                        ))}
                    </div>
                </div>
            )}
            {error && <span role="alert" className="text-[11px] text-destructive">{error}</span>}
        </div>
    )
}
