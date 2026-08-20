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

// Module-memory cache: sessionCompositionPins consults the pointer on EVERY
// turn of every session to decide the commandCenter flag — a stable id must
// not cost fs reads on that hot path. undefined = not read yet; refreshed
// on every write below.
let cachedId: string | null | undefined;

async function readPointerFile(): Promise<string | null> {
    try {
        const raw = await fs.readFile(FILE, 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        const id = (parsed as { sessionId?: unknown } | null)?.sessionId;
        return typeof id === 'string' && id ? id : null;
    } catch {
        return null;
    }
}

export async function getCommandCenterSessionId(): Promise<string | null> {
    if (cachedId === undefined) cachedId = await readPointerFile();
    return cachedId;
}

/** The command-center session, verified to still exist — or a fresh one.
 * Created with its title up front, so auto-titling never renames it. The
 * WHOLE get-verify-create runs under the lock: two concurrent binds
 * (Skipper click + the companion switcher at startup) must never each mint
 * a session — the loser would be an orphaned "Command Center" chat that is
 * not actually operator-framed. */
export async function ensureCommandCenterSession(sessions: ISessions): Promise<string> {
    return withFileLock(FILE, async () => {
        const existing = await readPointerFile();
        if (existing) {
            try {
                await sessions.getSession(existing);
                cachedId = existing;
                await detachCodeMeta(existing);
                return existing;
            } catch {
                // Deleted — recreate below.
            }
        }
        const sessionId = await sessions.createSession({ title: COMMAND_CENTER_TITLE });
        const dir = path.dirname(FILE);
        if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
        await fs.writeFile(FILE, JSON.stringify({ sessionId }, null, 2), 'utf-8');
        cachedId = sessionId;
        return sessionId;
    });
}

/**
 * Self-heal: the operator channel must never carry code-session meta. Early
 * builds let an in-channel code_agent_run adopt it (meta + worktree written
 * before the never-adopt guard existed); the meta is durable, so it kept
 * showing in the Code rail and pinning the dispatcher to one repo. Detach
 * ONLY: the meta, the stored ACP conversation, and the workdir sidecar are
 * removed — the worktree directory and its branch stay on disk, since they
 * may hold work from those turns (recoverable via git; never deleted here).
 */
async function detachCodeMeta(sessionId: string): Promise<void> {
    try {
        const { lazyResolve } = await import('../di/lazy-resolve.js');
        const repo = await lazyResolve<{
            get(id: string): Promise<{ worktree?: { path: string; branch: string } } | null>;
            remove(id: string): Promise<void>;
        }>('codeSessionsRepo');
        const meta = await repo.get(sessionId);
        if (!meta) return;
        await repo.remove(sessionId);
        const { clearStoredSession } = await import('../code-mode/acp/session-store.js');
        await clearStoredSession(sessionId);
        await fs.rm(path.join(WorkDir, 'config', `workdir-${sessionId}.json`), { force: true }).catch(() => {});
        console.warn(
            `[command-center] detached code-session meta from the operator channel${
                meta.worktree ? `; worktree left intact at ${meta.worktree.path} (branch ${meta.worktree.branch})` : ''
            }`,
        );
    } catch {
        // Best-effort — the createForSession guard still blocks new damage.
    }
}

/** Boot-time half of the self-heal: repair without creating. */
export async function repairCommandCenterSession(): Promise<void> {
    const existing = await getCommandCenterSessionId();
    if (existing) await detachCodeMeta(existing);
}
