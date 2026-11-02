import { useState } from 'react'
import type { spaces } from '@x/shared'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/lib/toast'

// Super agents (Harbor spec §4 Agent members, 2026-11-02): an admin lets an
// agent create agents to hand work to, which belong to its owner; the owner
// fills in anything secret on a card in the thread. Per agent, the admin
// chooses whether the owner approves a request that needs nothing more (on
// by default) and whether it may delete the agents it created. Everyone else
// reads what it may do.

type Setting = { approval: 'always' | 'never'; canDelete: boolean }
const DEFAULT: Setting = { approval: 'always', canDelete: false }

function describe(s: Setting, ownerName: string): string {
    const approval = s.approval === 'always' ? `${ownerName} approves each one in the thread` : `${ownerName} sets up only the ones that need a key`
    return `It can create agents for ${ownerName} to hand work to. ${approval}${s.canDelete ? '. It can delete the ones it created' : ''}.`
}

export function SuperAgentSection({ orgId, agent, isAdmin, ownerName, onChanged }: {
    orgId: string
    agent: spaces.Member
    isAdmin: boolean
    ownerName: string
    onChanged: () => Promise<void>
}) {
    const [busy, setBusy] = useState(false)
    const current: Setting | null = agent.superAgent ? { approval: agent.superAgent.approval, canDelete: agent.superAgent.canDelete } : null
    const save = async (next: Setting | null) => {
        if (busy) return
        setBusy(true)
        try {
            await window.ipc.invoke('spaces:setAgentSuper', { orgId, agentId: agent.id, superAgent: next })
            await onChanged()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not change what it can do', 'error')
        } finally {
            setBusy(false)
        }
    }

    if (!isAdmin) {
        if (!current) return null
        return (
            <div className="flex flex-col gap-0.5">
                <h3 className="text-sm font-semibold text-foreground">Super agent</h3>
                <p className="text-xs leading-snug text-muted-foreground">{describe(current, ownerName)}</p>
            </div>
        )
    }
    return (
        <div className="flex flex-col gap-2">
            <Toggle
                label="Super agent"
                note={current ? describe(current, ownerName) : `Let it create agents to hand work to. They belong to ${ownerName}, who fills in any keys they need.`}
                checked={current !== null}
                disabled={busy}
                onChange={(on) => void save(on ? DEFAULT : null)}
            />
            {current && (
                <div className="ml-1 flex flex-col gap-2 border-l border-border pl-3">
                    <Toggle
                        label="Ask its owner first"
                        note={`Hermes and Codex on Rowboat wait for ${ownerName} to allow them on a card in the thread. Agents that need a key always wait for ${ownerName} to set them up.`}
                        checked={current.approval === 'always'}
                        disabled={busy}
                        onChange={(on) => void save({ ...current, approval: on ? 'always' : 'never' })}
                    />
                    <Toggle
                        label="Can delete what it creates"
                        note="Only the agents it created, never any other."
                        checked={current.canDelete}
                        disabled={busy}
                        onChange={(on) => void save({ ...current, canDelete: on })}
                    />
                </div>
            )}
        </div>
    )
}

function Toggle({ label, note, checked, disabled, onChange }: { label: string; note: string; checked: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
    return (
        <label className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground">{label}</span>
                <span className="text-xs leading-snug text-muted-foreground">{note}</span>
            </span>
            <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} />
        </label>
    )
}
