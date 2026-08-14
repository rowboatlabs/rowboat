import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { CodeModeAgentStatus } from './types.js';
import { isEngineProvisioned, getProvisionedEnginePath } from './acp/engine-provisioner.js';
import { decodeJwtPayload } from '../auth/jwt.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Generous ceiling for the engine's auth-status probe: the engine is a bundled
// node runtime with a noticeable cold start, and on macOS its first credential
// read can block on a one-time Keychain authorization dialog.
const ENGINE_PROBE_TIMEOUT_MS = 15_000;

// Where claude.cmd / codex.cmd typically live when installed via npm/pnpm/yarn.
// We scan these directly because Electron's spawned shell sometimes doesn't
// inherit the user's full PATH (especially on macOS GUI launches, and even on
// Windows when global npm prefix isn't propagated to system PATH).
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
        '/opt/homebrew/bin',          // Apple Silicon Homebrew
        '/usr/bin',
        path.join(home, '.npm-global', 'bin'),
        path.join(home, '.local', 'bin'),
        path.join(home, '.volta', 'bin'),
        path.join(home, '.nvm', 'versions', 'node'),  // partial; nvm has versioned subdirs
        path.join(home, 'bin'),
    ].map(dir => path.join(dir, binary));
}

// Given the raw credentials JSON (from a file or the macOS Keychain), decide
// whether it represents a usable signed-in state: a valid API key, an unexpired
// access token, or a refresh token (which can mint a new access token).
function isClaudeCredentialSignedIn(raw: string): boolean {
    try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;

        const oauth = parsed.claudeAiOauth as Record<string, unknown> | undefined;
        if (oauth) {
            const access = typeof oauth.accessToken === 'string' ? oauth.accessToken : '';
            const refresh = typeof oauth.refreshToken === 'string' ? oauth.refreshToken : '';
            if (refresh.length > 0) return true;
            if (access.length > 0) {
                if (typeof oauth.expiresAt === 'number' && oauth.expiresAt > 0 && oauth.expiresAt < Date.now()) {
                    return false;
                }
                return true;
            }
        }

        if (typeof parsed.apiKey === 'string' && parsed.apiKey.length > 10) return true;
        if (typeof parsed.accessToken === 'string' && parsed.accessToken.length > 10) return true;
    } catch {
        // malformed JSON
    }
    return false;
}

// Reads Claude Code's credentials from the macOS login Keychain, where the
// CLI stores them on macOS (service "Claude Code-credentials"). On Linux/Windows
// it uses the ~/.claude/.credentials.json file instead, so this is a no-op there.
//
// Caveats:
//  - The first read by this app (a different binary than the `claude` CLI that
//    created the item) triggers a one-time macOS authorization dialog; the user
//    must "Always Allow". Headless/SSH sessions can't show it and will fail.
//  - If CLAUDE_CONFIG_DIR is set, Claude appends a SHA-256 suffix to the service
//    name, which this lookup won't match — such setups usually keep the file too.
async function readClaudeKeychainCredential(): Promise<string | null> {
    if (process.platform !== 'darwin') return null;
    try {
        const { stdout } = await execAsync(
            `security find-generic-password -s "Claude Code-credentials" -w`,
            { timeout: 5000 },
        );
        const out = stdout.trim();
        return out.length > 0 ? out : null;
    } catch {
        // not present in keychain
        return null;
    }
}

// On exec failure, promisified execFile rejects with the process's captured
// stdout/stderr and exit info attached to the error — pull those back out.
function execFailureDetails(err: unknown): { exitCode: number | null; killed: boolean; stdout: string; stderr: string } {
    const e = err as { code?: unknown; killed?: boolean; stdout?: unknown; stderr?: unknown };
    return {
        // `code` is the numeric exit code when the process ran, or a string
        // errno (e.g. 'ENOENT') when the spawn itself failed.
        exitCode: typeof e.code === 'number' ? e.code : null,
        killed: e.killed === true,
        stdout: typeof e.stdout === 'string' ? e.stdout : '',
        stderr: typeof e.stderr === 'string' ? e.stderr : '',
    };
}

// Parse `claude auth status` output: a JSON object with a boolean `loggedIn`
// (plus authMethod/email/subscriptionType we don't need here). Returns null if
// the output doesn't contain that shape.
function parseClaudeAuthStatus(stdout: string): boolean | null {
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        const parsed = JSON.parse(stdout.slice(start, end + 1)) as Record<string, unknown>;
        return typeof parsed.loggedIn === 'boolean' ? parsed.loggedIn : null;
    } catch {
        return null;
    }
}

