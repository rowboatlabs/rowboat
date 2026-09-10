import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SessionIndexEntry } from '@x/shared/dist/sessions.js';

export interface ProjectChat { id: string; title?: string; modifiedAt: string }
export interface Project { id: string; name: string; path: string; chats: ProjectChat[] }
interface RecordEntry { id: string; path: string; identity: string }
interface Registry { projects: RecordEntry[]; chats: Record<string, string> }
interface Sessions {
    listSessions(): SessionIndexEntry[];
    createSession(input: { title?: string }): Promise<string>;
}

export function relativeInside(parent: string, child: string): string | null {
    const rel = path.relative(parent, child);
    return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) ? null : rel;
}

/** Associations are local metadata. The folder's filesystem identity survives a
 * rename, while session membership survives later working-directory changes. */
export class ProjectStore {
    private pending: Promise<unknown> = Promise.resolve();
    constructor(private root: string, private legacyChats: (dir: string) => Promise<ProjectChat[]> = async () => [], private legacyChat: (id: string) => Promise<ProjectChat | null> = async () => null) {}
    private exclusive<T>(fn: () => Promise<T>): Promise<T> {
        const next = this.pending.then(fn);
        this.pending = next.catch(() => {});
        return next;
    }
    private get registryPath() { return path.join(this.root, 'config', 'projects.json'); }
    private async readRegistry(): Promise<Registry> {
        try {
            return JSON.parse(await fs.readFile(this.registryPath, 'utf8')) as Registry;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { projects: [], chats: {} };
            throw error;
        }
    }
    private async save(registry: Registry) {
        await fs.mkdir(path.dirname(this.registryPath), { recursive: true });
        const temp = `${this.registryPath}.${randomUUID()}.tmp`;
        await fs.writeFile(temp, JSON.stringify(registry, null, 2));
        await fs.rename(temp, this.registryPath);
    }
    private async workDir(id: string): Promise<string | null> {
        try {
            const data = JSON.parse(await fs.readFile(path.join(this.root, 'config', `workdir-${id}.json`), 'utf8'));
            return typeof data.path === 'string' ? data.path : null;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw error;
        }
    }
    private async discover(registry: Registry): Promise<RecordEntry[]> {
        const base = path.join(this.root, 'knowledge', 'Workspace');
        await fs.mkdir(base, { recursive: true });
        const live: RecordEntry[] = [];
        for (const entry of await fs.readdir(base, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const absolute = path.join(base, entry.name);
            const stat = await fs.stat(absolute);
            const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
            const rel = `knowledge/Workspace/${entry.name}`;
            let record = registry.projects.find((p) => p.identity === identity);
            if (!record) {
                record = { id: randomUUID(), path: rel, identity };
                registry.projects.push(record);
            } else if (record.path !== rel) {
                // Repair working directories too, including nested directories
                // and sessions not yet visited in the Projects UI.
                const oldRoot = path.join(this.root, record.path);
                const config = path.join(this.root, 'config');
                let files: string[] = [];
                try { files = await fs.readdir(config); } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                }
                for (const file of files.filter((f) => /^workdir-.+\.json$/.test(f))) {
                    const configPath = path.join(config, file);
                    const data = JSON.parse(await fs.readFile(configPath, 'utf8'));
                    const suffix = typeof data.path === 'string' ? relativeInside(oldRoot, data.path) : null;
                    if (suffix !== null) await fs.writeFile(configPath, JSON.stringify({ ...data, path: path.join(absolute, suffix) }, null, 2));
                }
                record.path = rel;
            }
            live.push(record);
        }
        return live.sort((a, b) => a.path.localeCompare(b.path));
    }
    list(sessions: Sessions): Promise<Project[]> {
        return this.exclusive(async () => {
            const registry = await this.readRegistry();
            const before = JSON.stringify(registry);
            const live = await this.discover(registry);
            const projects: Project[] = live.map((p) => ({ id: p.id, name: path.basename(p.path), path: p.path, chats: [] }));
            const add = async (chat: ProjectChat) => {
                let projectId = registry.chats[chat.id];
                if (!projectId) {
                    const dir = await this.workDir(chat.id);
                    const project = dir ? projects.find((p) => relativeInside(path.join(this.root, p.path), dir) !== null) : undefined;
                    if (project) registry.chats[chat.id] = projectId = project.id;
                }
                const project = projects.find((p) => p.id === projectId);
                if (project && !project.chats.some((c) => c.id === chat.id)) project.chats.push(chat);
            };
            let codeIds = new Set<string>();
            try { codeIds = new Set((await fs.readdir(path.join(this.root, 'code-mode', 'sessions-meta'))).map((name) => name.replace(/\.json$/, ''))); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
            for (const session of sessions.listSessions()) {
                if (codeIds.has(session.sessionId)) continue;
                if (session.origin || (session.lastAgentId && !['copilot', 'rowboatx'].includes(session.lastAgentId))) continue;
                await add({ id: session.sessionId, title: session.title, modifiedAt: session.updatedAt });
            }
            const knownSessions = new Set(sessions.listSessions().map((session) => session.sessionId));
            for (const project of projects) {
                for (const chat of await this.legacyChats(path.join(this.root, project.path))) await add(chat);
                for (const [id, projectId] of Object.entries(registry.chats)) {
                    if (projectId !== project.id || knownSessions.has(id) || codeIds.has(id) || project.chats.some((chat) => chat.id === id)) continue;
                    const chat = await this.legacyChat(id);
                    if (chat) project.chats.push(chat);
                }
                project.chats.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
            }
            if (before !== JSON.stringify(registry)) await this.save(registry);
            return projects;
        });
    }
    createChat(sessions: Sessions, projectId: string): Promise<string> {
        return this.exclusive(async () => {
            const registry = await this.readRegistry();
            const project = (await this.discover(registry)).find((p) => p.id === projectId);
            if (!project) throw new Error('Project folder is no longer available');
            const id = await sessions.createSession({});
            await fs.mkdir(path.join(this.root, 'config'), { recursive: true });
            await fs.writeFile(path.join(this.root, 'config', `workdir-${id}.json`), JSON.stringify({ path: path.join(this.root, project.path) }, null, 2));
            registry.chats[id] = projectId;
            await this.save(registry);
            return id;
        });
    }
}
