import fs from 'fs/promises';
import path from 'path';
import { WorkDir } from '../../config/config.js';
import type { CodingAgent } from './types.js';

// One ACP session is pinned per chat run. We persist its sessionId (plus the agent
// and cwd it belongs to) so reopening the chat after an app restart can resume the
// same agent context via session/load instead of starting over.
export interface StoredSession {
    runId: string;
    agent: CodingAgent;
    cwd: string;
    sessionId: string;
}

// Per-run ACP session state lives in its own directory (not WorkDir/config): it's
// runtime state that accumulates one file per chat run, so it's kept separate from
// user/app config to be listed and cleaned up on its own.
const SESSIONS_DIR = path.join(WorkDir, 'code-mode', 'sessions');

function sessionFile(runId: string): string {
    return path.join(SESSIONS_DIR, `${runId}.json`);
}

export async function readStoredSession(runId: string): Promise<StoredSession | null> {
    try {
        const raw = await fs.readFile(sessionFile(runId), 'utf8');
        const parsed = JSON.parse(raw) as StoredSession;
        if (parsed && parsed.sessionId && parsed.agent && parsed.cwd) return parsed;
        return null;
    } catch {
        return null;
    }
}

export async function writeStoredSession(session: StoredSession): Promise<void> {
    const file = sessionFile(session.runId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(session, null, 2));
}

export async function clearStoredSession(runId: string): Promise<void> {
    try {
        await fs.rm(sessionFile(runId), { force: true });
    } catch {
        // best effort
    }
}
