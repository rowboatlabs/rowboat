import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import type { GitRepoInfo, GitStatusFile, GitFileState } from '@x/shared/dist/code-sessions.js';

const execFileAsync = promisify(execFile);

// Plain shell-outs to the system git. isomorphic-git (already in core) doesn't
// support worktrees, and these calls are simple enough that wrapping the CLI is
// both lighter and more faithful to what the user's own git would do.

const MAX_BUFFER = 32 * 1024 * 1024;
// Diff/file payloads above this are not worth shipping to the renderer.
const MAX_TEXT_BYTES = 1024 * 1024;

async function git(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: MAX_BUFFER });
    return stdout;
}

let gitAvailable: Promise<boolean> | null = null;
export function isGitAvailable(): Promise<boolean> {
    if (!gitAvailable) {
        gitAvailable = execFileAsync('git', ['--version'], { timeout: 5000 })
            .then(() => true)
            .catch(() => false);
    }
    return gitAvailable;
}

export async function repoInfo(cwd: string): Promise<GitRepoInfo> {
    const none: GitRepoInfo = { isGitRepo: false, branch: null, hasCommits: false, dirtyCount: 0 };
    if (!await isGitAvailable()) return none;
    try {
        const inside = (await git(cwd, ['rev-parse', '--is-inside-work-tree'])).trim();
        if (inside !== 'true') return none;
    } catch {
        return none;
    }
    let branch: string | null = null;
    try {
        branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim() || null;
    } catch {
        // unborn branch (no commits) — symbolic-ref still knows the name
        try {
            const ref = (await git(cwd, ['symbolic-ref', 'HEAD'])).trim();
            branch = ref.replace(/^refs\/heads\//, '') || null;
        } catch {
            branch = null;
        }
    }
    let hasCommits = false;
    try {
        await git(cwd, ['rev-parse', '--verify', 'HEAD']);
        hasCommits = true;
    } catch {
        hasCommits = false;
    }
    let dirtyCount = 0;
    try {
        const out = await git(cwd, ['status', '--porcelain=v1', '-z']);
        dirtyCount = out.split('\0').filter((l) => l.trim() !== '').length;
    } catch {
        dirtyCount = 0;
    }
    return { isGitRepo: true, branch, hasCommits, dirtyCount };
}

// git status/diff report paths relative to the REPO ROOT, which is not the
// session cwd when the user opened a subdirectory of a repo as their project.
// Disk reads must resolve against the root, not cwd.
async function repoToplevel(cwd: string): Promise<string> {
    try {
        return (await git(cwd, ['rev-parse', '--show-toplevel'])).trim() || cwd;
    } catch {
        return cwd;
    }
}

function stateFromPorcelain(xy: string): GitFileState {
    if (xy === '??') return 'untracked';
    if (xy.includes('R')) return 'renamed';
    if (xy.includes('A')) return 'added';
    if (xy.includes('D')) return 'deleted';
    return 'modified';
}

// Working-tree changes vs HEAD with insertion/deletion counts, scoped to the
// session directory's subtree (`-- .`): a project opened inside a bigger repo
// only shows its own changes. Result paths are repo-root-relative (git's
// porcelain format). Untracked files get their line count from disk (capped)
// since numstat doesn't cover them.
export async function status(cwd: string): Promise<GitStatusFile[]> {
    const root = await repoToplevel(cwd);
    const out = await git(cwd, ['status', '--porcelain=v1', '-z', '--', '.']);
    const entries: Array<{ path: string; state: GitFileState }> = [];
    // -z format: "XY path\0" and for renames "XY newPath\0oldPath\0"
    const parts = out.split('\0');
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part || part.length < 4) continue;
        const xy = part.slice(0, 2);
        const filePath = part.slice(3);
        const state = stateFromPorcelain(xy);
        if (state === 'renamed') i++; // skip the old path that follows
        entries.push({ path: filePath, state });
    }

    const counts = new Map<string, { insertions: number | null; deletions: number | null }>();
    try {
        const numstat = await git(cwd, ['diff', 'HEAD', '--numstat', '-z', '--', '.']);
        // -z numstat rows: "ins\tdel\tpath\0" (renames: "ins\tdel\0old\0new\0")
        const rows = numstat.split('\0');
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row) continue;
            const m = row.match(/^(\d+|-)\t(\d+|-)\t?(.*)$/);
            if (!m) continue;
            const insertions = m[1] === '-' ? null : Number(m[1]);
            const deletions = m[2] === '-' ? null : Number(m[2]);
            let filePath = m[3];
            if (!filePath) {
                // rename form: old and new paths follow as separate tokens
                i += 2;
                filePath = rows[i] ?? '';
            }
            if (filePath) counts.set(filePath, { insertions, deletions });
        }
    } catch {
        // no HEAD yet (no commits) — leave counts empty
    }

    const result: GitStatusFile[] = [];
    for (const entry of entries) {
        let insertions: number | null = null;
        let deletions: number | null = null;
        const counted = counts.get(entry.path);
        if (counted) {
            insertions = counted.insertions;
            deletions = counted.deletions;
        } else if (entry.state === 'untracked') {
            try {
                const full = path.join(root, entry.path);
                const stat = await fs.stat(full);
                if (stat.isFile() && stat.size <= MAX_TEXT_BYTES) {
                    const content = await fs.readFile(full, 'utf8');
                    if (!content.includes('\0')) {
                        insertions = content.length === 0
                            ? 0
                            : content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
                        deletions = 0;
                    }
                }
            } catch {
                // unreadable — leave counts null
            }
        }
        result.push({ path: entry.path, state: entry.state, insertions, deletions });
    }
    return result;
}

