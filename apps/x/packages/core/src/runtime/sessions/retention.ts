import fs from "node:fs/promises";
import path from "node:path";
import { reduceTurn } from "@x/shared/dist/turns.js";
import type { RetentionSettings } from "@x/shared/dist/retention.js";
import type { ISessions } from "./api.js";
import { childTurnIdsOf } from "./sessions.js";

// ---------------------------------------------------------------------------
// Storage retention sweep (session-design.md §9.4 covers deletion semantics).
//
// Two policies, run daily from the app layer:
//
// 1. Chats — sessions whose last activity (updatedAt) is older than
//    `chatDays` are deleted through ISessions.deleteSession, which removes
//    the session file and its whole turn chain (sub-agent children
//    included) and aborts any live advance first — so no liveness guard is
//    needed here (and a chat idle for 30+ days has none anyway).
//
// 2. Task transcripts — turn files under `turnsRootDir` older than
//    `taskDays` that are NOT reachable from any live session (headless
//    note-creation / background-task / knowledge-sync runs, plus orphans
//    from pre-cleanup deletes). Reachability is computed after step 1 so a
//    just-deleted chat's files don't linger another cycle. The outputs
//    those runs produced (notes, knowledge files, bg-task artifacts) live
//    outside storage/ and are never touched. UIs that reference old runs
//    (bg-task runs history) already tolerate missing transcript files.
//
// Everything is best-effort: one bad file never aborts the sweep.
// ---------------------------------------------------------------------------

export interface RetentionSweepResult {
    deletedSessions: number;
    deletedTurnFiles: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Turn/session ids start with their creation date: 2026-08-06T09-43-36Z-….
const idDate = (id: string): number => {
    const ts = Date.parse(id.slice(0, 10));
    return Number.isNaN(ts) ? Number.POSITIVE_INFINITY : ts;
};

export async function runRetentionSweep({
    sessions,
    turnsRootDir,
    settings,
    now = Date.now(),
}: {
    sessions: ISessions;
    turnsRootDir: string;
    settings: RetentionSettings;
    now?: number;
}): Promise<RetentionSweepResult> {
    const result: RetentionSweepResult = { deletedSessions: 0, deletedTurnFiles: 0 };
    if (!settings.enabled) return result;

    // ── 1. Old chats (chatDays null = never delete chats) ─────────
    if (settings.chatDays !== null) {
        const chatCutoff = now - settings.chatDays * DAY_MS;
        for (const entry of sessions.listSessions()) {
            const lastActivity = Date.parse(entry.updatedAt || entry.createdAt);
            if (Number.isNaN(lastActivity) || lastActivity >= chatCutoff) continue;
            try {
                await sessions.deleteSession(entry.sessionId);
                result.deletedSessions += 1;
            } catch (error) {
                console.error(`[Retention] failed to delete session ${entry.sessionId}:`, error);
            }
        }
    }

    // ── 2. Old unreferenced turn files ────────────────────────────
    const referenced = await collectReferencedTurnIds(sessions);
    const taskCutoff = now - settings.taskDays * DAY_MS;
    for (const { turnId, filePath } of await listTurnFiles(turnsRootDir)) {
        if (referenced.has(turnId)) continue;
        if (idDate(turnId) >= taskCutoff) continue;
        try {
            await fs.unlink(filePath);
            result.deletedTurnFiles += 1;
        } catch {
            // Already gone or unreadable — leftovers are inert.
        }
    }

    return result;
}

// Every turn id reachable from a live session: the session's turn refs plus
// the spawn-agent child chain of each (children can nest).
async function collectReferencedTurnIds(sessions: ISessions): Promise<Set<string>> {
    const referenced = new Set<string>();
    const queue: string[] = [];
    for (const entry of sessions.listSessions()) {
        try {
            const state = await sessions.getSession(entry.sessionId);
            queue.push(...state.turns.map((ref) => ref.turnId));
        } catch {
            // Corrupt session — its turns stay untouched (conservative).
        }
    }
    while (queue.length > 0) {
        const turnId = queue.shift()!;
        if (referenced.has(turnId)) continue;
        referenced.add(turnId);
        try {
            const turn = await sessions.getTurn(turnId);
            queue.push(...childTurnIdsOf(reduceTurn(turn.events)));
        } catch {
            // Missing or corrupt turn — nothing further to follow.
        }
    }
    return referenced;
}

// Walk the yyyy/mm/dd partition tree; anything else in there is ignored.
async function listTurnFiles(
    rootDir: string,
): Promise<Array<{ turnId: string; filePath: string }>> {
    const out: Array<{ turnId: string; filePath: string }> = [];
    const days = async (dir: string, depth: number): Promise<string[]> => {
        if (depth === 0) return [dir];
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
        const nested = await Promise.all(
            entries
                .filter((e) => e.isDirectory())
                .map((e) => days(path.join(dir, e.name), depth - 1)),
        );
        return nested.flat();
    };
    for (const dayDir of await days(rootDir, 3)) {
        const entries = await fs.readdir(dayDir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
            out.push({
                turnId: entry.name.slice(0, -".jsonl".length),
                filePath: path.join(dayDir, entry.name),
            });
        }
    }
    return out;
}
