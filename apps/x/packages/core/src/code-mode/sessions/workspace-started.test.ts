import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import type { CodeSession } from '@x/shared/dist/code-sessions.js';
const { workDir } = vi.hoisted(() => ({ workDir: `/tmp/code-workspace-started-test-${process.pid}` }));
vi.mock('../../config/config.js', () => ({ WorkDir: workDir }));
import { markWorkspaceStarted, workspaceHasStarted } from './workspace-started.js';
afterEach(async () => { await fs.rm(workDir, { recursive: true, force: true }); });
it('persists workspace start independently of any individual session', async () => {
    const session: CodeSession = { id: 'first', projectId: 'p', agent: 'codex', cwd: '/wt', title: 'First',
        createdAt: '2026-09-01T00:00:00Z', worktree: { path: '/wt', branch: 'rowboat/test', baseBranch: 'main' } };
    expect(await workspaceHasStarted(session)).toBe(false);
    await markWorkspaceStarted(session);
    await markWorkspaceStarted(session);
    expect(await workspaceHasStarted({ ...session, id: 'remaining-empty-session' })).toBe(true);
    expect(await workspaceHasStarted({ ...session, worktree: { ...session.worktree!, path: '/other' } })).toBe(false);
});
