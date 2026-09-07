import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeSessionService } from './service.js';
import type { CodeSession } from '@x/shared/dist/code-sessions.js';

// Done means nothing keeps running on the session's behalf: both paths that
// file a session under Done (explicit setDone, merge-back auto-done) must
// kill its terminal PTY, and neither reopen nor a failed merge may touch it.

const { disposeTerminal } = vi.hoisted(() => ({ disposeTerminal: vi.fn() }));
vi.mock('../../terminal/terminal.js', () => ({ disposeTerminal }));

const { mergeBack } = vi.hoisted(() => ({ mergeBack: vi.fn() }));
vi.mock('../git/service.js', () => ({ mergeBack }));

function makeService(session: Partial<CodeSession> = {}) {
    const meta = {
        id: 's1',
        projectId: 'p1',
        title: 'test session',
        agent: 'claude',
        cwd: '/tmp/p1',
        createdAt: '2026-09-01T00:00:00.000Z',
        ...session,
    } as CodeSession;
    const saved: CodeSession[] = [];
    const codeSessionsRepo = {
        get: async () => meta,
        save: async (next: CodeSession) => { saved.push(next); },
        list: async () => [meta],
        remove: async () => {},
    };
    const codeProjectsRepo = {
        get: async () => ({ id: 'p1', path: '/tmp/p1', name: 'p1' }),
        list: async () => [],
    };
    const sessionBus = {
        publish() {},
        subscribe() {
            return () => {};
        },
    };
    const service = new CodeSessionService({
        // Narrow structural stubs; these tests only exercise meta paths.
        sessions: {} as never,
        sessionRepo: {} as never,
        codeModeManager: { dispose() {} } as never,
        codeSessionsRepo: codeSessionsRepo as never,
        codeProjectsRepo: codeProjectsRepo as never,
        sessionBus: sessionBus as never,
    });
    return { service, saved };
}

describe('CodeSessionService done kills the terminal', () => {
    beforeEach(() => {
        disposeTerminal.mockClear();
        mergeBack.mockClear();
    });

    it('setDone(true) saves the flag and kills the session PTY', async () => {
        const { service, saved } = makeService();
        const updated = await service.setDone('s1', true);
        expect(updated.doneAt).toBeTruthy();
        expect(saved).toHaveLength(1);
        expect(disposeTerminal).toHaveBeenCalledWith('s1');
    });

    it('reopen (setDone false) leaves the terminal alone', async () => {
        const { service } = makeService({ doneAt: '2026-09-01T01:00:00.000Z' });
        const updated = await service.setDone('s1', false);
        expect(updated.doneAt).toBeUndefined();
        expect(disposeTerminal).not.toHaveBeenCalled();
    });

    it('merge-back auto-done kills the PTY too', async () => {
        mergeBack.mockResolvedValue({ ok: true, message: 'merged' });
        const { service } = makeService({
            worktree: { path: '/tmp/wt', branch: 'rowboat/s1', baseBranch: 'main' },
        });
        const result = await service.mergeBack('s1');
        expect(result.ok).toBe(true);
        expect(disposeTerminal).toHaveBeenCalledWith('s1');
    });

    it('a failed merge-back keeps the terminal running', async () => {
        mergeBack.mockResolvedValue({ ok: false, message: 'conflict' });
        const { service } = makeService({
            worktree: { path: '/tmp/wt', branch: 'rowboat/s1', baseBranch: 'main' },
        });
        const result = await service.mergeBack('s1');
        expect(result.ok).toBe(false);
        expect(disposeTerminal).not.toHaveBeenCalled();
    });
});
