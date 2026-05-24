import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { CodeModeAgentStatus } from './types.js';

const execAsync = promisify(exec);

// Where claude.cmd / codex.cmd typically live when installed via npm/pnpm/yarn.
// We scan these directly because Electron's spawned shell sometimes doesn't
// inherit the user's full PATH (especially on macOS GUI launches, and even on
// Windows when global npm prefix isn't propagated to system PATH).
function commonInstallPaths(binary: string): string[] {
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

async function probeShell(binary: string): Promise<boolean> {
    try {
        if (process.platform === 'win32') {
            const { stdout } = await execAsync(`where ${binary}`, { timeout: 5000 });
            return stdout.trim().length > 0;
        }
        // Login shell so ~/.zprofile / ~/.bashrc PATH additions are visible —
        // essential for Homebrew, nvm, asdf, volta installs on macOS GUI launches.
        const { stdout } = await execAsync(`/bin/sh -lc 'command -v ${binary}'`, { timeout: 5000 });
        return stdout.trim().length > 0;
    } catch {
        return false;
    }
}

async function isInstalled(binary: string): Promise<boolean> {
    if (await probeShell(binary)) return true;
    // Fallback: scan well-known install locations directly.
    for (const candidate of commonInstallPaths(binary)) {
        if (existsSync(candidate)) return true;
    }
    return false;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
    try {
        const parts = token.split('.');
        if (parts.length < 2) return null;
        const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
        const json = Buffer.from(padded + pad, 'base64').toString('utf-8');
        const parsed = JSON.parse(json);
        return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
    } catch {
        return null;
    }
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

// Validates Claude Code auth. On macOS the credentials live in the login
// Keychain; on Linux/Windows in ~/.claude/.credentials.json (or ~/.config
// fallback). We check both so detection works across platforms.
async function checkClaudeSignedIn(): Promise<boolean> {
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

// Validates Codex auth at ~/.codex/auth.json on all platforms.
// Considered signed in if API key set, or a refresh_token / access_token
// exists. id_token expiry is intentionally NOT used as a rejection signal —
// id_tokens are short-lived (~1h) but refresh_tokens persist for weeks.
async function checkCodexSignedIn(): Promise<boolean> {
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
    const [claudeInstalled, codexInstalled, claudeSignedIn, codexSignedIn] = await Promise.all([
        isInstalled('claude'),
        isInstalled('codex'),
        checkClaudeSignedIn(),
        checkCodexSignedIn(),
    ]);
    return {
        claude: { installed: claudeInstalled, signedIn: claudeSignedIn },
        codex: { installed: codexInstalled, signedIn: codexSignedIn },
    };
}
