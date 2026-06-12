import type { ColumnType } from "kysely";

export type TimestampColumn = ColumnType<string, string, string>;

export interface StorageMetadataTable {
    key: string;
    value: string;
    updated_at: TimestampColumn;
}

export interface AgentLoopTurnsTable {
    id: string;
    agent_id: string | null;
    provider: string | null;
    model: string | null;
    permission_mode: string;
    messages: string;             // JSON: MessageList
    permission_requests: string;  // JSON: PermissionRequest[]
    permission_decisions: string; // JSON: PermissionDecision[]
    started_tools: string;        // JSON: StartedTool[]
    dispatched_tools: string;     // JSON: DispatchedTool[]
    error: string | null;         // JSON: AgentLoopError
    created_at: TimestampColumn;
    updated_at: TimestampColumn;
    completed_at: string | null;
}

export interface Database {
    storage_metadata: StorageMetadataTable;
    agent_loop_turns: AgentLoopTurnsTable;
}
