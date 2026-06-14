import type { Insertable, Kysely, Selectable } from "kysely";
import { z } from "zod";
import type { Database, SessionsTable } from "../storage/schema.js";
import type { SessionStore } from "./session-store.js";
import { Session } from "./types.js";

// Accepts a Kysely<Database> from the existing getDb(); it does not own the
// storage lifecycle (never calls initStorage()).
export class SqliteSessionStore implements SessionStore {
    constructor(private db: Kysely<Database>) {}

    async create(session: z.infer<typeof Session>): Promise<void> {
        await this.db
            .insertInto("sessions")
            .values(toRow(session))
            .execute();
    }

    async get(id: string): Promise<z.infer<typeof Session> | null> {
        const row = await this.db
            .selectFrom("sessions")
            .selectAll()
            .where("id", "=", id)
            .executeTakeFirst();
        return row ? fromRow(row) : null;
    }

    async list(filter?: { agentId?: string }): Promise<z.infer<typeof Session>[]> {
        let query = this.db
            .selectFrom("sessions")
            .selectAll()
            .orderBy("updated_at", "desc");
        if (filter?.agentId !== undefined) {
            query = query.where("agent_id", "=", filter.agentId);
        }
        const rows = await query.execute();
        return rows.map(fromRow);
    }

    async update(session: z.infer<typeof Session>): Promise<void> {
        const { id, ...rest } = toRow(session);
        const result = await this.db
            .updateTable("sessions")
            .set(rest)
            .where("id", "=", id)
            .executeTakeFirst();
        if (result.numUpdatedRows === 0n) {
            throw new Error(`Session not found: ${id}`);
        }
    }

    async delete(id: string): Promise<void> {
        await this.db
            .deleteFrom("sessions")
            .where("id", "=", id)
            .execute();
    }
}

function toRow(session: z.infer<typeof Session>): Insertable<SessionsTable> {
    return {
        id: session.id,
        agent_id: session.agentId,
        title: session.title,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
    };
}

function fromRow(row: Selectable<SessionsTable>): z.infer<typeof Session> {
    return {
        id: row.id,
        agentId: row.agent_id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
