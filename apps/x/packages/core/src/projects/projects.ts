import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkDir } from '../config/config.js';
import { listRunsByWorkDir, fetchRun } from '../runtime/legacy/runs.js';
import type { ISessions } from '../runtime/sessions/index.js';
import { ProjectStore } from './store.js';

const store = new ProjectStore(WorkDir, async (dir) => (await listRunsByWorkDir(dir)).runs, async (id) => {
    try {
        const stat = await fs.stat(path.join(WorkDir, 'runs', `${id}.jsonl`));
        const run = await fetchRun(id);
        return { id, title: run.title, modifiedAt: stat.mtime.toISOString() };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
});
export const listProjects = (sessions: ISessions) => store.list(sessions);
export const createProjectChat = (sessions: ISessions, projectId: string) => store.createChat(sessions, projectId);
