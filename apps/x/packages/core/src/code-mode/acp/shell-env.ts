import { execSync } from 'child_process';
import * as path from 'path';

let cached: string | null = null;

// The user's login-shell PATH (macOS/Linux; undefined on Windows or probe failure).
// GUI-launched Electron apps inherit launchd's stripped PATH (/usr/bin:/bin:...), so
// anything resolved or spawned off process.env.PATH misses nvm/homebrew/npm-global
// installs. claude-exec/codex-exec already login-shell-probe for their one binary;
// this recovers the WHOLE PATH for transitive spawns the probes can't cover — an
// npm-installed claude is a `#!/usr/bin/env node` script (node must be on the
// spawner's PATH), and the engines spawn git/rg/bash themselves.
export function loginShellPath(): string | undefined {
    if (process.platform === 'win32') return undefined;
    if (cached !== null) return cached || undefined;

    // Prefer the user's own shell when it's POSIX-flavored, so its login profile
    // (~/.zprofile for zsh — macOS default — ~/.profile for bash/sh) is the one that
    // builds the PATH. fish et al. are skipped: their `echo $PATH` is space-joined.
    const userShell = process.env.SHELL;
    const shellOk = userShell && ['sh', 'bash', 'zsh', 'dash', 'ksh'].includes(path.basename(userShell));
    const shells = [...new Set([...(shellOk ? [userShell] : []), '/bin/sh'])];

    for (const shell of shells) {
        try {
            const out = execSync(`${shell} -lc 'echo $PATH'`, { timeout: 5000, encoding: 'utf-8' });
            // Profile scripts may echo their own lines; our `echo $PATH` runs last,
            // so take the last non-empty line and sanity-check it looks like a PATH.
            const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
            const last = lines[lines.length - 1];
            if (last && last.includes('/')) {
                cached = last;
                return last;
            }
        } catch {
            // probe failed — try the next shell
        }
    }
    cached = ''; // remember the failure so we don't re-pay the probe every spawn
    return undefined;
}
