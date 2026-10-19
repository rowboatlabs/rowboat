import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { instanceLabel, kindInfo } from '@/lib/agent-kinds'
import { cn } from '@/lib/utils'

// Which Agent37 instance a new agent is (Harbor spec §8 Connectors, Agent37,
// 2026-10-05). An instance keeps its own memory and files, so a Rowboat agent
// is exactly one: the person picks one of the instances their key reaches, or
// creates one here. Either way the app talks to Agent37 with the key being
// pasted, then adds the agent with the instance; the instance's template
// decides the agent's kind. Creating bills the person's Agent37 wallet, so it
// is never automatic, and its monthly model budget is asked for (Agent37's
// defaults to $0, which refuses every turn).

export interface FoundInstance {
    id: string
    name: string | null
    template: string
    status: string
    kind?: string
}

export type InstanceChoice =
    | { type: 'existing'; id: string; kind: string; name: string | null }
    | { type: 'new'; kind: string; monthlyBudgetUsd: number; autoSleep: boolean }

/** The smallest Agent37 shape per month (https://www.agent37.com/docs/agents-api/billing). */
const FROM_PER_MONTH = '$4.76'
const NEW_KINDS = ['hermes', 'openclaw']

export function InstancePicker({ credential, choice, onChoice }: {
    /** The Agent37 key being pasted; the picker lists what it reaches. */
    credential: string
    choice: InstanceChoice | null
    onChoice: (choice: InstanceChoice | null) => void
}) {
    const [found, setFound] = useState<{ key: string; instances: FoundInstance[] } | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [budget, setBudget] = useState('5')
    const key = credential.trim()
    // A different key reaches different instances: what was found is for the key it was found with.
    const instances = found?.key === key ? found.instances : null

    const find = async () => {
        if (!key || loading) return
        setLoading(true)
        setError(null)
        onChoice(null)
        try {
            const { instances: list } = await window.ipc.invoke('spaces:agent37Instances', { key })
            setFound({ key, instances: list })
            const usable = list.filter((i) => i.kind)
            if (usable.length === 1) onChoice({ type: 'existing', id: usable[0]!.id, kind: usable[0]!.kind!, name: usable[0]!.name })
            else if (usable.length === 0) onChoice({ type: 'new', kind: 'hermes', monthlyBudgetUsd: 5, autoSleep: true })
        } catch (err) {
            setFound(null)
            setError(err instanceof Error ? err.message : 'Could not list the instances')
        } finally {
            setLoading(false)
        }
    }

    const newChoice = choice?.type === 'new' ? choice : null
    const setNew = (patch: Partial<Extract<InstanceChoice, { type: 'new' }>>) =>
        onChoice({ type: 'new', kind: newChoice?.kind ?? 'hermes', monthlyBudgetUsd: newChoice?.monthlyBudgetUsd ?? (Number(budget) || 0), autoSleep: newChoice?.autoSleep ?? true, ...patch })

    return (
        <div className="mt-4 flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">Instance</span>
            <span className="text-[11px] text-muted-foreground">
                The agent is one Agent37 instance, with its own memory and files. Pick one this key reaches, or create one. It can’t be changed later.
            </span>
            {instances === null ? (
                <div className="flex items-center gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => void find()} disabled={!key || loading}>
                        {loading && <Loader2 className="size-3.5 animate-spin" />}
                        Find instances
                    </Button>
                    {!key && <span className="text-[11px] text-muted-foreground">Paste the key first.</span>}
                </div>
            ) : (
                <div role="radiogroup" aria-label="Instance" className="flex flex-col gap-1">
                    {instances.map((i) => (
                        <button
                            key={i.id}
                            type="button"
                            role="radio"
                            aria-checked={choice?.type === 'existing' && choice.id === i.id}
                            aria-label={instanceLabel(i)}
                            disabled={!i.kind}
                            onClick={() => i.kind && onChoice({ type: 'existing', id: i.id, kind: i.kind, name: i.name })}
                            className={cn(
                                'flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs',
                                choice?.type === 'existing' && choice.id === i.id ? 'border-foreground/50 bg-accent font-medium' : 'border-border hover:bg-accent/50',
                                !i.kind && 'cursor-not-allowed opacity-50 hover:bg-transparent',
                            )}
                        >
                            <span className="min-w-0 truncate">{instanceLabel(i)}</span>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                                {i.kind ? `${kindInfo(i.kind).label} · ${i.status}` : `${i.template}: not Hermes or OpenClaw`}
                            </span>
                        </button>
                    ))}
                    <button
                        type="button"
                        role="radio"
                        aria-checked={choice?.type === 'new'}
                        aria-label="A new instance"
                        onClick={() => setNew({})}
                        className={cn('rounded-lg border px-2.5 py-1.5 text-left text-xs', choice?.type === 'new' ? 'border-foreground/50 bg-accent font-medium' : 'border-border hover:bg-accent/50')}
                    >
                        A new instance
                    </button>
                </div>
            )}
            {newChoice && (
                <div className="mt-1 flex flex-col gap-2 rounded-lg border border-border p-2.5">
                    <div role="radiogroup" aria-label="New instance runs" className="flex gap-1.5">
                        {NEW_KINDS.map((k) => (
                            <button
                                key={k}
                                type="button"
                                role="radio"
                                aria-checked={newChoice.kind === k}
                                aria-label={kindInfo(k).label}
                                onClick={() => setNew({ kind: k })}
                                className={cn('rounded-md border px-2 py-1 text-xs', newChoice.kind === k ? 'border-foreground/50 bg-accent font-medium' : 'border-border')}
                            >
                                {kindInfo(k).label}
                            </button>
                        ))}
                    </div>
                    <label className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Monthly model budget ($)</span>
                        <Input
                            value={budget}
                            onChange={(e) => {
                                setBudget(e.target.value)
                                const n = Number(e.target.value)
                                if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= 0) setNew({ monthlyBudgetUsd: n })
                            }}
                            aria-label="Monthly model budget"
                            inputMode="decimal"
                            className="h-7 w-20 text-xs"
                        />
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={newChoice.autoSleep} onChange={(e) => setNew({ autoSleep: e.target.checked })} aria-label="Sleep when idle" />
                        Sleep when idle (a mention wakes it, which can take a minute or two)
                    </label>
                    <span className="text-[11px] text-muted-foreground">
                        Billed to your Agent37 wallet: compute from {FROM_PER_MONTH} a month (disk only while asleep), plus model spend up to the budget. Creating it can take a few minutes.
                    </span>
                </div>
            )}
            {error && <span role="alert" className="text-[11px] text-destructive">{error}</span>}
        </div>
    )
}
