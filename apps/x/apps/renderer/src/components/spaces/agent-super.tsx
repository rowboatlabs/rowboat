import { useState } from 'react'
import type { spaces } from '@x/shared'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/lib/toast'

// Super agents (Harbor spec §4 Agent members, 2026-11-02): an admin lets an
// agent create agents to hand work to, which belong to its owner; the owner
// fills in anything secret on a card in the thread. Per agent, two plain
// switches (named in Arjun's words, 2026-11-02): ask permission before
// creating, and before deleting one it created. Everyone else reads them.

type Setting = { askBeforeCreate: boolean; askBeforeDelete: boolean }
const DEFAULT: Setting = { askBeforeCreate: true, askBeforeDelete: true }
const CREATE_LABEL = 'Ask permission before creating agents'
const DELETE_LABEL = 'Ask permission before deleting agents it creates'

export function SuperAgentSection({ orgId, agent, isAdmin, ownerName, onChanged }: {
    orgId: string
    agent: spaces.Member
    isAdmin: boolean
    ownerName: string
    onChanged: () => Promise<void>
}) {
    const [busy, setBusy] = useState(false)
    const current: Setting | null = agent.superAgent ? { askBeforeCreate: agent.superAgent.askBeforeCreate, askBeforeDelete: agent.superAgent.askBeforeDelete } : null
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

    const intro = `Lets it create agents for ${ownerName} and hand them work.`
    if (!isAdmin) {
        if (!current) return null
        return (
            <div className="flex flex-col gap-0.5">
                <h3 className="text-sm font-semibold text-foreground">Super agent</h3>
                <p className="text-xs leading-snug text-muted-foreground">{intro}</p>
                <ul className="mt-1 flex flex-col gap-0.5 text-xs text-foreground">
                    <li>{CREATE_LABEL}: {current.askBeforeCreate ? 'on' : 'off'}</li>
                    <li>{DELETE_LABEL}: {current.askBeforeDelete ? 'on' : 'off'}</li>
                </ul>
            </div>
        )
    }
    return (
        <div className="flex flex-col gap-2">
            <Toggle label="Super agent" note={intro} checked={current !== null} disabled={busy} onChange={(on) => void save(on ? DEFAULT : null)} />
            {current && (
                <div className="ml-1 flex flex-col gap-2 border-l border-border pl-3">
                    <Toggle label={CREATE_LABEL} checked={current.askBeforeCreate} disabled={busy} onChange={(on) => void save({ ...current, askBeforeCreate: on })} />
                    <Toggle label={DELETE_LABEL} checked={current.askBeforeDelete} disabled={busy} onChange={(on) => void save({ ...current, askBeforeDelete: on })} />
                </div>
            )}
        </div>
    )
}

function Toggle({ label, note, checked, disabled, onChange }: { label: string; note?: string; checked: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
    return (
        <label className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground">{label}</span>
                {note && <span className="text-xs leading-snug text-muted-foreground">{note}</span>}
            </span>
            <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} />
        </label>
    )
}
