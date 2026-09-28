import fs from "fs";
import path from "path";
import { WorkDir } from "../config/config.js";

// Session → Replicas workspace binding (2026-09-28). One chat session (a
// Space thread's session, a to-do run, a plain chat) talks to ONE workspace,
// the way code-mode/acp/session-store.ts pins one ACP session per chat: a
// follow-up "also fix the docs" steers the same workspace instead of booting
// a fresh VM. Local-only, like spaces_topic_sessions.json — teammates find
// the workspace through the handle line posted in the thread (handles.ts).

const BINDINGS_FILE = path.join(WorkDir, "config", "replicas_bindings.json");

export interface ReplicasBinding {
    workspaceId: string;
    chatId: string | null;
    environmentId: string | null;
    url: string | null;
    createdAt: string;
    updatedAt: string;
}

interface BindingsFile {
    version: 1;
    bySession: Record<string, ReplicasBinding>;
}

function read(): BindingsFile {
    try {
        if (!fs.existsSync(BINDINGS_FILE)) return { version: 1, bySession: {} };
        const raw = JSON.parse(fs.readFileSync(BINDINGS_FILE, "utf-8")) as Partial<BindingsFile>;
        return { version: 1, bySession: raw.bySession ?? {} };
    } catch {
        return { version: 1, bySession: {} };
    }
}

function write(file: BindingsFile): void {
    const dir = path.dirname(BINDINGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BINDINGS_FILE, JSON.stringify(file, null, 2));
}

export function getBinding(sessionId: string): ReplicasBinding | null {
    return read().bySession[sessionId] ?? null;
}

export function setBinding(
    sessionId: string,
    binding: Pick<ReplicasBinding, "workspaceId"> & Partial<Omit<ReplicasBinding, "workspaceId" | "createdAt" | "updatedAt">>,
): ReplicasBinding {
    const file = read();
    const now = new Date().toISOString();
    const previous = file.bySession[sessionId];
    const next: ReplicasBinding = {
        workspaceId: binding.workspaceId,
        chatId: binding.chatId ?? (previous?.workspaceId === binding.workspaceId ? previous.chatId : null),
        environmentId: binding.environmentId ?? (previous?.workspaceId === binding.workspaceId ? previous.environmentId : null),
        url: binding.url ?? (previous?.workspaceId === binding.workspaceId ? previous.url : null),
        createdAt: previous?.workspaceId === binding.workspaceId ? previous.createdAt : now,
        updatedAt: now,
    };
    file.bySession[sessionId] = next;
    write(file);
    return next;
}

export function clearBinding(sessionId: string): void {
    const file = read();
    if (!(sessionId in file.bySession)) return;
    delete file.bySession[sessionId];
    write(file);
}
