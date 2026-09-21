import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withFileLock } from '../../knowledge/file-lock.js';
import { CodeSessionService } from './service.js';
import { codeWorkspaceKey, type CodeSession } from '@x/shared/dist/code-sessions.js';

const mocks = vi.hoisted(() => ({
    excludeWorktrees: vi.fn(), worktreeAddUnborn: vi.fn(), worktreeAdd: vi.fn(), worktreeRemove: vi.fn(), repoInfo: vi.fn(), mergeBack: vi.fn(),
    disposeTerminal: vi.fn(), clearStoredSession: vi.fn(),
    workspaceHasStarted: vi.fn(), markWorkspaceStarted: vi.fn(), worktreeBaseChangeReason: vi.fn(), changeWorktreeBase: vi.fn(),
}));
vi.mock('../git/service.js', () => mocks);
vi.mock('./workspace-started.js', () => mocks);
vi.mock('../acp/session-store.js', () => ({ clearStoredSession: mocks.clearStoredSession }));
vi.mock('../../terminal/terminal.js', () => ({ disposeTerminal: mocks.disposeTerminal }));
vi.mock('fs/promises', () => ({ default: { access: vi.fn(), writeFile: vi.fn(), rm: vi.fn().mockResolvedValue(undefined) } }));

const initial: CodeSession = {
    id: 's1', projectId: 'p1', title: 'Original chat', agent: 'codex', cwd: '/tmp/wt',
    worktree: { path: '/tmp/wt', branch: 'rowboat/s1', baseBranch: 'main', baseCommit: 'original' }, createdAt: '2026-09-01T00:00:00.000Z',
};
function setup(members: CodeSession[] = [initial]) {
    const records = new Map(members.map((s) => [s.id, structuredClone(s)]));
    let next = Math.max(1, ...members.map((s) => Number(s.id.slice(1)) || 0)) + 1;
    const sessions = { createSession: vi.fn(async () => `s${next++}`), deleteSession: vi.fn().mockResolvedValue(undefined),
        getSession: vi.fn().mockResolvedValue({ turns: [] }), cancel: vi.fn().mockResolvedValue(undefined) };
    const service = new CodeSessionService({
        sessions: sessions as never, sessionRepo: { withLock: (id: string, fn: () => Promise<unknown>) => withFileLock(`test-session:${id}`, fn) } as never,
        codeModeManager: { dispose: vi.fn() } as never,
        codeSessionsRepo: { list: async () => [...records.values()], get: async (id) => records.get(id) ?? null,
            save: async (meta) => { records.set(meta.id, meta); }, remove: async (id) => { records.delete(id); } },
        codeProjectsRepo: { get: async (id: string) => ({ id, path: '/tmp/project', name: 'Project' }) } as never,
        sessionBus: { subscribe: () => () => {}, publish: vi.fn() } as never,
    });
    return { service, records, sessions };
}
beforeEach(() => { vi.clearAllMocks(); mocks.workspaceHasStarted.mockResolvedValue(false); mocks.worktreeBaseChangeReason.mockResolvedValue(null); mocks.changeWorktreeBase.mockResolvedValue('new-base'); mocks.worktreeAdd.mockResolvedValue('original'); mocks.repoInfo.mockResolvedValue({ isGitRepo: true, hasCommits: true, branch: 'main' }); });

