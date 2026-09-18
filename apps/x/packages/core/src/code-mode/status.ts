import os from 'os';
import path from 'path';
import type { CodingAgent } from '@x/shared/dist/code-mode.js';
import { KNOWN_AGENTS } from '@x/shared/dist/agent-catalog.js';
import { AgentStatus, CodeModeAgentStatus } from './types.js';
import { resolveExternalAgent } from './acp/external-agent.js';

// Where a CLI is typically installed when not on the (GUI-stripped) PATH.
// Kept for the legacy claude-exec helper; the agent resolver owns detection now.
export function commonInstallPaths(binary: string): string[] {
    const home = os.homedir();
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
        const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
        const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
        return [
            path.join(appData, 'npm', `${binary}.cmd`),
            path.join(appData, 'npm', `${binary}.exe`),
            path.join(localAppData, 'npm', `${binary}.cmd`),
            path.join(localAppData, 'pnpm', `${binary}.cmd`),
            path.join(home, 'AppData', 'Roaming', 'pnpm', `${binary}.cmd`),
            path.join(programFiles, 'nodejs', `${binary}.cmd`),
            path.join(home, '.volta', 'bin', `${binary}.cmd`),
        ];
    }
    return [
        '/usr/local/bin',
        '/opt/homebrew/bin',
        '/usr/bin',
        path.join(home, '.npm-global', 'bin'),
        path.join(home, '.local', 'bin'),
        path.join(home, '.volta', 'bin'),
        path.join(home, 'bin'),
    ].map((dir) => path.join(dir, binary));
}

// Every coding agent is externally installed, so `installed` is PATH resolution
// and `signedIn` is best-effort: an indeterminate answer is reported as
// signed-in so a detectable binary stays selectable (readiness for external
// agents is `installed` alone).
async function checkExternalAgentStatus(agent: CodingAgent): Promise<AgentStatus> {
    const resolved = await resolveExternalAgent(agent).catch(() => null);
    if (!resolved) return { installed: false, signedIn: false };
    return { installed: true, signedIn: true, version: resolved.version };
}

export async function checkCodeModeAgentStatus(): Promise<CodeModeAgentStatus> {
    const entries = await Promise.all(
        KNOWN_AGENTS.map(async (agent) => [agent, await checkExternalAgentStatus(agent)] as const),
    );
    return Object.fromEntries(entries) as CodeModeAgentStatus;
}