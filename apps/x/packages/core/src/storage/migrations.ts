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