describe('shared worktree sessions', () => {
    it('creates independent chats in an existing legacy worktree without creating another branch', async () => {
        const { service, records } = setup();
        const created = await service.create({ projectId: 'p1', agent: 'claude', isolation: 'worktree', workspaceSessionId: 's1' });
        expect(created.id).toBe('s2');
        expect(created.cwd).toBe(initial.cwd);
        expect(created.worktree).toEqual(initial.worktree);
        expect(created.agent).toBe('claude');
        expect(records.get('s1')?.title).toBe('Original chat');
        expect(mocks.worktreeAdd).not.toHaveBeenCalled();
    });
    it('keeps a shared worktree when deleting one session even with legacy removal flags', async () => {
        const { service, records } = setup([initial, { ...initial, id: 's2' }]);
        await service.delete('s1', { removeWorktree: true, deleteBranch: true });
        expect(mocks.worktreeRemove).not.toHaveBeenCalled();
        expect(records.has('s1')).toBe(false);
        expect(records.get('s2')?.cwd).toBe('/tmp/wt');
    });
    it('removes the worktree only with its final session', async () => {
        const { service } = setup();
        await service.delete('s1', { removeWorktree: true, deleteBranch: true });
        expect(mocks.worktreeRemove).toHaveBeenCalledWith('/tmp/project', '/tmp/wt', { force: true, deleteBranch: 'rowboat/s1' });
    });
    it('updates all members and stops every terminal on explicit cleanup', async () => {
        const { service, records } = setup([initial, { ...initial, id: 's2' }]);
        await service.cleanupWorktree('s1', false);
        for (const id of ['s1', 's2']) {
            expect(records.get(id)?.worktree?.removedAt).toBeTruthy();
            expect(records.get(id)?.cwd).toBe('/tmp/project');
            expect(mocks.disposeTerminal).toHaveBeenCalledWith(id);
        }
    });
    it('rejects removed or foreign workspaces and removes the failed empty chat', async () => {
        const { service, sessions } = setup([{ ...initial, worktree: { ...initial.worktree!, removedAt: '2026-09-02T00:00:00.000Z' } }]);
        await expect(service.create({ projectId: 'p1', agent: 'codex', isolation: 'worktree', workspaceSessionId: 's1' })).rejects.toThrow('removed');
        expect(sessions.deleteSession).toHaveBeenCalledWith('s2');
        await expect(service.create({ projectId: 'p2', agent: 'codex', isolation: 'worktree', workspaceSessionId: 's1' })).rejects.toThrow();
    });
    it('records the selected base and passes it to git', async () => {
        const { service } = setup();
        const created = await service.create({ projectId: 'p1', agent: 'codex', isolation: 'worktree', baseBranch: 'release' });
        expect(created.worktree?.baseBranch).toBe('release');
        expect(mocks.worktreeAdd.mock.calls[0][3]).toBe('release');
    });
    it('shares merge metadata across every session', async () => {
        mocks.mergeBack.mockResolvedValue({ ok: true, message: 'merged' });
        const { service, records } = setup([initial, { ...initial, id: 's2' }]);
        await service.mergeBack('s1');
        expect(records.get('s1')?.worktree?.mergedAt).toBeTruthy();
        expect(records.get('s2')?.worktree?.mergedAt).toBe(records.get('s1')?.worktree?.mergedAt);
    });
    it('changes the base across empty sibling sessions and preserves conversations', async () => {
        const { service, records, sessions } = setup([initial, { ...initial, id: 's2' }]);
        await service.changeBaseBranch('s1', 'release');
        expect(mocks.changeWorktreeBase).toHaveBeenCalledWith('/tmp/wt', 'rowboat/s1', 'original', 'release');
        for (const record of records.values()) {
            expect(record.worktree?.baseBranch).toBe('release');
            expect(record.worktree?.baseCommit).toBe('new-base');
            expect(record.title).toBe('Original chat');
        }
        expect(sessions.deleteSession).not.toHaveBeenCalled();
    });
    it('refuses after any sibling has started, even if its turn has finished', async () => {
        const { service, sessions } = setup([initial, { ...initial, id: 's2' }]);
        sessions.getSession.mockImplementation(async (id?: string) => ({ turns: id === 's2' ? [{}] : [] }) as never);
        await expect(service.changeBaseBranch('s1', 'release')).rejects.toThrow('after a session has started');
        expect(mocks.markWorkspaceStarted).toHaveBeenCalled();
        expect(mocks.changeWorktreeBase).not.toHaveBeenCalled();
    });
    it('keeps the base locked after the started chat has been deleted', async () => {
        mocks.workspaceHasStarted.mockResolvedValue(true);
        const { service } = setup();
        await expect(service.changeBaseBranch('s1', 'release')).rejects.toThrow('after a session has started');
        expect(mocks.changeWorktreeBase).not.toHaveBeenCalled();
    });
    it('checks history after acquiring session locks, preventing a first-message race', async () => {
        const { service, sessions } = setup();
        let release!: () => void;
        let entered!: () => void;
        const acquired = new Promise<void>((resolve) => { entered = resolve; });
        const sending = withFileLock('test-session:s1', async () => {
            entered();
            await new Promise<void>((resolve) => { release = resolve; });
            sessions.getSession.mockResolvedValue({ turns: [{}] } as never);
        });
        await acquired;
        const change = service.changeBaseBranch('s1', 'release');
        release();
        await sending;
        await expect(change).rejects.toThrow('after a session has started');
        expect(mocks.changeWorktreeBase).not.toHaveBeenCalled();
    });
    it('does not update metadata if Git refuses the change', async () => {
        mocks.changeWorktreeBase.mockRejectedValueOnce(new Error('File changes'));
        const { service, records } = setup();
        await expect(service.changeBaseBranch('s1', 'release')).rejects.toThrow('File changes');
        expect(records.get('s1')?.worktree?.baseBranch).toBe('main');
    });

});