// Everything this worktree's branch changed since it forked from `baseRef` —
// committed AND uncommitted. `status()` only sees the working tree (uncommitted),
// so it misses work an agent committed; this is what you want for a session
// summary. Counts come from numstat, states from name-status, merged by path.
export async function changedSinceBase(cwd: string, baseRef: string): Promise<GitStatusFile[]> {
    let forkPoint = baseRef;
    try {
        forkPoint = (await git(cwd, ['merge-base', baseRef, 'HEAD'])).trim() || baseRef;
    } catch {
        forkPoint = baseRef;
    }

    const stateByPath = new Map<string, GitFileState>();
    try {
        const ns = await git(cwd, ['diff', '--name-status', '-z', forkPoint]);
        const parts = ns.split('\0');
        for (let i = 0; i < parts.length; i++) {
            const code = parts[i];
            if (!code) continue;
            const letter = code[0];
            if (letter === 'R' || letter === 'C') {
                // rename/copy: "<code>\0<old>\0<new>"
                const newPath = parts[i + 2];
                i += 2;
                if (newPath) stateByPath.set(newPath, 'renamed');
            } else {
                const p = parts[i + 1];
                i += 1;
                if (p) stateByPath.set(p, letter === 'A' ? 'added' : letter === 'D' ? 'deleted' : 'modified');
            }
        }
    } catch {
        // bad ref / no commits — leave states empty
    }

    const result: GitStatusFile[] = [];
    try {
        const numstat = await git(cwd, ['diff', '--numstat', '-z', forkPoint]);
        const rows = numstat.split('\0');
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row) continue;
            const m = row.match(/^(\d+|-)\t(\d+|-)\t?(.*)$/);
            if (!m) continue;
            const insertions = m[1] === '-' ? null : Number(m[1]);
            const deletions = m[2] === '-' ? null : Number(m[2]);
            let filePath = m[3];
            if (!filePath) {
                // rename form: old and new paths follow as separate tokens
                i += 2;
                filePath = rows[i] ?? '';
            }
            if (!filePath) continue;
            result.push({ path: filePath, state: stateByPath.get(filePath) ?? 'modified', insertions, deletions });
        }
    } catch {
        // bad ref / no commits — nothing to report
    }
    return result;
}

export interface FileDiff {
    oldText: string;
    newText: string;
    isBinary: boolean;
    tooLarge: boolean;
}

