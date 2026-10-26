import type { spaces } from '@x/shared'
import { ModelSelector, type ReasoningEffortLevel } from '@/components/model-selector'
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
// shown preselected, or else the connector's own. A choice list is the main
// chat's model picker over the declared choices (2026-10-08); an agent that
// declares both `model` and `effort` gets one picker, as the chat has: the
// model's name on the pill, its effort levels on hover.

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
    const set = (agentId: string, key: string, value: string | boolean | undefined) => setMany(agentId, { [key]: value })
    const setMany = (agentId: string, changes: Record<string, string | boolean | undefined>) => {
        const forAgent = { ...(values[agentId] ?? {}) }
        for (const [key, value] of Object.entries(changes)) {
            const fallback = defaults.get(agentId)?.[key] ?? (typeof value === 'boolean' ? false : '')
            if (value === undefined || value === '' || value === fallback) delete forAgent[key]
            else forAgent[key] = value
        }
        const next = { ...values }
        if (Object.keys(forAgent).length > 0) next[agentId] = forAgent
        else delete next[agentId]
        onChange(next)
    }

    const on = (agentId: string, key: string) => (values[agentId]?.[key] ?? defaults.get(agentId)?.[key]) === true
    const label = (option: spaces.InvocationOption & { type: 'select' }, id: unknown) => option.choices.find((c) => c.id === id)?.label
    const current = (agentId: string, key: string) => {
        const picked = values[agentId]?.[key] ?? defaults.get(agentId)?.[key]
        return typeof picked === 'string' ? picked : undefined
    }

    // Model and effort as one pick: both keys set (or cleared) together.
    const modelPicker = (agentId: string, model: spaces.InvocationOption & { type: 'select' }, effort: (spaces.InvocationOption & { type: 'select' }) | undefined) => {
        const name = names.get(agentId) ?? 'Agent'
        const pickedModel = current(agentId, 'model')
        const pickedEffort = effort ? current(agentId, 'effort') : undefined
        const fallbackModel = label(model, defaults.get(agentId)?.model)
        return (
            <span key="model" className="flex min-w-0 max-w-[14rem]" data-agent-option="model">
                <ModelSelector
                    value={pickedModel ? { provider: '', model: pickedModel, ...(pickedEffort ? { effort: pickedEffort as ReasoningEffortLevel } : {}) } : null}
                    onChange={(picked) => setMany(agentId, { model: picked?.model, ...(effort ? { effort: picked?.effort } : {}) })}
                    staticOptions={model.choices.map((choice) => ({ id: choice.id, label: choice.label }))}
                    defaultOption={{ label: fallbackModel ? `${fallbackModel} (default)` : `${model.label}: default` }}
                    searchPlaceholder="Search models…"
                    triggerTitle={`${name} ${model.label}`}
                    {...(effort ? { effortSelectable: true, effortLevels: [{ value: '', label: 'Default' }, ...effort.choices.map((c) => ({ value: c.id, label: c.label }))] } : {})}
                />
            </span>
        )
    }

    return (
        <>
            {offering.map((agentId) => (
                <span key={agentId} className="flex shrink-0 items-center gap-1" data-agent-options={agentId}>
                    <span className="mx-0.5 h-4 w-px bg-border" />
                    <span className="text-[11px] text-muted-foreground">{names.get(agentId) ?? 'Agent'}</span>
                    {caps.get(agentId)!.options.map((option: spaces.InvocationOption) => {
                        const options = caps.get(agentId)!.options
                        const effort = options.find((o): o is spaces.InvocationOption & { type: 'select' } => o.key === 'effort' && o.type === 'select')
                        const model = options.find((o): o is spaces.InvocationOption & { type: 'select' } => o.key === 'model' && o.type === 'select')
                        if (model && option.key === 'effort') return null // rides the model picker
                        if (option.key === 'model' && option.type === 'select') return modelPicker(agentId, option, effort)
                        return option.type === 'select' ? (
                            <span key={option.key} className="flex min-w-0 max-w-[12rem]" data-agent-option={option.key}>
                                <ModelSelector
                                    value={typeof values[agentId]?.[option.key] === 'string' ? { provider: '', model: String(values[agentId]![option.key]) } : null}
                                    onChange={(picked) => set(agentId, option.key, picked?.model)}
                                    staticOptions={option.choices.map((choice) => ({ id: choice.id, label: choice.label }))}
                                    defaultOption={{ label: `${option.label}: ${option.choices.find((c) => c.id === defaults.get(agentId)?.[option.key])?.label ?? 'default'}` }}
                                    searchPlaceholder={`Search ${option.label.toLowerCase()}…`}
                                    triggerTitle={`${names.get(agentId) ?? 'Agent'} ${option.label}`}
                                />
                            </span>
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
                        )
                    })}
                </span>
            ))}
        </>
    )
}
