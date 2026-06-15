import type { Kysely } from "kysely";
import { Migrator, type Migration, type MigrationProvider } from "kysely/migration";

// Kysely migrations are intentionally schema-agnostic and frozen in time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MigrationDb = Kysely<any>;

const migrations: Record<string, Migration> = {
    "2026-06-09_0001_initial_storage": {
        async up(db: MigrationDb): Promise<void> {
            await db.schema
                .createTable("storage_metadata")
                .ifNotExists()
                .addColumn("key", "text", (col) => col.primaryKey())
                .addColumn("value", "text", (col) => col.notNull())
                .addColumn("updated_at", "text", (col) => col.notNull())
                .execute();
        },
        async down(db: MigrationDb): Promise<void> {
            await db.schema.dropTable("storage_metadata").ifExists().execute();
        },
    },
    "2026-06-12_0002_agent_loop_turns": {
        async up(db: MigrationDb): Promise<void> {
            await db.schema
                .createTable("agent_loop_turns")
                .ifNotExists()
                .addColumn("id", "text", (col) => col.primaryKey())
                .addColumn("agent_id", "text")
                .addColumn("provider", "text")
                .addColumn("model", "text")
                .addColumn("permission_mode", "text", (col) => col.notNull())
                .addColumn("messages", "text", (col) => col.notNull())
                .addColumn("permission_requests", "text", (col) => col.notNull())
                .addColumn("permission_decisions", "text", (col) => col.notNull())
                .addColumn("started_tools", "text", (col) => col.notNull())
                .addColumn("dispatched_tools", "text", (col) => col.notNull())
                .addColumn("error", "text")
                .addColumn("created_at", "text", (col) => col.notNull())
                .addColumn("updated_at", "text", (col) => col.notNull())
                .addColumn("completed_at", "text")
                .execute();

            await db.schema
                .createIndex("agent_loop_turns_created_at_idx")
                .ifNotExists()
                .on("agent_loop_turns")
                .column("created_at")
                .execute();
        },
        async down(db: MigrationDb): Promise<void> {
            await db.schema.dropIndex("agent_loop_turns_created_at_idx").ifExists().execute();
            await db.schema.dropTable("agent_loop_turns").ifExists().execute();
        },
    },
    "2026-06-12_0003_sessions": {
        async up(db: MigrationDb): Promise<void> {
            await db.schema
                .createTable("sessions")
                .ifNotExists()
                .addColumn("id", "text", (col) => col.primaryKey())
                .addColumn("agent_id", "text")
                .addColumn("title", "text")
                .addColumn("created_at", "text", (col) => col.notNull())
                .addColumn("updated_at", "text", (col) => col.notNull())
                .execute();

            await db.schema
                .createIndex("sessions_updated_at_idx")
                .ifNotExists()
                .on("sessions")
                .column("updated_at")
                .execute();

            await db.schema
                .alterTable("agent_loop_turns")
                .addColumn("session_id", "text")
                .execute();
            await db.schema
                .alterTable("agent_loop_turns")
                .addColumn("session_seq", "integer")
                .execute();

            // Tripwire: a second writer racing past the per-session mutex must
            // fail loudly instead of silently forking the turn chain. NULL
            // session_ids never conflict (standalone turns).
            await db.schema
                .createIndex("agent_loop_turns_session_seq_uniq")
                .ifNotExists()
                .unique()
                .on("agent_loop_turns")
                .columns(["session_id", "session_seq"])
                .execute();
        },
        async down(db: MigrationDb): Promise<void> {
            await db.schema.dropIndex("agent_loop_turns_session_seq_uniq").ifExists().execute();
            await db.schema.alterTable("agent_loop_turns").dropColumn("session_seq").execute();
            await db.schema.alterTable("agent_loop_turns").dropColumn("session_id").execute();
            await db.schema.dropIndex("sessions_updated_at_idx").ifExists().execute();
            await db.schema.dropTable("sessions").ifExists().execute();
        },
    },
    "2026-06-12_0004_turn_model_usage": {
        async up(db: MigrationDb): Promise<void> {
            await db.schema
                .alterTable("agent_loop_turns")
                .addColumn("model_usage", "text", (col) => col.notNull().defaultTo("[]"))
                .execute();
        },
        async down(db: MigrationDb): Promise<void> {
            await db.schema.alterTable("agent_loop_turns").dropColumn("model_usage").execute();
        },
    },
    "2026-06-12_0005_turn_transcript_dedup": {
        async up(db: MigrationDb): Promise<void> {
            // 0 = messages stored whole; N = the first N messages are the
            // previous session turn's closed transcript, recomputed on read.
            // Existing rows default to 0, so they keep reading back unchanged.
            await db.schema
                .alterTable("agent_loop_turns")
                .addColumn("prefix_length", "integer", (col) => col.notNull().defaultTo(0))
                .execute();
        },
        async down(db: MigrationDb): Promise<void> {
            await db.schema.alterTable("agent_loop_turns").dropColumn("prefix_length").execute();
        },
    },
    "2026-06-14_0006_turn_compose_context": {
        async up(db: MigrationDb): Promise<void> {
            // Per-turn compose chips (voice / search / code-mode) as JSON, or
            // null when the turn had none. Existing rows default to null.
            await db.schema
                .alterTable("agent_loop_turns")
                .addColumn("compose_context", "text")
                .execute();
        },
        async down(db: MigrationDb): Promise<void> {
            await db.schema.alterTable("agent_loop_turns").dropColumn("compose_context").execute();
        },
    },
    "2026-06-14_0007_turn_use_case": {
        async up(db: MigrationDb): Promise<void> {
            // Analytics attribution (use case / sub use case) for the turn's LLM
            // usage. Existing rows default to null (untagged).
            await db.schema
                .alterTable("agent_loop_turns")
                .addColumn("use_case", "text")
                .execute();
            await db.schema
                .alterTable("agent_loop_turns")
                .addColumn("sub_use_case", "text")
                .execute();
        },
        async down(db: MigrationDb): Promise<void> {
            await db.schema.alterTable("agent_loop_turns").dropColumn("sub_use_case").execute();
            await db.schema.alterTable("agent_loop_turns").dropColumn("use_case").execute();
        },
    },
    "2026-06-15_0008_code_session_events": {
        async up(db: MigrationDb): Promise<void> {
            // Code-mode's own append-only event log (direct ACP sessions),
            // replacing the generic runs/ JSONL store.
            await db.schema
                .createTable("code_session_events")
                .ifNotExists()
                .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
                .addColumn("session_id", "text", (col) => col.notNull())
                .addColumn("event", "text", (col) => col.notNull())
                .addColumn("created_at", "text", (col) => col.notNull())
                .execute();

            await db.schema
                .createIndex("code_session_events_session_id_idx")
                .ifNotExists()
                .on("code_session_events")
                .column("session_id")
                .execute();
        },
        async down(db: MigrationDb): Promise<void> {
            await db.schema.dropIndex("code_session_events_session_id_idx").ifExists().execute();
            await db.schema.dropTable("code_session_events").ifExists().execute();
        },
    },
};

class InCodeMigrationProvider implements MigrationProvider {
    async getMigrations(): Promise<Record<string, Migration>> {
        return migrations;
    }
}

export async function migrateToLatest(db: MigrationDb): Promise<void> {
    const migrator = new Migrator({
        db,
        provider: new InCodeMigrationProvider(),
    });

    const { error, results } = await migrator.migrateToLatest();

    for (const result of results ?? []) {
        if (result.status === "Success") {
            console.log(`[storage] migration applied: ${result.migrationName}`);
        } else if (result.status === "Error") {
            console.error(`[storage] migration failed: ${result.migrationName}`);
        }
    }

    if (error) {
        throw new Error("Failed to migrate SQLite storage", { cause: error });
    }
}
