import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkDir } from '../config/config.js';
import { listRuns, listRunsByWorkDir, fetchRun } from '../runtime/legacy/runs.js';
import type { ISessions } from '../runtime/sessions/index.js';
import { ProjectStore, type ProjectChat } from './store.js';

const store = new ProjectStore(WorkDir, async (dir) => (await listRunsByWorkDir(dir)).runs, async (id) => {
    try {
        const stat = await fs.stat(path.join(WorkDir, 'runs', `${id}.jsonl`));
        const run = await fetchRun(id);
        return { id, title: run.title, modifiedAt: stat.mtime.toISOString() };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
}, async () => {
    const chats: ProjectChat[] = [];
    let cursor: string | undefined;
    do {
        const page = await listRuns(cursor);
        chats.push(...page.runs.filter((run) => !run.useCase && ['copilot', 'rowboatx'].includes(run.agentId)));
        cursor = page.nextCursor;
    } while (cursor);
    return chats;
});
export const listProjects = (sessions: ISessions) => store.list(sessions);
export const createProjectChat = (sessions: ISessions, projectId: string) => store.createChat(sessions, projectId);
