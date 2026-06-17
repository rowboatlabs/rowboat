import { createRequire } from 'module';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { CodingAgent } from './types.js';
import { ensureEngine, type EnsureEngineOptions } from './engine-provisioner.js';

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

// Locate an adapter's package.json. In packaged builds Electron Forge strips the
// workspace node_modules, so the adapters (+ their dependency closure) are staged
// next to the bundle at `.package/acp/node_modules` by the generateAssets hook (see
// apps/main/forge.config.cjs). In dev they resolve normally via the pnpm symlink.
// Try the staged location first, then fall back to ordinary resolution.
function resolveAdapterPkgJson(pkg: string): string {
    // The main process is esbuild-bundled to `.package/dist/main.cjs`, so the staged
    // adapters live one level up at `.package/acp`. (import.meta.url is rewritten to
    // the bundle path by bundle.mjs, so this holds in both dev and packaged builds.)
    const stagedRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'acp');
    for (const opts of [{ paths: [stagedRoot] }, undefined]) {
        try {
            return require.resolve(`${pkg}/package.json`, opts);
        } catch {
            // not here — try the next resolution strategy
        }
    }
    throw new Error(
        `ACP adapter '${pkg}' not found — expected it staged at ` +
        `${path.join(stagedRoot, 'node_modules', pkg)} (packaged build) or resolvable ` +
        `from node_modules (dev).`,
    );
}

// Resolve the adapter's executable ENTRY (its `bin`, not its library `main`) to an
// absolute path so we can spawn it directly with `node <entry>`.
function resolveAdapterEntry(pkg: string): string {
    const pkgJsonPath = resolveAdapterPkgJson(pkg);
    const pkgDir = path.dirname(pkgJsonPath);
    const pkgJson = require(pkgJsonPath) as { bin?: string | Record<string, string> };
    const bin = pkgJson.bin;
    const rel = typeof bin === 'string' ? bin : bin ? Object.values(bin)[0] : undefined;
    if (!rel) {
        throw new Error(`ACP adapter ${pkg} has no bin entry to spawn`);
    }
    return path.join(pkgDir, rel);
}

export async function getAgentLaunchSpec(
    agent: CodingAgent,
    opts: EnsureEngineOptions = {},
): Promise<AgentLaunchSpec> {
    const entry = resolveAdapterEntry(ADAPTER_PACKAGE[agent]);
    const env: NodeJS.ProcessEnv = { ...process.env };

    // Provision the pinned native engine on demand (downloaded on first use, cached
    // thereafter) and point the adapter at it. We never depend on a user's global
    // install — the engine version is locked to what the adapter was built against, so
    // the ACP handshake is always compatible. The adapters honor these env vars
    // (claude: CLAUDE_CODE_EXECUTABLE, codex: CODEX_PATH) and fall back to their own
    // bundled engine only when unset — which we never leave unset.
    const engine = await ensureEngine(agent, opts);
    if (agent === 'claude') {
        env.CLAUDE_CODE_EXECUTABLE = engine.executablePath;
        // Make the claude-agent-sdk log the exact spawn command + claude's stderr to
        // ~/.claude/debug/sdk-*.txt, so a failed/hung launch has a diagnosable trail
        // instead of a silently dropped connection.
        env.DEBUG_CLAUDE_AGENT_SDK = '1';
    } else {
        env.CODEX_PATH = engine.executablePath;
    }

    // We spawn the adapter with process.execPath. Inside Electron's main process
    // that is the Electron binary, NOT node — so set ELECTRON_RUN_AS_NODE=1 to make
    // it behave as a plain Node runtime. (Harmless under a real node process, which
    // ignores the var.) Without this the child never runs as node and the ACP stdio
    // stream closes immediately ("ACP connection closed").
    env.ELECTRON_RUN_AS_NODE = '1';

    return { command: process.execPath, args: [entry], env };
}
