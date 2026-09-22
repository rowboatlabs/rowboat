import { agentLabel, getAgentDescriptor } from '../agent-registry.js';
import {
    meetsMinimumVersion,
    probeExternalVersionSync,
    resolveExternalAgentPathSync,
} from './external-agent.js';
import type { CodingAgent } from './types.js';

export interface EngineProgress {
    phase: 'check' | 'download' | 'verify' | 'extract' | 'done';
    receivedBytes?: number;
    totalBytes?: number;
}

export interface EnsureEngineOptions {
    onProgress?: (p: EngineProgress) => void;
    signal?: AbortSignal;
}

export interface ProvisionedEngine {
    executablePath: string;
    version: string;
}

// All coding agents are installed by the user and detected on PATH; there is no
// managed engine download. These predicates remain so callers can stay generic.

export function isEngineSupported(_agent: CodingAgent): boolean {
    return true;
}

export function isEngineProvisioned(_agent: CodingAgent): boolean {
    return false;
}

// Return the agent's resolved executable path, or throw a clear, user-facing
// error. The launch path uses this, so detection (status) and spawn never
// disagree — it is the same resolver in both.
export function getProvisionedEnginePath(agent: CodingAgent): string {
    const resolvedPath = resolveExternalAgentPathSync(agent);
    if (!resolvedPath) {
        throw new Error(
            `${agentLabel(agent)} isn't installed. Install it and ensure it is on your PATH, then reopen Settings → Code Mode.`,
        );
    }
    const descriptor = getAgentDescriptor(agent);
    if (descriptor.strategy === 'external' && descriptor.minVersion) {
        const version = probeExternalVersionSync(resolvedPath);
        if (!meetsMinimumVersion(agent, version)) {
            throw new Error(
                `${agentLabel(agent)} ${version} is too old for the ACP protocol — upgrade it and try again.`,
            );
        }
    }
    return resolvedPath;
}

export async function ensureEngine(agent: CodingAgent, _opts: EnsureEngineOptions = {}): Promise<ProvisionedEngine> {
    throw new Error(
        `Code mode: ${agentLabel(agent)} is installed by the user, not downloaded by Rowboat. No engine provisioning is available.`,
    );
}