import type { spaces } from '@x/shared'
import { useMemberNames, useSpaceProfiles } from '@/components/spaces/member-text'
import { useSpaceRefs } from '@/components/spaces/space-nav'
import { useAgentCapabilities } from '@/hooks/use-space-invocations'
import { mentionedMemberIds } from '@/lib/spaces-mentions'
import { cn } from '@/lib/utils'

// The options an agent's connector declared (Harbor spec §8 Invocation
// options, 2026-09-30), offered in the composer while the draft mentions that
// agent — e.g. a coding agent's Environment. Harbor passes the picked values
// through uninterpreted; unpicked means the connector's own default.

export type AgentOptionValues = Record<string, Record<string, string | boolean>>

export function AgentOptionsStrip({ draft, values, onChange }: {
    draft: string
    values: AgentOptionValues
    onChange: (next: AgentOptionValues) => void
}) {
    const refs = useSpaceRefs()
    const { byId } = useSpaceProfiles()
    const names = useMemberNames()
    const agentIds = mentionedMemberIds(draft).filter((id) => byId.get(id)?.kind === 'agent')
    const caps = useAgentCapabilities(refs?.orgId, agentIds)
    const offering = agentIds.filter((id) => (caps.get(id)?.options.length ?? 0) > 0)
    if (offering.length === 0) return null

    const set = (agentId: string, key: string, value: string | boolean | undefined) => {
        const forAgent = { ...(values[agentId] ?? {}) }
        if (value === undefined || value === '' || value === false) delete forAgent[key]
        else forAgent[key] = value
        const next = { ...values }
        if (Object.keys(forAgent).length > 0) next[agentId] = forAgent
        else delete next[agentId]
        onChange(next)
    }

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
                                <option value="">{option.label}: default</option>
                                {option.choices.map((choice) => (
                                    <option key={choice.id} value={choice.id}>{option.label}: {choice.label}</option>
                                ))}
                            </select>
                        ) : (
                            <button
                                key={option.key}
                                type="button"
                                aria-pressed={values[agentId]?.[option.key] === true}
                                onClick={() => set(agentId, option.key, values[agentId]?.[option.key] !== true)}
                                className={cn(
                                    'flex h-7 shrink-0 items-center rounded-full px-2.5 text-xs font-medium transition-colors',
                                    values[agentId]?.[option.key] === true ? 'bg-secondary text-foreground hover:bg-secondary/70' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
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