// Ask the provisioned Claude engine itself whether it is signed in
// (`claude auth status` prints a JSON blob with `loggedIn`). This is ground
// truth: the engine resolves credentials exactly the way a real code-mode
// session will — macOS Keychain, CLAUDE_CONFIG_DIR, managed/enterprise auth —
// so we don't have to guess where they live. Returns null when the engine
// isn't provisioned or the probe itself failed to run (spawn error, timeout);
// the caller then falls back to the credential-file heuristic.
async function checkClaudeSignedInViaEngine(): Promise<boolean | null> {
    if (!isEngineProvisioned('claude')) return null;
    const engine = getProvisionedEnginePath('claude');
    try {
        const { stdout } = await execFileAsync(engine, ['auth', 'status'], { timeout: ENGINE_PROBE_TIMEOUT_MS });
        return parseClaudeAuthStatus(stdout);
    } catch (err) {
        // A logged-out engine may exit non-zero but still print the status JSON.
        const { exitCode, stdout } = execFailureDetails(err);
        const parsed = parseClaudeAuthStatus(stdout);
        if (parsed !== null) return parsed;
        // Ran to completion without status output — engine says it can't auth.
        if (exitCode !== null) return false;
        return null;
    }
}

// Ask the provisioned Codex engine whether it is signed in. `codex login status`
// exits 0 when logged in and non-zero ("Not logged in") when not. Returns null
// when the engine isn't provisioned or the probe didn't run.
async function checkCodexSignedInViaEngine(): Promise<boolean | null> {
    if (!isEngineProvisioned('codex')) return null;
    const engine = getProvisionedEnginePath('codex');
    try {
        await execFileAsync(engine, ['login', 'status'], { timeout: ENGINE_PROBE_TIMEOUT_MS });
        return true;
    } catch (err) {
        const { exitCode, killed } = execFailureDetails(err);
        if (killed) return null;                 // timed out — engine state unknown
        if (exitCode !== null) return false;     // ran and reported logged-out
        return null;                             // spawn failure — fall back
    }
}

// Fallback heuristic when the engine isn't available to ask: look for Claude
// Code's credentials on disk. On macOS they live in the login Keychain; on
// Linux/Windows in ~/.claude/.credentials.json (or ~/.config fallback). This
// can false-negative (Keychain-only installs, CLAUDE_CONFIG_DIR, enterprise
// apiKeyHelper setups) — the engine probe above is authoritative.
async function checkClaudeSignedInHeuristic(): Promise<boolean> {
    const home = os.homedir();
    const candidates = [
        path.join(home, '.claude', '.credentials.json'),
        path.join(home, '.config', 'claude', '.credentials.json'),
    ];
    for (const full of candidates) {
        try {
            const raw = await fs.readFile(full, 'utf-8');
            if (isClaudeCredentialSignedIn(raw)) return true;
        } catch {
            // try next candidate
        }
    }

    // macOS: credentials are stored in the Keychain rather than on disk.
    const keychainRaw = await readClaudeKeychainCredential();
    if (keychainRaw && isClaudeCredentialSignedIn(keychainRaw)) return true;

    return false;
}

// Fallback heuristic when the engine isn't available to ask: Codex auth at
// ~/.codex/auth.json on all platforms. Considered signed in if API key set,
// or a refresh_token / access_token exists. id_token expiry is intentionally
// NOT used as a rejection signal — id_tokens are short-lived (~1h) but
// refresh_tokens persist for weeks.
async function checkCodexSignedInHeuristic(): Promise<boolean> {
    const home = os.homedir();
    const full = path.join(home, '.codex', 'auth.json');
    try {
        const raw = await fs.readFile(full, 'utf-8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;

        if (typeof parsed.OPENAI_API_KEY === 'string' && parsed.OPENAI_API_KEY.length > 10) return true;

        const tokens = parsed.tokens as Record<string, unknown> | undefined;
        if (tokens) {
            const refresh = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : '';
            const access = typeof tokens.access_token === 'string' ? tokens.access_token : '';
            const id = typeof tokens.id_token === 'string' ? tokens.id_token : '';
            if (refresh.length > 0 || access.length > 0 || id.length > 0) return true;
        }
    } catch {
        // file missing or unreadable
    }
    return false;
}

// Exported for diagnostics — silenced unused-var warning by re-export only.
export { decodeJwtPayload };

export async function checkCodeModeAgentStatus(): Promise<CodeModeAgentStatus> {
    const [claudeSignedIn, codexSignedIn] = await Promise.all([
        checkClaudeSignedInViaEngine().then((viaEngine) => viaEngine ?? checkClaudeSignedInHeuristic()),
        checkCodexSignedInViaEngine().then((viaEngine) => viaEngine ?? checkCodexSignedInHeuristic()),
    ]);
    // `installed` means the engine is provisioned (downloaded) locally — the user has
    // clicked Enable in Settings → Code Mode. We no longer look for a global claude/codex
    // CLI on PATH; code mode runs our own pinned engine from ~/.rowboat/engines.
    return {
        claude: { installed: isEngineProvisioned('claude'), signedIn: claudeSignedIn },
        codex: { installed: isEngineProvisioned('codex'), signedIn: codexSignedIn },
    };
}
