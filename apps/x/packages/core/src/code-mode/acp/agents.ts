import { createRequire } from 'module';
import * as path from 'path';
import type { CodingAgent } from './types.js';
import { resolveClaudeExecutable } from './claude-exec.js';

const require = createRequire(import.meta.url);

// The ACP adapter npm package that exposes each coding agent as an ACP server.
const ADAPTER_PACKAGE: Record<CodingAgent, string> = {
    claude: '@agentclientprotocol/claude-agent-acp',
    codex: '@agentclientprotocol/codex-acp',
};

export interface AgentLaunchSpec {
    /** Executable to spawn — always `node` so we never hit the Windows .cmd EINVAL. */
    command: string;
    /** Args = [adapter entry script]. */
    args: string[];
    /** Extra env merged over process.env (e.g. CLAUDE_CODE_EXECUTABLE on Windows). */
    env: NodeJS.ProcessEnv;
}

// Resolve the adapter's executable ENTRY (its `bin`, not its library `main`) to an
// absolute path so we can spawn it directly with `node <entry>`. createRequire lets
// us resolve workspace/pnpm-installed packages from this module's location.
function resolveAdapterEntry(pkg: string): string {
    const pkgJsonPath = require.resolve(`${pkg}/package.json`);
    const pkgDir = path.dirname(pkgJsonPath);
    const pkgJson = require(`${pkg}/package.json`) as { bin?: string | Record<string, string> };
    const bin = pkgJson.bin;
    const rel = typeof bin === 'string' ? bin : bin ? Object.values(bin)[0] : undefined;
    if (!rel) {
        throw new Error(`ACP adapter ${pkg} has no bin entry to spawn`);
    }
    return path.join(pkgDir, rel);
}

export function getAgentLaunchSpec(agent: CodingAgent): AgentLaunchSpec {
    const entry = resolveAdapterEntry(ADAPTER_PACKAGE[agent]);
    const env: NodeJS.ProcessEnv = { ...process.env };

    // Point the Claude adapter at the real claude executable. On Windows this is
    // mandatory (Node can't spawn the .cmd shim — EINVAL); on macOS/Linux it's a
    // PATH safety net for GUI launches. Resolver is a no-op when claude isn't found,
    // leaving the adapter to do its own lookup. (Codex relies on PATH for now — wire
    // an equivalent when we add Codex support.)
    if (agent === 'claude' && !env.CLAUDE_CODE_EXECUTABLE) {
        const exe = resolveClaudeExecutable();
        if (exe) env.CLAUDE_CODE_EXECUTABLE = exe;
    }

    return { command: process.execPath, args: [entry], env };
}
