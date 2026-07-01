import fs from 'fs/promises';
import path from 'path';
import { WorkDir } from '../../config/config.js';
import { CodeSession } from '@x/shared/dist/code-sessions.js';

// Mutable metadata for Code-section sessions, one JSON file per session
// (keyed by the session/run id). The immutable conversation itself lives in
// the run JSONL; the ACP resume state lives in code-mode/sessions/.
const META_DIR = path.join(WorkDir, 'code-mode', 'sessions-meta');

function metaFile(sessionId: string): string {
    return path.join(META_DIR, `${sessionId}.json`);
}

export interface ICodeSessionsRepo {
    list(): Promise<CodeSession[]>;
    get(sessionId: string): Promise<CodeSession | null>;
    save(session: CodeSession): Promise<void>;
    remove(sessionId: string): Promise<void>;
}

export class FSCodeSessionsRepo implements ICodeSessionsRepo {
    async list(): Promise<CodeSession[]> {
        let names: string[] = [];
        try {
            names = (await fs.readdir(META_DIR)).filter((n) => n.endsWith('.json'));
        } catch {
            return [];
        }
        const sessions: CodeSession[] = [];
        for (const name of names) {
            try {
                const raw = await fs.readFile(path.join(META_DIR, name), 'utf8');
                sessions.push(CodeSession.parse(JSON.parse(raw)));
            } catch {
                // skip malformed files
            }
        }
        // Newest activity first; session ids are time-sortable as a tiebreaker.
        sessions.sort((a, b) =>
            (b.lastActivityAt ?? b.createdAt).localeCompare(a.lastActivityAt ?? a.createdAt));
        return sessions;
    }

    async get(sessionId: string): Promise<CodeSession | null> {
        try {
            const raw = await fs.readFile(metaFile(sessionId), 'utf8');
            return CodeSession.parse(JSON.parse(raw));
        } catch {
            return null;
        }
    }

    async save(session: CodeSession): Promise<void> {
        const validated = CodeSession.parse(session);
        await fs.mkdir(META_DIR, { recursive: true });
        await fs.writeFile(metaFile(validated.id), JSON.stringify(validated, null, 2));
    }

    async remove(sessionId: string): Promise<void> {
        await fs.rm(metaFile(sessionId), { force: true }).catch(() => {});
    }
}
