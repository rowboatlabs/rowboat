import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { refreshAgentCapabilities } from '@/hooks/use-space-invocations'
import { kindInfo, PLATFORMS } from '@/lib/agent-kinds'

// Creating an instance for a platform agent to run on (Harbor spec §8
// Connectors, Agent37, 2026-10-02): its owner names it, caps its monthly
// model spend (Agent37's cap defaults to $0, which refuses every turn), and
// chooses whether it sleeps when idle. Harbor creates it on the agent's
// Agent37 key and makes it the agent's default. Never automatic: each
// instance bills the owner's Agent37 wallet from the moment it exists.

/** The smallest Agent37 shape, 2 vCPU / 4 GB, per month (https://www.agent37.com/docs/agents-api/billing). */
const FROM_PER_MONTH = '$4.76'

function slug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'agent'
}

export function CreateInstance({ orgId, agentId, agentName, agentKind, connection, onCreated }: {
    orgId: string
    agentId: string
    agentName: string
    agentKind: string | undefined
    connection: string | undefined
    onCreated?: () => void
}) {
    const platform = PLATFORMS[connection ?? '']?.label ?? 'platform'
    const kind = kindInfo(agentKind).label
    const [name, setName] = useState(`rowboat-${slug(agentName)}`)
    const [budget, setBudget] = useState('5')
    const [autoSleep, setAutoSleep] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [created, setCreated] = useState<string | null>(null)
    const budgetUsd = Number(budget)
    const ready = name.trim() !== '' && budget.trim() !== '' && Number.isFinite(budgetUsd) && budgetUsd >= 0

    const create = async () => {
        if (busy || !ready) return
        setBusy(true)
        setError(null)
        try {
            const { instance } = await window.ipc.invoke('spaces:createAgentInstance', { orgId, agentId, name: name.trim(), monthlyBudgetUsd: budgetUsd, autoSleep })
            setCreated(instance.label)
            void refreshAgentCapabilities(orgId, agentId)
            onCreated?.()
        } catch (err) {
            setError(err instanceof Error ? err.message : `Could not create the ${platform} instance`)
        } finally {
            setBusy(false)
        }
    }

    if (created) {
        return (
            <p className="flex items-center gap-1.5 text-xs text-foreground">
                <Check className="size-3.5 text-emerald-600" /> Created {created}. {agentName} uses it unless someone picks another.
            </p>
        )
    }

    return (
        <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
                e.preventDefault()
                void create()
            }}
        >
            <p className="text-[11px] leading-snug text-muted-foreground">
                A new {platform} instance running {kind}, on this agent’s {platform} key. Compute is billed to your {platform} wallet from {FROM_PER_MONTH} a month
                (disk only while asleep), plus model spend up to the monthly budget.
            </p>
            <div className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-40 flex-1 flex-col gap-1">
                    <span className="text-[11px] font-medium text-muted-foreground">Instance name</span>
                    <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Instance name" className="h-8 text-xs" maxLength={64} />
                </label>
                <label className="flex w-36 flex-col gap-1">
                    <span className="text-[11px] font-medium text-muted-foreground">Monthly model budget ($)</span>
                    <Input
                        value={budget}
                        onChange={(e) => setBudget(e.target.value)}
                        aria-label="Monthly model budget"
                        inputMode="decimal"
                        className="h-8 text-xs"
                    />
                </label>
            </div>
            <label className="flex items-center gap-2 text-xs text-foreground">
                <input type="checkbox" checked={autoSleep} onChange={(e) => setAutoSleep(e.target.checked)} aria-label="Sleep when idle" />
                Sleep when idle (a mention wakes it, which can take a minute or two)
            </label>
            <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={!ready || busy}>
                    {busy && <Loader2 className="size-3 animate-spin" />}
                    {busy ? 'Creating… (this can take a few minutes)' : 'Create instance'}
                </Button>
            </div>
            {error && (
                <span role="alert" className="text-[11px] text-destructive">
                    {error}
                </span>
            )}
        </form>
    )
}
