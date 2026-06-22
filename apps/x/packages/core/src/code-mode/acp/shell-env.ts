import { execSync } from 'child_process';
import * as path from 'path';

let cached: string | null = null;

// The user's login-shell PATH (macOS/Linux; undefined on Windows or probe failure).
// GUI-launched Electron apps inherit launchd's stripped PATH (/usr/bin:/bin:...), so
// anything the engines spawn off process.env.PATH misses Homebrew/nvm/npm-global tools.
// The provisioned engine itself runs from an absolute path, but claude/codex spawn
// git, gh, rg, bash, etc. themselves — without this they fail with "command not found"
// on a Finder launch even though they work from a terminal.
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
