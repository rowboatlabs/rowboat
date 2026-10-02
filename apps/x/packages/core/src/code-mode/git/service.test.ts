import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { excludeWorktrees, worktreeAddUnborn, listBranches, switchBranch, worktreeAdd, worktreeRemove, changeWorktreeBase, worktreeBaseChangeReason } from './service.js';

const exec = promisify(execFile);
let root: string;
let repo: string;
const git = async (...args: string[]) => (await exec('git', args, { cwd: repo })).stdout.trim();
beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'code-branches-'));
    repo = path.join(root, 'repo');
    await fs.mkdir(repo);
    await git('init', '-b', 'main');
    await git('config', 'user.name', 'Test');
    await git('config', 'user.email', 'test@example.com');
    await fs.writeFile(path.join(repo, 'file.txt'), 'main\n');
    await git('add', '.');
    await git('commit', '-m', 'initial');
    await git('checkout', '-b', 'feature/search');
    await fs.writeFile(path.join(repo, 'file.txt'), 'feature\n');
    await git('commit', '-am', 'feature');
    await git('checkout', 'main');
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('project branches and worktree bases', () => {
    it('lists and switches local branches', async () => {
        expect(await listBranches(repo)).toEqual({ branches: ['feature/search', 'main'], currentBranch: 'main' });
        expect((await switchBranch(repo, 'feature/search')).branch).toBe('feature/search');
    });
    it('orders branches by most recent commit, ahead of alphabetical order', async () => {
        await git('checkout', '-b', 'zzz-recent');
        await exec('git', ['commit', '--allow-empty', '-m', 'recent'], {
            cwd: repo,
            env: { ...process.env, GIT_COMMITTER_DATE: '2030-01-01T00:00:00Z', GIT_AUTHOR_DATE: '2030-01-01T00:00:00Z' },
        });
        expect((await listBranches(repo)).branches).toEqual(['zzz-recent', 'feature/search', 'main']);
    });
    it('creates from the explicit base without switching the parent', async () => {
        const wt = path.join(root, 'worktree');
        await worktreeAdd(repo, wt, 'rowboat/test', 'feature/search');
        expect(await fs.readFile(path.join(wt, 'file.txt'), 'utf8')).toBe('feature\n');
        expect(await git('branch', '--show-current')).toBe('main');
    });
    it('defaults to the parent checkout when no base is supplied', async () => {
        await switchBranch(repo, 'feature/search');
        const wt = path.join(root, 'worktree');
        await worktreeAdd(repo, wt, 'rowboat/test');
        expect(await fs.readFile(path.join(wt, 'file.txt'), 'utf8')).toBe('feature\n');
    });
    it('preserves conflicting uncommitted changes on checkout failure', async () => {
        await fs.writeFile(path.join(repo, 'file.txt'), 'local edits\n');
        await expect(switchBranch(repo, 'feature/search')).rejects.toThrow();
        expect(await git('branch', '--show-current')).toBe('main');
        expect(await fs.readFile(path.join(repo, 'file.txt'), 'utf8')).toBe('local edits\n');
    });
    it('rejects a branch already checked out elsewhere and invalid bases', async () => {
        await git('worktree', 'add', path.join(root, 'other'), 'feature/search');
        await expect(switchBranch(repo, 'feature/search')).rejects.toThrow();
        await expect(worktreeAdd(repo, path.join(root, 'bad'), 'rowboat/bad', '--orphan')).rejects.toThrow();
        expect(await git('branch', '--list', 'rowboat/bad')).toBe('');
    });
    it('reports a locked-worktree removal failure without deleting its branch', async () => {
        const wt = path.join(root, 'locked');
        await worktreeAdd(repo, wt, 'rowboat/locked');
        await git('worktree', 'lock', wt);
        await expect(worktreeRemove(repo, wt, { force: true, deleteBranch: 'rowboat/locked' })).rejects.toThrow();
        expect(await git('branch', '--list', 'rowboat/locked')).toContain('rowboat/locked');
        expect(await fs.readFile(path.join(wt, 'file.txt'), 'utf8')).toBe('main\n');
    });

    it('switches an untouched worktree base while keeping its branch and parent checkout', async () => {
        const wt = path.join(root, 'switch-base');
        const original = await worktreeAdd(repo, wt, 'rowboat/fresh');
        const next = await changeWorktreeBase(wt, 'rowboat/fresh', original, 'feature/search');
        expect(await fs.readFile(path.join(wt, 'file.txt'), 'utf8')).toBe('feature\n');
        expect((await listBranches(wt)).currentBranch).toBe('rowboat/fresh');
        expect((await listBranches(repo)).currentBranch).toBe('main');
        expect(await worktreeBaseChangeReason(wt, 'rowboat/fresh', next)).toBeNull();
    });
    it.each(['tracked', 'untracked', 'ignored', 'commit'])('protects external %s changes', async (kind) => {
        const wt = path.join(root, 'protect');
        const original = await worktreeAdd(repo, wt, 'rowboat/fresh');
        if (kind === 'tracked') await fs.writeFile(path.join(wt, 'file.txt'), 'manual edit');
        if (kind === 'untracked') await fs.writeFile(path.join(wt, 'new.txt'), 'manual edit');
        if (kind === 'ignored') {
            await fs.appendFile(path.join(repo, '.git', 'info', 'exclude'), '\nignored.txt\n');
            await fs.writeFile(path.join(wt, 'ignored.txt'), 'manual edit');
        }
        if (kind === 'commit') await exec('git', ['commit', '--allow-empty', '-m', 'manual'], { cwd: wt });
        const before = (await exec('git', ['rev-parse', 'HEAD'], { cwd: wt })).stdout;
        await expect(changeWorktreeBase(wt, 'rowboat/fresh', original, 'feature/search')).rejects.toThrow();
        expect((await exec('git', ['rev-parse', 'HEAD'], { cwd: wt })).stdout).toBe(before);
    });
    it('refuses legacy worktrees without a recorded starting commit', async () => {
        expect(await worktreeBaseChangeReason(repo, 'main')).toContain('no recorded starting commit');
    });

});

