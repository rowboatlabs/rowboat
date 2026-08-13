import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';
import { withFileLock } from '../knowledge/file-lock.js';
import type { ISessions } from '../runtime/sessions/api.js';

// ---------------------------------------------------------------------------
// The Command Center session — ONE persistent conversation that IS the
// operator channel for Home. Its identity is what carries the frame: any
// turn on this session (voice call, companion bar, chat dock) gets the
// command-center operator instructions injected server-side via
// sessionCompositionPins, so "this is about my command center" never has to
// be said out loud. The session is an ordinary chat on the turns runtime —
// only this pointer file makes it special, and losing the file just means a
// fresh operator thread next time.
// ---------------------------------------------------------------------------

const FILE = path.join(WorkDir, 'home', 'command-center.json');

export const COMMAND_CENTER_TITLE = 'Command Center';

export async function getCommandCenterSessionId(): Promise<string | null> {
    try {
        const raw = await fs.readFile(FILE, 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        const id = (parsed as { sessionId?: unknown } | null)?.sessionId;
        return typeof id === 'string' && id ? id : null;
    } catch {
        return null;
    }
}

/** The command-center session, verified to still exist — or a fresh one.
 * Created with its title up front, so auto-titling never renames it. */
export async function ensureCommandCenterSession(sessions: ISessions): Promise<string> {
    const existing = await getCommandCenterSessionId();
    if (existing) {
        try {
            await sessions.getSession(existing);
            return existing;
        } catch {
            // Deleted — recreate below.
        }
    }
    const sessionId = await sessions.createSession({ title: COMMAND_CENTER_TITLE });
    await withFileLock(FILE, async () => {
        const dir = path.dirname(FILE);
        if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
        await fs.writeFile(FILE, JSON.stringify({ sessionId }, null, 2), 'utf-8');
    });
    return sessionId;
}
