import type { Insertable, Kysely, Selectable } from "kysely";
import { z } from "zod";
import { Message, MessageList } from "@x/shared/dist/message.js";
import type { AgentLoopTurnsTable, Database } from "../storage/schema.js";
import { joinTranscript, splitTranscript } from "./prefix-dedup.js";
import type { TurnStore } from "./turn-store.js";
import {
    AgentLoopError,
    AgentLoopTurn,
    DispatchedTool,
    ModelUsage,
    PermissionDecision,
    PermissionMode,
    PermissionRequest,
    StartedTool,
} from "./types.js";

// Accepts a Kysely<Database> from the existing getDb(); it does not own the
// storage lifecycle (never calls initStorage()). Every JSON column is
// zod-parsed on read so schema drift fails loudly at the boundary.
//
// Session turns are stored with their copy-forward prefix deduplicated (see
// prefix-dedup.ts): the messages column holds only the suffix past
// prefix_length, and reads re-attach the prefix from the previous turn.
export class SqliteTurnStore implements TurnStore {
    constructor(private db: Kysely<Database>) {}

    async create(turn: z.infer<typeof AgentLoopTurn>): Promise<void> {
        const prev = await this.previousTurn(turn.sessionId, turn.sessionSeq);
        const { prefixLength, delta } = splitTranscript(turn, prev);
        await this.db
            .insertInto("agent_loop_turns")
            .values(toRow(turn, delta, prefixLength))
            .execute();
    }

    async get(id: string): Promise<z.infer<typeof AgentLoopTurn> | null> {
        const row = await this.db
            .selectFrom("agent_loop_turns")
            .selectAll()
            .where("id", "=", id)
            .executeTakeFirst();
        if (!row) return null;
        if (row.prefix_length === 0) return fromRow(row);
        if (row.session_id === null || row.session_seq === null) {
            // only session turns are ever stored deduped
            throw new Error(`Turn ${id} has a transcript prefix but no session linkage`);
        }
        // Materializing requires the chain up to this turn; fold forward.
        const chain = await this.foldSession(row.session_id, row.session_seq);
        const turn = chain[chain.length - 1];
        if (!turn || turn.id !== id) {
            throw new Error(`Turn ${id} requires its previous session turn to materialize`);
        }
        return turn;
    }

    async update(turn: z.infer<typeof AgentLoopTurn>): Promise<void> {
        const existing = await this.db
            .selectFrom("agent_loop_turns")
            .select("prefix_length")
            .where("id", "=", turn.id)
            .executeTakeFirst();
        if (!existing) {
            throw new Error(`Turn not found: ${turn.id}`);
        }
        if (turn.messages.length < existing.prefix_length) {
            throw new Error(`Turn ${turn.id} shrank below its stored transcript prefix`);
        }
        const delta = turn.messages.slice(existing.prefix_length);
        const { id, ...rest } = toRow(turn, delta, existing.prefix_length);
        const result = await this.db
            .updateTable("agent_loop_turns")
            .set(rest)
            .where("id", "=", id)
            .executeTakeFirst();
        // The SELECT above proved existence, but keep the write itself honest:
        // a row vanishing in between must never silently no-op.
        if (result.numUpdatedRows === 0n) {
            throw new Error(`Turn not found: ${id}`);
        }
    }

    async latestForSession(sessionId: string): Promise<z.infer<typeof AgentLoopTurn> | null> {
        const turns = await this.foldSession(sessionId, null);
        return turns.length > 0 ? turns[turns.length - 1] : null;
    }

    async listBySession(sessionId: string): Promise<z.infer<typeof AgentLoopTurn>[]> {
        return this.foldSession(sessionId, null);
    }

    // Loads a session's turns in seq order (up to and including uptoSeq, or
    // all) and materializes each transcript from the previous turn's.
    private async foldSession(
        sessionId: string,
        uptoSeq: number | null,
    ): Promise<z.infer<typeof AgentLoopTurn>[]> {
        let query = this.db
            .selectFrom("agent_loop_turns")
            .selectAll()
            .where("session_id", "=", sessionId)
            .orderBy("session_seq", "asc");
        if (uptoSeq !== null) {
            query = query.where("session_seq", "<=", uptoSeq);
        }
        const rows = await query.execute();
        const out: z.infer<typeof AgentLoopTurn>[] = [];
        let prev: z.infer<typeof AgentLoopTurn> | null = null;
        for (const row of rows) {
            const turn = fromRow(row);
            const prefixSource =
                prev !== null && prev.sessionSeq === (turn.sessionSeq ?? 0) - 1 ? prev : null;
            turn.messages = joinTranscript(turn.id, prefixSource, row.prefix_length, turn.messages);
            out.push(turn);
            prev = turn;
        }
        return out;
    }

    private async previousTurn(
        sessionId: string | null,
        sessionSeq: number | null,
    ): Promise<z.infer<typeof AgentLoopTurn> | null> {
        if (sessionId === null || sessionSeq === null || sessionSeq <= 1) return null;
        const chain = await this.foldSession(sessionId, sessionSeq - 1);
        const prev = chain[chain.length - 1];
        return prev && prev.sessionSeq === sessionSeq - 1 ? prev : null;
    }
}

function toRow(
    turn: z.infer<typeof AgentLoopTurn>,
    delta: z.infer<typeof Message>[],
    prefixLength: number,
): Insertable<AgentLoopTurnsTable> {
    return {
        id: turn.id,
        agent_id: turn.agentId,
        provider: turn.provider,
        model: turn.model,
        permission_mode: turn.permissionMode,
        session_id: turn.sessionId,
        session_seq: turn.sessionSeq,
        messages: JSON.stringify(delta),
        prefix_length: prefixLength,
        permission_requests: JSON.stringify(turn.permissionRequests),
        permission_decisions: JSON.stringify(turn.permissionDecisions),
        started_tools: JSON.stringify(turn.startedTools),
        dispatched_tools: JSON.stringify(turn.dispatchedTools),
        model_usage: JSON.stringify(turn.modelUsage),
        error: turn.error === null ? null : JSON.stringify(turn.error),
        created_at: turn.createdAt,
        updated_at: turn.updatedAt,
        completed_at: turn.completedAt,
    };
}

// Note: `messages` holds only the stored delta — callers must re-attach the
// prefix via joinTranscript before handing the turn out.
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
        modelUsage: z.array(ModelUsage).parse(JSON.parse(row.model_usage)),
        error: row.error === null ? null : AgentLoopError.parse(JSON.parse(row.error)),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at,
    };
}
