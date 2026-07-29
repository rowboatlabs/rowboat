import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';
import { withFileLock } from '../knowledge/file-lock.js';
import { normalizeKey } from './fileops.js';

// ---------------------------------------------------------------------------
// Item → session index (todo/sessions.json). Each delegated item's thread IS
// a session in the run system — this file only remembers which one. Losing
// it loses the link (the next run starts a fresh session), never list state:
// todo.md stays the single source of truth for the list itself.
// ---------------------------------------------------------------------------

const INDEX_PATH = path.join(WorkDir, 'todo', 'sessions.json');

async function readIndex(): Promise<Record<string, string>> {
    try {
        const raw = await fs.readFile(INDEX_PATH, 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return Object.fromEntries(
                Object.entries(parsed as Record<string, unknown>).filter(
                    (e): e is [string, string] => typeof e[1] === 'string',
                ),
            );
        }
    } catch {
        // missing or corrupt — start fresh
    }
    return {};
}

export async function getSessionIndex(): Promise<Record<string, string>> {
    return readIndex();
}

export async function getSessionId(key: string): Promise<string | null> {
    const index = await readIndex();
    return index[normalizeKey(key)] ?? null;
}

export async function setSessionId(key: string, sessionId: string): Promise<void> {
    await withFileLock(INDEX_PATH, async () => {
        const index = await readIndex();
        index[normalizeKey(key)] = sessionId;
        const dir = path.dirname(INDEX_PATH);
        if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
        await fs.writeFile(INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8');
    });
}
