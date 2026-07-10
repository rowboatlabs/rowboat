// Built-in agent traits: static metadata with deliberately zero imports.
// The registry (registry.ts) owns the id -> builder table, but its builders
// drag in the copilot instruction chain, which transitively reaches
// di/container — so upstream layers (sessions) reading a trait through the
// registry would create a module cycle back into themselves. Traits live in
// this leaf so trait checks are safe to import from anywhere.

export interface AgentTraits {
    // Receives workspace context — agent notes and the user work directory —
    // composed into its system prompt.
    workspaceContext?: boolean;
    // Session-loaded skills (activeSkills) re-attach their tools on later
    // turns. Distinct from workspaceContext: a trait per concern, so neither
    // silently inherits the other's meaning.
    skillCarryForward?: boolean;
}

// "rowboatx" is a legacy alias for the copilot: both ids share one traits
// object. Agents absent from this table have no traits (user agents, and
// builtins that need none).
const COPILOT_TRAITS: AgentTraits = {
    workspaceContext: true,
    skillCarryForward: true,
};

const agentTraits: Record<string, AgentTraits> = {
    copilot: COPILOT_TRAITS,
    rowboatx: COPILOT_TRAITS,
};

// Trait lookups for assembly decisions. Unknown/user agents have no traits.
function hasTrait(
    agentId: string | null | undefined,
    trait: keyof AgentTraits,
): boolean {
    return (
        agentId != null &&
        Object.hasOwn(agentTraits, agentId) &&
        agentTraits[agentId][trait] === true
    );
}

export function hasWorkspaceContext(agentId: string | null | undefined): boolean {
    return hasTrait(agentId, "workspaceContext");
}

export function carriesSkillsForward(agentId: string | null | undefined): boolean {
    return hasTrait(agentId, "skillCarryForward");
}
