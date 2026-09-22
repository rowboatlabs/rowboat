import { CODING_AGENT_IDS, type CodingAgent } from "./code-mode.js";

// How a coding agent is supplied to the app:
//  - "managed": Rowboat downloads and pins the engine.
//  - "external": the user installs the CLI; Rowboat detects it on PATH.
export type ProvisioningStrategy = "managed" | "external";

export interface AgentCatalogEntry {
    id: CodingAgent;
    /** Full product name shown in UI. */
    label: string;
    /** Short form for tight surfaces (chips, run cards). */
    shortLabel: string;
    provisioning: ProvisioningStrategy;
    /** Executable names to probe on PATH, in preference order. */
    binNames: string[];
    /** Args that start the agent's ACP server. */
    acpArgs: string[];
}

// The one shared, renderer-consumable source of agent identity. The renderer
// cannot import @x/core, so labels, strategy, and ACP launch args live here; the
// node-only resolution/version probing lives in core keyed by the same ids.
export const AGENT_CATALOG: Record<CodingAgent, AgentCatalogEntry> = {
    opencode: {
        id: "opencode",
        label: "OpenCode",
        shortLabel: "OpenCode",
        provisioning: "external",
        binNames: ["opencode"],
        acpArgs: ["acp"],
    },
    cursor: {
        id: "cursor",
        label: "Cursor",
        shortLabel: "Cursor",
        provisioning: "external",
        binNames: ["cursor-agent"],
        acpArgs: ["acp"],
    },
    hermes: {
        id: "hermes",
        label: "Hermes",
        shortLabel: "Hermes",
        provisioning: "external",
        binNames: ["hermes"],
        // --accept-hooks keeps Hermes ACP from blocking on an unseen-hook TTY
        // prompt when spawned inside Rowboat.
        acpArgs: ["acp", "--accept-hooks"],
    },
};

export const KNOWN_AGENTS: readonly CodingAgent[] = CODING_AGENT_IDS;

export function agentLabel(id: CodingAgent): string {
    return AGENT_CATALOG[id].label;
}

export function isExternalAgent(id: CodingAgent): boolean {
    return AGENT_CATALOG[id].provisioning === "external";
}