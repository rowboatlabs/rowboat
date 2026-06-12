import type { Insertable, Kysely, Selectable } from "kysely";
import { z } from "zod";
import { MessageList } from "@x/shared/dist/message.js";
import type { AgentLoopTurnsTable, Database } from "../storage/schema.js";
import type { TurnStore } from "./turn-store.js";
import {
    AgentLoopError,
    AgentLoopTurn,
    DispatchedTool,
    PermissionDecision,
    PermissionMode,
    PermissionRequest,
    StartedTool,
} from "./types.js";

// Accepts a Kysely<Database> from the existing getDb(); it does not own the
// storage lifecycle (never calls initStorage()). Every JSON column is
// zod-parsed on read so schema drift fails loudly at the boundary.
export class SqliteTurnStore implements TurnStore {
    constructor(private db: Kysely<Database>) {}

    async create(turn: z.infer<typeof AgentLoopTurn>): Promise<void> {
        await this.db
            .insertInto("agent_loop_turns")
            .values(toRow(turn))
            .execute();
    }

    async get(id: string): Promise<z.infer<typeof AgentLoopTurn> | null> {
        const row = await this.db
            .selectFrom("agent_loop_turns")
            .selectAll()
            .where("id", "=", id)
            .executeTakeFirst();
        return row ? fromRow(row) : null;
    }

    async update(turn: z.infer<typeof AgentLoopTurn>): Promise<void> {
        const { id, ...rest } = toRow(turn);
        const result = await this.db
            .updateTable("agent_loop_turns")
            .set(rest)
            .where("id", "=", id)
            .executeTakeFirst();
        if (result.numUpdatedRows === 0n) {
            throw new Error(`Turn not found: ${id}`);
        }
    }

    async latestForSession(sessionId: string): Promise<z.infer<typeof AgentLoopTurn> | null> {
        const row = await this.db
            .selectFrom("agent_loop_turns")
            .selectAll()
            .where("session_id", "=", sessionId)
            .orderBy("session_seq", "desc")
            .limit(1)
            .executeTakeFirst();
        return row ? fromRow(row) : null;
    }

    async listBySession(sessionId: string): Promise<z.infer<typeof AgentLoopTurn>[]> {
        const rows = await this.db
            .selectFrom("agent_loop_turns")
            .selectAll()
            .where("session_id", "=", sessionId)
            .orderBy("session_seq", "asc")
            .execute();
        return rows.map(fromRow);
    }
}

function toRow(turn: z.infer<typeof AgentLoopTurn>): Insertable<AgentLoopTurnsTable> {
    return {
        id: turn.id,
        agent_id: turn.agentId,
        provider: turn.provider,
        model: turn.model,
        permission_mode: turn.permissionMode,
        session_id: turn.sessionId,
        session_seq: turn.sessionSeq,
        messages: JSON.stringify(turn.messages),
        permission_requests: JSON.stringify(turn.permissionRequests),
        permission_decisions: JSON.stringify(turn.permissionDecisions),
        started_tools: JSON.stringify(turn.startedTools),
        dispatched_tools: JSON.stringify(turn.dispatchedTools),
        error: turn.error === null ? null : JSON.stringify(turn.error),
        created_at: turn.createdAt,
        updated_at: turn.updatedAt,
        completed_at: turn.completedAt,
    };
}

function fromRow(row: Selectable<AgentLoopTurnsTable>): z.infer<typeof AgentLoopTurn> {
    return {
        id: row.id,
        agentId: row.agent_id,
        provider: row.provider,
        model: row.model,
        permissionMode: PermissionMode.parse(row.permission_mode),
        sessionId: row.session_id,
        sessionSeq: row.session_seq,
        messages: MessageList.parse(JSON.parse(row.messages)),
        permissionRequests: z.array(PermissionRequest).parse(JSON.parse(row.permission_requests)),
        permissionDecisions: z.array(PermissionDecision).parse(JSON.parse(row.permission_decisions)),
        startedTools: z.array(StartedTool).parse(JSON.parse(row.started_tools)),
        dispatchedTools: z.array(DispatchedTool).parse(JSON.parse(row.dispatched_tools)),
        error: row.error === null ? null : AgentLoopError.parse(JSON.parse(row.error)),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at,
    };
}
