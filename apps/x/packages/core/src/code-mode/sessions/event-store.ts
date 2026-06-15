import { z } from "zod";
import { RunEvent } from "@x/shared/dist/runs.js";
import { getDb } from "../../storage/database.js";

// Code-mode's own append-only event log, backed by the new SQLite storage.
// This is the dedicated replacement for the generic runs/ JSONL store the old
// agent runtime shared: a direct (ACP) code session's transcript lives here,
// keyed by session id and ordered by insertion. Events are RunEvents (the same
// shape the renderer already renders) — only the storage backend changed.
export class CodeEventStore {
    private get db() {
        return getDb();
    }

    async append(sessionId: string, events: z.infer<typeof RunEvent>[]): Promise<void> {
        if (events.length === 0) return;
        const now = new Date().toISOString();
        await this.db
            .insertInto("code_session_events")
            .values(events.map((event) => ({
                session_id: sessionId,
                event: JSON.stringify(event),
                created_at: now,
            })))
            .execute();
    }

    async list(sessionId: string): Promise<z.infer<typeof RunEvent>[]> {
        const rows = await this.db
            .selectFrom("code_session_events")
            .select("event")
            .where("session_id", "=", sessionId)
            .orderBy("id", "asc")
            .execute();
        const out: z.infer<typeof RunEvent>[] = [];
        for (const row of rows) {
            const parsed = RunEvent.safeParse(JSON.parse(row.event));
            // Skip rather than throw on a stray/legacy row — a corrupt event must
            // not make the whole transcript unloadable.
            if (parsed.success) out.push(parsed.data);
        }
        return out;
    }

    async delete(sessionId: string): Promise<void> {
        await this.db
            .deleteFrom("code_session_events")
            .where("session_id", "=", sessionId)
            .execute();
    }
}