export async function fileDiff(cwd: string, relPath: string): Promise<FileDiff> {
    // Paths from `status` are repo-root-relative; paths clicked in the chat
    // timeline are cwd-relative. Resolve whichever interpretation points at a
    // real file (deleted files fall back to the root interpretation, which is
    // also what `git show` uses).
    const root = await repoToplevel(cwd);
    let gitPath = relPath;
    let full = path.join(root, relPath);
    const existsAt = async (p: string) => fs.stat(p).then((s) => s.isFile()).catch(() => false);
    if (!await existsAt(full)) {
        const cwdFull = path.join(cwd, relPath);
        if (await existsAt(cwdFull)) {
            full = cwdFull;
            // Realpath both sides — git reports the real toplevel, while the
            // session cwd may reach it through a symlink (e.g. /tmp on macOS).
            const realFull = await fs.realpath(cwdFull).catch(() => cwdFull);
            gitPath = path.relative(root, realFull).split(path.sep).join('/');
        }
    }
    let oldText = '';
    try {
        oldText = await git(cwd, ['show', `HEAD:${gitPath}`]);
    } catch {
        // untracked / newly added / no commits — diff against empty
        oldText = '';
    }
    let newText = '';
    try {
        const stat = await fs.stat(full);
        if (stat.size > MAX_TEXT_BYTES) {
            return { oldText: '', newText: '', isBinary: false, tooLarge: true };
        }
        newText = await fs.readFile(full, 'utf8');
    } catch {
        // deleted from working tree
        newText = '';
    }
    if (oldText.length > MAX_TEXT_BYTES) {
        return { oldText: '', newText: '', isBinary: false, tooLarge: true };
    }
    if (oldText.includes('\0') || newText.includes('\0')) {
        return { oldText: '', newText: '', isBinary: true, tooLarge: false };
    }
    return { oldText, newText, isBinary: false, tooLarge: false };
}

export async function worktreeAdd(repoPath: string, worktreePath: string, branch: string): Promise<void> {
    await fs.mkdir(path.dirname(worktreePath), { recursive: true });
    await git(repoPath, ['worktree', 'add', '-b', branch, worktreePath, 'HEAD']);
}

export async function worktreeRemove(
    repoPath: string,
    worktreePath: string,
    opts: { force?: boolean; deleteBranch?: string } = {},
): Promise<void> {
    try {
        const args = ['worktree', 'remove'];
        if (opts.force) args.push('--force');
        args.push(worktreePath);
        await git(repoPath, args);
    } catch {
        // The worktree dir may have been deleted by hand — prune the registration.
        await git(repoPath, ['worktree', 'prune']).catch(() => {});
    }
    if (opts.deleteBranch) {
        await git(repoPath, ['branch', '-D', opts.deleteBranch]).catch(() => {});
    }
}

export interface MergeBackResult {
    ok: boolean;
    conflict?: boolean;
    message: string;
}

// Merge the session branch into whatever the original checkout currently has
// checked out. Refuses on a dirty checkout; aborts cleanly on conflicts.
export async function mergeBack(repoPath: string, branch: string): Promise<MergeBackResult> {
    const info = await repoInfo(repoPath);
    if (!info.isGitRepo) {
        return { ok: false, message: 'The project folder is not a git repository.' };
    }
    if (info.dirtyCount > 0) {
        return {
            ok: false,
            message: `The repository at ${repoPath} has ${info.dirtyCount} uncommitted change(s). Commit or stash them, then merge again — or merge manually with: git merge ${branch}`,
        };
    }
    try {
        await git(repoPath, ['merge', '--no-edit', branch]);
        return { ok: true, message: `Merged ${branch} into ${info.branch ?? 'the current branch'}.` };
    } catch (e) {
        await git(repoPath, ['merge', '--abort']).catch(() => {});
        const detail = e instanceof Error ? e.message : String(e);
        return {
            ok: false,
            conflict: true,
            message: `Merge of ${branch} hit conflicts and was aborted. Resolve manually with: git merge ${branch}\n\n${detail.slice(0, 600)}`,
        };
    }
}
