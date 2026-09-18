import { CODING_AGENT_IDS, type CodingAgent } from "./code-mode.js";

// How a coding agent is supplied to the app:
//  - "managed": Rowboat downloads and pins the engine (Claude Code, Codex).
//  - "external": the user installs the CLI; Rowboat detects it on PATH.
export type ProvisioningStrategy = "managed" | "external";

export interface AgentCatalogEntry {
    id: CodingAgent;
    /** Full product name shown in UI ("Claude Code"). */
    label: string;
    /** Short form for tight surfaces (chips, run cards). */
    shortLabel: string;
    provisioning: ProvisioningStrategy;
}

// The one shared, renderer-consumable source of agent identity. The renderer
// cannot import @x/core, so labels and provisioning strategy live here; the
// node-only launch/detection descriptors live in core keyed by the same ids.
export const AGENT_CATALOG: Record<CodingAgent, AgentCatalogEntry> = {
    claude: { id: "claude", label: "Claude Code", shortLabel: "Claude", provisioning: "managed" },
    codex: { id: "codex", label: "Codex", shortLabel: "Codex", provisioning: "managed" },
    opencode: { id: "opencode", label: "OpenCode", shortLabel: "OpenCode", provisioning: "external" },
};

export const KNOWN_AGENTS: readonly CodingAgent[] = CODING_AGENT_IDS;

export function agentLabel(id: CodingAgent): string {
    return AGENT_CATALOG[id].label;
}

export function isExternalAgent(id: CodingAgent): boolean {
    return AGENT_CATALOG[id].provisioning === "external";
}
