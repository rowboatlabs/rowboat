import { execSync } from 'child_process';
import * as path from 'path';
import { existsSync } from 'fs';
import { commonInstallPaths } from '../status.js';

let cached: string | undefined;

// Resolve the user's local `codex` launcher to hand the codex-acp adapter via
// CODEX_PATH. We deliberately do NOT bundle Codex's ~230 MB native engine — the
// adapter only falls back to a bundled `@openai/codex` when CODEX_PATH is unset, so
// pointing it at the local install keeps packaged builds small.
//
// Unlike claude (which the adapter spawns directly, hitting the Windows .cmd EINVAL
// trap), codex-acp spawns this with `shell: true` on Windows and via PATH on unix — so
// a `.cmd` shim is fine and we don't need to dig out a raw `.exe`. We still resolve an
// explicit path because Electron's runtime PATH can omit npm/pnpm global bin dirs even
// when the user's shell has them. Returns undefined if codex can't be found — callers
// then surface a clear "Codex CLI not found" error.
export function resolveCodexExecutable(): string | undefined {
    if (cached) return cached;
    const resolved = process.platform === 'win32' ? resolveCodexOnWindows() : resolveCodexOnUnix();
    if (resolved) cached = resolved;
    return resolved;
}

// Windows: scan PATH (for codex.cmd/.exe) plus well-known npm/pnpm global bin dirs that
// Electron's runtime PATH can omit. No login-shell trick here; codex-acp spawns with
// shell:true so a `.cmd` shim is fine.
function resolveCodexOnWindows(): string | undefined {
    const exts = ['.cmd', '.exe', ''];
    const pathDirs = (process.env.PATH ?? '')
        .split(path.delimiter)
        .map((d) => d.trim())
        .filter(Boolean);
    const fromPath = pathDirs.flatMap((dir) => exts.map((ext) => path.join(dir, `codex${ext}`)));
    for (const candidate of [...fromPath, ...commonInstallPaths('codex')]) {
        if (existsSync(candidate)) return candidate;
    }
    return undefined;
}

// macOS/Linux: GUI-launched Electron apps (Dock/Finder) often don't inherit the login
// shell's PATH, so a node-version-manager install (nvm/fnm/asdf) won't be on
// process.env.PATH. Ask a login shell first — it sees the user's full PATH — then fall
// back to scanning the runtime PATH and well-known install dirs. Mirrors
// resolveClaudeBinaryUnix in claude-exec.ts.
function resolveCodexOnUnix(): string | undefined {
    // Primary: a login shell sees the user's full PATH (~/.zprofile, nvm, homebrew, …).
    try {
        const out = execSync("/bin/sh -lc 'command -v codex'", { timeout: 5000, encoding: 'utf-8' }).trim();
        if (out && existsSync(out)) return out;
    } catch {
        // not found on the login-shell PATH
    }
    // Fallback: scan the runtime PATH and well-known install locations directly.
    const pathDirs = (process.env.PATH ?? '')
        .split(path.delimiter)
        .map((d) => d.trim())
        .filter(Boolean);
    const fromPath = pathDirs.map((dir) => path.join(dir, 'codex'));
    for (const candidate of [...fromPath, ...commonInstallPaths('codex')]) {
        if (existsSync(candidate)) return candidate;
    }
    return undefined;
}
