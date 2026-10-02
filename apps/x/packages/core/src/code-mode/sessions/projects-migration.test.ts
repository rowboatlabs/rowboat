import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CodeSession } from '@x/shared/dist/code-sessions.js';
import { CodeSessionService } from './service.js';

const state = vi.hoisted(() => ({ root: '', legacy: [] as { id: string; path: string; chats: { id: string; title: string }[] }[] }));
vi.mock('../../config/config.js', () => ({ get WorkDir() { return state.root; } }));
vi.mock('../../projects/projects.js', () => ({ listProjects: async () => state.legacy }));
vi.mock('../../home/command-center.js', () => ({ getCommandCenterSessionId: async () => null }));
vi.mock('../git/service.js', () => ({ repoInfo: async () => ({ isGitRepo: false }) }));
beforeEach(async () => { state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'projects-migration-')); });
afterEach(async () => { await fs.rm(state.root, { recursive: true, force: true }); state.legacy = []; });

it('registers legacy folders without copying files and preserves chat identity, title, and nested cwd', async () => {
    const folder = path.join(state.root, 'knowledge', 'Workspace', 'Writing');
    const nested = path.join(folder, 'drafts');
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, 'draft.md'), 'Original draft');
    await fs.mkdir(path.join(state.root, 'config'));
    await fs.writeFile(path.join(state.root, 'config', 'workdir-chat1.json'), JSON.stringify({ path: nested }));
    state.legacy = [{ id: 'old-project', path: 'knowledge/Workspace/Writing', chats: [{ id: 'chat1', title: 'Draft review' }] }];
    const records = new Map<string, CodeSession>();
    const add = vi.fn(async () => ({ id: 'project1', path: folder, name: 'Writing' }));
    const createSession = vi.fn();
    const service = new CodeSessionService({
        sessions: { listSessions: () => [{ sessionId: 'chat1' }], createSession } as never,
        sessionRepo: {} as never, codeModeManager: {} as never,
        codeSessionsRepo: { get: async (id: string) => records.get(id) ?? null, save: async (meta: CodeSession) => { records.set(meta.id, meta); } } as never,
        codeProjectsRepo: { add, get: async () => ({ id: 'project1', path: folder, name: 'Writing' }) } as never,
        sessionBus: { subscribe: () => {}, publish: vi.fn() } as never,
    });
    await Promise.all([service.migrateLegacyProjects(), service.migrateLegacyProjects()]);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(folder);
    expect(createSession).not.toHaveBeenCalled();
    expect(records.get('chat1')).toMatchObject({ id: 'chat1', title: 'Draft review', cwd: nested, codeModeEnabled: false });
    expect(records.get('chat1')?.worktree).toBeUndefined();
    expect(await fs.readFile(path.join(nested, 'draft.md'), 'utf8')).toBe('Original draft');
    expect(JSON.parse(await fs.readFile(path.join(state.root, 'config', 'workdir-chat1.json'), 'utf8'))).toEqual({ path: nested });
});
