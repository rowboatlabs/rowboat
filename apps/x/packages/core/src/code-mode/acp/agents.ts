import * as path from 'path';
import type { CodingAgent } from '@x/shared/dist/code-mode.js';
import { agentLabel, getAgentDescriptor } from '../agent-registry.js';
import { getProvisionedEnginePath } from './engine-provisioner.js';
import { loginShellPath } from './shell-env.js';

export interface AgentLaunchSpec {
    /** Absolute path to the agent CLI (resolved once, so detection and spawn agree). */
    command: string;
    /** Args that start the agent's ACP server. */
    args: string[];
    /** Extra env merged over process.env. */
    env: NodeJS.ProcessEnv;
}

export function getAgentLaunchSpec(agent: CodingAgent): AgentLaunchSpec {
    const env: NodeJS.ProcessEnv = { ...process.env };

    // Graft the user's login-shell PATH onto the engine's env. GUI (Finder)
    // launches inherit launchd's stripped PATH, so tools the agent spawns —
    // git, gh, rg, bash — would otherwise fail with "command not found" even
    // though they work from a terminal. No-op on Windows / when the probe fails.
    const shellPath = loginShellPath();
    if (shellPath && shellPath !== env.PATH) {
        const dirs = [...shellPath.split(path.delimiter), ...(env.PATH ?? '').split(path.delimiter)];
        env.PATH = [...new Set(dirs.filter(Boolean))].join(path.delimiter);
    }

    const descriptor = getAgentDescriptor(agent);
    if (descriptor.strategy !== 'external') {
        throw new Error(`${agentLabel(agent)} is not an externally-installed agent.`);
    }

    // Resolve the absolute path (and enforce the version gate) up front. Throws a
    // clear "isn't installed" error rather than a bare ENOENT at spawn time.
    return {
        command: getProvisionedEnginePath(agent),
        args: descriptor.acpArgs,
        env,
    };
}