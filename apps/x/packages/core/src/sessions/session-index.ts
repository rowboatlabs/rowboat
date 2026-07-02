import type { SessionIndexEntry } from "@x/shared/dist/sessions.js";

// In-memory projection over session files. Never a source of truth: rebuilt
// by the startup scan, maintained write-through by the sessions service.
export class SessionIndex {
    private entries = new Map<string, SessionIndexEntry>();

    list(): SessionIndexEntry[] {
        return [...this.entries.values()].sort((a, b) =>
            b.updatedAt.localeCompare(a.updatedAt),
        );
    }

    get(sessionId: string): SessionIndexEntry | undefined {
        return this.entries.get(sessionId);
    }

    upsert(entry: SessionIndexEntry): void {
        this.entries.set(entry.sessionId, entry);
    }

    remove(sessionId: string): boolean {
        return this.entries.delete(sessionId);
    }
}
