import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Kysely, SqliteDialect, type SqliteDatabase } from "kysely";
import { WorkDir } from "../config/config.js";
import type { Database } from "./schema.js";
import { migrateToLatest } from "./migrations.js";

type BetterSqliteDatabase = SqliteDatabase & {
    pragma(source: string, options?: { simple?: boolean }): unknown;
};

type BetterSqliteConstructor = new (
    filename?: string,
    options?: { timeout?: number },
) => BetterSqliteDatabase;

const require = createRequire(import.meta.url);
const BetterSqlite = require("better-sqlite3") as BetterSqliteConstructor;

let db: Kysely<Database> | null = null;
let initPromise: Promise<void> | null = null;

export function getDatabasePath(): string {
    return path.join(WorkDir, "db", "rowboat.sqlite");
}

function createDatabase(): Kysely<Database> {
    const databasePath = getDatabasePath();
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });

    const sqlite = new BetterSqlite(databasePath, { timeout: 5_000 });
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("busy_timeout = 5000");

    return new Kysely<Database>({
        dialect: new SqliteDialect({
            database: sqlite,
        }),
    });
}

export async function initStorage(): Promise<void> {
    if (db) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        const nextDb = createDatabase();
        try {
            await migrateToLatest(nextDb);
            db = nextDb;
        } catch (error) {
            await nextDb.destroy().catch((destroyError: unknown) => {
                console.error("[storage] failed to close SQLite after init failure:", destroyError);
            });
            throw error;
        } finally {
            initPromise = null;
        }
    })();

    return initPromise;
}

export function getDb(): Kysely<Database> {
    if (!db) {
        throw new Error("SQLite storage has not been initialized. Call initStorage() first.");
    }

    return db;
}

export async function shutdownStorage(): Promise<void> {
    const currentDb = db;
    db = null;
    initPromise = null;

    if (currentDb) {
        await currentDb.destroy();
    }
}
