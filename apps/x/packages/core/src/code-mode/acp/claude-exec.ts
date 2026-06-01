import { execSync } from 'child_process';
import * as path from 'path';
import { existsSync, readFileSync } from 'fs';
import { commonInstallPaths } from '../status.js';

// Windows-only: Node refuses to spawn `.cmd` files without `shell: true` (EINVAL),
// and the Claude ACP adapter spawns its executable directly. So we pre-resolve
// claude's real `.exe` from the npm-shim layout. Also used by the legacy acpx path.
export function resolveClaudeExeOnWindows(): string | undefined {
    // Candidate dirs = everything on PATH, plus well-known npm/pnpm/volta global
    // bin dirs. Electron's runtime PATH can omit these even when the user's shell
    // includes them, which would otherwise leave us unable to find claude.exe and
    // force a fallback to claude.cmd (which Node refuses to spawn — EINVAL).
    const home = process.env.USERPROFILE ?? '';
    const appData = process.env.APPDATA || (home && path.join(home, 'AppData', 'Roaming'));
    const localAppData = process.env.LOCALAPPDATA || (home && path.join(home, 'AppData', 'Local'));
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const knownDirs = [
        appData && path.join(appData, 'npm'),
        localAppData && path.join(localAppData, 'npm'),
        appData && path.join(appData, 'pnpm'),
        localAppData && path.join(localAppData, 'pnpm'),
        home && path.join(home, '.volta', 'bin'),
        path.join(programFiles, 'nodejs'),
    ].filter(Boolean) as string[];

    const pathDirs = (process.env.PATH ?? '').split(';').map((d) => d.trim()).filter(Boolean);
    const seen = new Set<string>();
    const candidates = [...pathDirs, ...knownDirs].filter((d) => {
        const key = d.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    for (const dir of candidates) {
        // Direct npm-shim layout: <dir>\node_modules\@anthropic-ai\claude-code\bin\claude.exe
        const exeFromLayout = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
        if (existsSync(exeFromLayout)) return exeFromLayout;

        // Otherwise parse the claude.cmd shim for the real exe path.
        const cmdPath = path.join(dir, 'claude.cmd');
        if (!existsSync(cmdPath)) continue;
        try {
            const content = readFileSync(cmdPath, 'utf-8');
            const absMatch = content.match(/[A-Z]:[\\/][^\s"]*claude\.exe/i);
            if (absMatch && existsSync(absMatch[0])) return absMatch[0];
            const relMatch = content.match(/%~dp0[\\/]?([^\s"%]+claude\.exe)/i);
            if (relMatch) {
                const resolved = path.join(dir, relMatch[1]);
                if (existsSync(resolved)) return resolved;
            }
        } catch {
            // ignore shim parse failures
        }
    }
    return undefined;
}

// macOS/Linux: find the real `claude` binary. Unlike Windows this isn't a spawn
// requirement (no .cmd problem) — it's a PATH safety net. Electron apps launched
// from the GUI (Dock/Finder) often don't inherit the login shell's PATH, so the
// spawned adapter may fail to find `claude`. We resolve the path here so the adapter
// can be pointed straight at it.
function resolveClaudeBinaryUnix(): string | undefined {
    // Primary: a login shell sees the user's full PATH (~/.zprofile, nvm, homebrew, …).
    try {
        const out = execSync("/bin/sh -lc 'command -v claude'", { timeout: 5000, encoding: 'utf-8' }).trim();
        if (out && existsSync(out)) return out;
    } catch {
        // not found on the login-shell PATH
    }
    // Fallback: scan well-known install locations directly.
    for (const candidate of commonInstallPaths('claude')) {
        if (existsSync(candidate)) return candidate;
    }
    return undefined;
}

let cached: string | undefined;

// Cross-platform: the real `claude` executable to hand the ACP adapter via
// CLAUDE_CODE_EXECUTABLE (the adapter prefers this env var on every OS). Returns
// undefined if it can't be found — callers then fall back to the adapter's own lookup.
// Cached on first success so we don't re-probe the shell on every cold start.
export function resolveClaudeExecutable(): string | undefined {
    if (cached) return cached;
    const resolved = process.platform === 'win32' ? resolveClaudeExeOnWindows() : resolveClaudeBinaryUnix();
    if (resolved) cached = resolved;
    return resolved;
}