describe('unified project directories', () => {
    it('creates a default git worktree underneath the opened project', async () => {
        const { service } = setup();
        const created = await service.create({ projectId: 'p1', agent: 'codex', isolation: 'worktree' });
        expect(created.codeModeEnabled).toBe(true);
        expect(created.cwd).toBe('/tmp/project/.rowboat/worktrees/s2');
        expect(mocks.excludeWorktrees).toHaveBeenCalledWith('/tmp/project');
        expect(mocks.worktreeAdd).toHaveBeenCalledWith('/tmp/project', created.cwd, 'rowboat/s2', 'main');
    });
    it('works directly in a non-git folder and keeps distinct threads with multiple sessions', async () => {
        mocks.repoInfo.mockResolvedValue({ isGitRepo: false, hasCommits: false });
        const { service } = setup([]);
        const first = await service.create({ projectId: 'p1', agent: 'claude', isolation: 'in-repo' });
        const second = await service.create({ projectId: 'p1', agent: 'claude', isolation: 'in-repo' });
        const child = await service.create({ projectId: 'p1', agent: 'codex', isolation: 'in-repo', workspaceSessionId: first.id });
        for (const session of [first, second, child]) {
            expect(session.cwd).toBe('/tmp/project');
            expect(session.worktree).toBeUndefined();
            expect(session.codeModeEnabled).toBe(false);
        }
        expect(codeWorkspaceKey(first)).not.toBe(codeWorkspaceKey(second));
        expect(codeWorkspaceKey(first)).toBe(codeWorkspaceKey(child));
        expect(mocks.worktreeAdd).not.toHaveBeenCalled();
        expect(mocks.excludeWorktrees).not.toHaveBeenCalled();
    });
    it('persists disabling coding without changing the shared workspace or other sessions', async () => {
        const { service, records } = setup([initial, { ...initial, id: 's2' }]);
        await service.update('s1', { policy: 'yolo' });
        const reset = await service.update('s1', { clearPolicy: true });
        expect(reset.policy).toBeUndefined();
        expect(reset).not.toHaveProperty('clearPolicy');
        const updated = await service.update('s1', { codeModeEnabled: false });
        expect(updated.cwd).toBe(initial.cwd);
        expect(updated.worktree).toEqual(initial.worktree);
        expect(records.get('s1')?.codeModeEnabled).toBe(false);
        expect(records.get('s2')?.codeModeEnabled).toBeUndefined();
        const child = await service.create({ projectId: 'p1', agent: 'claude', isolation: 'worktree', workspaceSessionId: 's1' });
        expect(child.codeModeEnabled).toBe(false);
        expect(child.cwd).toBe(initial.cwd);
    });
    it('creates an orphan worktree for an unborn git repository', async () => {
        mocks.repoInfo.mockResolvedValue({ isGitRepo: true, hasCommits: false, branch: 'main' });
        const { service } = setup();
        const session = await service.create({ projectId: 'p1', agent: 'codex', isolation: 'worktree' });
        expect(session.codeModeEnabled).toBe(true);
        expect(mocks.worktreeAddUnborn).toHaveBeenCalledWith('/tmp/project', session.cwd, 'rowboat/s2');
        expect(mocks.worktreeAdd).not.toHaveBeenCalled();
    });
});

it('keeps non-git folders in place even when a caller requests default worktree isolation', async () => {
    mocks.repoInfo.mockResolvedValue({ isGitRepo: false, hasCommits: false });
    const { service } = setup([]);
    const created = await service.create({ projectId: 'p1', agent: 'claude', isolation: 'worktree' });
    expect(created.cwd).toBe('/tmp/project');
    expect(created.worktree).toBeUndefined();
    expect(mocks.worktreeAdd).not.toHaveBeenCalled();
    expect(mocks.worktreeAddUnborn).not.toHaveBeenCalled();
});
