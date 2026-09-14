import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectStore, relativeInside } from './store.js';
import type { SessionIndexEntry } from '@x/shared/dist/sessions.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rowboat-projects-'));
    roots.push(root);
    const folder = path.join(root, 'knowledge/Workspace/Alpha');
    await fs.mkdir(folder, { recursive: true });
    await fs.mkdir(path.join(root, 'config'));
    const entries: SessionIndexEntry[] = [];
    const sessions = {
        listSessions: () => entries,
        createSession: async () => {
            const id = `chat-${entries.length}`;
            entries.push({ sessionId: id, createdAt: '2026-09-10', updatedAt: '2026-09-10', turnCount: 0, latestTurnStatus: 'idle' } as SessionIndexEntry);
            return id;
        },
    };
    return { root, folder, sessions, store: new ProjectStore(root) };
}
describe('local project associations', () => {
    it('creates a chat with a persisted working directory and keeps membership after that directory changes', async () => {
        const { root, folder, sessions, store } = await fixture();
        const [project] = await store.list(sessions);
        const id = await store.createChat(sessions, project!.id);
        const sidecar = path.join(root, 'config', `workdir-${id}.json`);
        expect(JSON.parse(await fs.readFile(sidecar, 'utf8')).path).toBe(folder);
        await fs.writeFile(sidecar, JSON.stringify({ path: '/tmp/elsewhere' }));
        expect((await new ProjectStore(root).list(sessions))[0]!.chats.map((chat) => chat.id)).toEqual([id]);
    });
    it('imports nested working-directory chats and repairs them when the folder is renamed', async () => {
        const { root, folder, sessions, store } = await fixture();
        const id = await sessions.createSession();
        const sidecar = path.join(root, 'config', `workdir-${id}.json`);
        await fs.writeFile(sidecar, JSON.stringify({ path: path.join(folder, 'reports') }));
        const [before] = await store.list(sessions);
        expect(before!.chats.map((chat) => chat.id)).toEqual([id]);
        const renamed = path.join(root, 'knowledge/Workspace/Beta');
        await fs.rename(folder, renamed);
        const [after] = await new ProjectStore(root).list(sessions);
        expect(after!.id).toBe(before!.id);
        expect(after!.name).toBe('Beta');
        expect(after!.chats.map((chat) => chat.id)).toEqual([id]);
        expect(JSON.parse(await fs.readFile(sidecar, 'utf8')).path).toBe(path.join(renamed, 'reports'));
    });
    it('does not associate adjacent prefix folders or resurrect a deleted project', async () => {
        const { root, folder, sessions, store } = await fixture();
        const id = await sessions.createSession();
        await fs.writeFile(path.join(root, 'config', `workdir-${id}.json`), JSON.stringify({ path: `${folder}-other` }));
        const [project] = await store.list(sessions);
        expect(project!.chats).toEqual([]);
        await fs.rm(folder, { recursive: true });
        expect(await store.list(sessions)).toEqual([]);
        await expect(store.createChat(sessions, project!.id)).rejects.toThrow('no longer available');
    });
    it('serializes concurrent creation so no membership is lost', async () => {
        const { store, sessions } = await fixture();
        const [project] = await store.list(sessions);
        const ids = await Promise.all([store.createChat(sessions, project!.id), store.createChat(sessions, project!.id)]);
        expect((await store.list(sessions))[0]!.chats.map((chat) => chat.id).sort()).toEqual(ids.sort());
    });
    it('keeps code sessions out of Projects', async () => {
        const { root, folder, sessions, store } = await fixture();
        const id = await sessions.createSession();
        await fs.writeFile(path.join(root, 'config', `workdir-${id}.json`), JSON.stringify({ path: folder }));
        const metadata = path.join(root, 'code-mode', 'sessions-meta');
        await fs.mkdir(metadata, { recursive: true });
        await fs.writeFile(path.join(metadata, `${id}.json`), '{}');
        expect((await store.list(sessions))[0]!.chats).toEqual([]);
    });
    it('retains imported legacy chats after their work directory changes', async () => {
        const { root, folder, sessions } = await fixture();
        const chat = { id: 'legacy', title: 'Old report', modifiedAt: '2026-09-10' };
        const sidecar = path.join(root, 'config', 'workdir-legacy.json');
        await fs.writeFile(sidecar, JSON.stringify({ path: folder }));
        let inFolder = true;
        const store = new ProjectStore(root, async () => inFolder ? [chat] : [], async () => chat);
        expect((await store.list(sessions))[0]!.chats).toEqual([chat]);
        inFolder = false;
        await fs.writeFile(sidecar, JSON.stringify({ path: '/tmp/elsewhere' }));
        expect((await store.list(sessions))[0]!.chats).toEqual([chat]);
    });
    it('checks directory boundaries', () => {
        expect(relativeInside('/tmp/project', '/tmp/project/a')).toBe('a');
        expect(relativeInside('/tmp/project', '/tmp/project2/a')).toBeNull();
    });
});
