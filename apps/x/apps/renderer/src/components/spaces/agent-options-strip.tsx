import type { spaces } from '@x/shared'
import { useMemberNames, useSpaceProfiles } from '@/components/spaces/member-text'
import { useSpaceRefs } from '@/components/spaces/space-nav'
import { useAgentCapabilities, useAgentOptionDefaults } from '@/hooks/use-space-invocations'
import { mentionedMemberIds } from '@/lib/spaces-mentions'
import { cn } from '@/lib/utils'

// The options an agent's connector declared (Harbor spec §8 Invocation
// options, 2026-09-30), offered in the composer while the draft mentions that
// agent, or always in a DM with it, where every message invokes it — e.g. a
// coding agent's Environment. Harbor passes the picked values through
// uninterpreted; unpicked means the agent owner's default (2026-10-01),
// shown preselected, or else the connector's own.

export type AgentOptionValues = Record<string, Record<string, string | boolean>>

export function AgentOptionsStrip({ draft, values, onChange }: {
    draft: string
    values: AgentOptionValues
    onChange: (next: AgentOptionValues) => void
}) {
    const refs = useSpaceRefs()
    const { byId } = useSpaceProfiles()
    const names = useMemberNames()
    const addressed = new Set([...mentionedMemberIds(draft), ...(refs?.directWith ? [refs.directWith] : [])])
    const agentIds = [...addressed].filter((id) => byId.get(id)?.kind === 'agent')
    const caps = useAgentCapabilities(refs?.orgId, agentIds)
    const defaults = useAgentOptionDefaults(refs?.orgId, agentIds)
    const offering = agentIds.filter((id) => (caps.get(id)?.options.length ?? 0) > 0)
    if (offering.length === 0) return null

    // A value equal to the owner's default is left unpicked, so Harbor fills the default; an
    // explicit off is kept when the default is on.
    const set = (agentId: string, key: string, value: string | boolean | undefined) => {
        const forAgent = { ...(values[agentId] ?? {}) }
        const fallback = defaults.get(agentId)?.[key] ?? (typeof value === 'boolean' ? false : '')
        if (value === undefined || value === '' || value === fallback) delete forAgent[key]
        else forAgent[key] = value
        const next = { ...values }
        if (Object.keys(forAgent).length > 0) next[agentId] = forAgent
        else delete next[agentId]
        onChange(next)
    }

    const on = (agentId: string, key: string) => (values[agentId]?.[key] ?? defaults.get(agentId)?.[key]) === true

    return (
        <>
            {offering.map((agentId) => (
                <span key={agentId} className="flex shrink-0 items-center gap-1" data-agent-options={agentId}>
                    <span className="mx-0.5 h-4 w-px bg-border" />
                    <span className="text-[11px] text-muted-foreground">{names.get(agentId) ?? 'Agent'}</span>
                    {caps.get(agentId)!.options.map((option: spaces.InvocationOption) =>
                        option.type === 'select' ? (
                            <select
                                key={option.key}
                                aria-label={`${names.get(agentId) ?? 'Agent'} ${option.label}`}
                                value={String(values[agentId]?.[option.key] ?? '')}
                                onChange={(e) => set(agentId, option.key, e.target.value)}
                                className="h-7 max-w-[12rem] rounded-full bg-muted px-2 text-xs text-foreground/80 hover:bg-accent"
                            >
                                <option value="">
                                    {option.label}: {option.choices.find((c) => c.id === defaults.get(agentId)?.[option.key])?.label ?? 'default'}
                                </option>
                                {option.choices.map((choice) => (
                                    <option key={choice.id} value={choice.id}>{option.label}: {choice.label}</option>
                                ))}
                            </select>
                        ) : (
                            <button
                                key={option.key}
                                type="button"
                                aria-pressed={on(agentId, option.key)}
                                onClick={() => set(agentId, option.key, !on(agentId, option.key))}
                                className={cn(
                                    'flex h-7 shrink-0 items-center rounded-full px-2.5 text-xs font-medium transition-colors',
                                    on(agentId, option.key) ? 'bg-secondary text-foreground hover:bg-secondary/70' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                                )}
                            >
                                {option.label}
                            </button>
                        ),
                    )}
                </span>
            ))}
        </>
    )
}
