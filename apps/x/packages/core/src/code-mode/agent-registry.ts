import {
    AGENT_CATALOG,
    KNOWN_AGENTS,
    agentLabel,
    isExternalAgent,
} from '@x/shared/dist/agent-catalog.js';
import type { CodingAgent } from '@x/shared/dist/code-mode.js';

// Per-agent implementation descriptors. Identity (label, strategy) lives in the
// shared catalog so the renderer can consume it; this table adds the node-only
// launch/detection facts that only the core process needs.
export interface ManagedAgentDescriptor {
    strategy: 'managed';
}

export interface ExternalAgentDescriptor {
    strategy: 'external';
    /** Binary names to probe on PATH, in preference order. */
    binNames: string[];
    /** Minimum version whose `acp` server is protocol-compatible. */
    minVersion?: string;
}

export type AgentDescriptor = ManagedAgentDescriptor | ExternalAgentDescriptor;

export const AGENT_DESCRIPTORS: Record<CodingAgent, AgentDescriptor> = {
    claude: { strategy: 'managed' },
    codex: { strategy: 'managed' },
    opencode: { strategy: 'external', binNames: ['opencode'] },
};

export function getAgentDescriptor(id: CodingAgent): AgentDescriptor {
    const descriptor = AGENT_DESCRIPTORS[id];
    if (!descriptor) throw new Error(`Unknown coding agent: ${id}`);
    return descriptor;
}

export { AGENT_CATALOG, KNOWN_AGENTS, agentLabel, isExternalAgent };
export type { CodingAgent };
