import {
    AGENT_CATALOG,
    KNOWN_AGENTS,
    agentLabel,
    isExternalAgent,
} from '@x/shared/dist/agent-catalog.js';
import type { CodingAgent } from '@x/shared/dist/code-mode.js';

// Per-agent implementation descriptor. Identity, binary names, and ACP launch
// args all live in the shared catalog (the renderer needs the labels/args too);
// this projects the node-facing shape and is the single place core reads them.
export interface AgentDescriptor {
    strategy: 'managed' | 'external';
    binNames: string[];
    acpArgs: string[];
    /** Minimum version whose `acp` server is protocol-compatible. */
    minVersion?: string;
}

export function getAgentDescriptor(id: CodingAgent): AgentDescriptor {
    const entry = AGENT_CATALOG[id];
    if (!entry) throw new Error(`Unknown coding agent: ${id}`);
    return {
        strategy: entry.provisioning,
        binNames: entry.binNames,
        acpArgs: entry.acpArgs,
    };
}

export { AGENT_CATALOG, KNOWN_AGENTS, agentLabel, isExternalAgent };
export type { CodingAgent };