describe('worktrees inside projects', () => {
    it('excludes nested worktrees locally without touching tracked ignore rules', async () => {
        await excludeWorktrees(repo);
        await excludeWorktrees(repo);
        const wt = path.join(repo, '.rowboat', 'worktrees', 'session');
        await worktreeAdd(repo, wt, 'rowboat/nested');
        expect(await git('status', '--porcelain')).toBe('');
        expect(await fs.readFile(path.join(wt, 'file.txt'), 'utf8')).toBe('main\n');
        const exclude = await fs.readFile(path.join(repo, '.git', 'info', 'exclude'), 'utf8');
        expect(exclude.split('/.rowboat/worktrees/')).toHaveLength(2);
        await expect(fs.access(path.join(repo, '.gitignore'))).rejects.toThrow();
    });
    it('creates a worktree for a repository without commits without creating a parent commit', async () => {
        const empty = path.join(root, 'empty');
        await fs.mkdir(empty);
        await exec('git', ['init', '-b', 'main'], { cwd: empty });
        await fs.writeFile(path.join(empty, 'untracked.txt'), 'keep me');
        const wt = path.join(empty, '.rowboat', 'worktrees', 'first');
        await excludeWorktrees(empty);
        await worktreeAddUnborn(empty, wt, 'rowboat/first');
        expect((await exec('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: wt })).stdout.trim()).toBe('rowboat/first');
        await expect(exec('git', ['rev-parse', '--verify', 'HEAD'], { cwd: empty })).rejects.toThrow();
        expect(await fs.readFile(path.join(empty, 'untracked.txt'), 'utf8')).toBe('keep me');
    });
});
