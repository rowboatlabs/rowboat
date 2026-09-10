import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { WorkDir } from '../../config/config.js';
import { codeWorkspaceKey, type CodeSession } from '@x/shared/dist/code-sessions.js';

function marker(session: CodeSession): string {
    const key = createHash('sha256').update(codeWorkspaceKey(session)).digest('hex');
    return path.join(WorkDir, 'code-mode', 'started-workspaces', key);
}

// Independent of chat metadata: deleting a started chat must never make its
// shared worktree eligible for a base change again.
export async function markWorkspaceStarted(session: CodeSession): Promise<void> {
    if (!session.worktree || session.worktree.removedAt) return;
    const file = marker(session);
    await fs.mkdir(path.dirname(file), { recursive: true });
    try { await fs.writeFile(file, '', { flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
}

export async function workspaceHasStarted(session: CodeSession): Promise<boolean> {
    try { await fs.access(marker(session)); return true; }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
}
