import fsp from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import type { ListRunsResponse } from "@x/shared/dist/runs.js";
import { WorkDir } from "../../config/config.js";

// Which chats belong to a workspace folder.
//
// A chat's work directory is stored in a sidecar (`config/workdir-<id>.json`,
// written by the renderer when the user sets it and read on every turn by
// loadUserWorkDir); sessions themselves store none. Membership is therefore a
// filter over the session index rather than anything the index can answer.

export interface WorkDirCandidate {
    id: string;
    title?: string;
    createdAt: string;
    modifiedAt: string;
    // The session's last agent, where it has one — a session with no turns yet
    // has none. Carried only because the shared response shape requires it.
    agentId?: string;
}

function workDirConfigPath(sessionId: string): string {
    return path.join(WorkDir, "config", `workdir-${sessionId}.json`);
}

function isPathInside(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readWorkDir(sessionId: string): Promise<string | null> {
    try {
        const raw = await fsp.readFile(workDirConfigPath(sessionId), "utf8");
        const parsed = JSON.parse(raw) as { path?: unknown };
        return typeof parsed?.path === "string" && parsed.path ? parsed.path : null;
    } catch {
        return null;
    }
}

// Code-section sessions share the session/workdir machinery but belong in the
// Code view, not the workspace chats list — opening one as a plain chat
// wouldn't resume code mode. See FSCodeSessionsRepo: one JSON file per id.
async function isCodeSession(sessionId: string): Promise<boolean> {
    try {
        await fsp.access(path.join(WorkDir, "code-mode", "sessions-meta", `${sessionId}.json`));
        return true;
    } catch {
        return false;
    }
}

/**
 * Filter `candidates` (typically the whole session index) down to the chats
 * whose work directory is `dir` or nested inside it. Newest first.
 */
export async function listByWorkDir(
    dir: string,
    candidates: WorkDirCandidate[],
): Promise<z.infer<typeof ListRunsResponse>> {
    const target = path.resolve(dir);

    const matches = await Promise.all(candidates.map(async (candidate) => {
        const workDir = await readWorkDir(candidate.id);
        if (!workDir || !isPathInside(target, path.resolve(workDir))) return null;
        if (await isCodeSession(candidate.id)) return null;
        return candidate;
    }));

    const runs = matches
        .filter((entry): entry is WorkDirCandidate => entry !== null)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((entry) => ({
            id: entry.id,
            ...(entry.title ? { title: entry.title } : {}),
            createdAt: entry.createdAt,
            modifiedAt: entry.modifiedAt,
            agentId: entry.agentId ?? '',
        }));

    return { runs };
}
