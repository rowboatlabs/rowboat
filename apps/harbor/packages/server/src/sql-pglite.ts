import { PGlite } from '@electric-sql/pglite';
import type { SqlDb, SqlExecutor } from './sql.js';

// Postgres in-process (WASM) behind the same SqlDb boundary as node-postgres
// (sql.ts): the store `pnpm dev` runs on without DATABASE_URL (restart = clean
// slate) and the store every test runs on — real migrations, real SQL, real
// transactions. Single-connection: PGlite's internal queue serializes
// transactions, which composes with the advisory-lock discipline (and cannot
// reproduce a two-connection race — that needs a real server). main.ts loads
// this by dynamic import on the dev path only; deployment mode never touches it.

export async function pgliteDb(): Promise<SqlDb> {
  const db = new PGlite();
  await db.waitReady;
  const executor = (q: PGlite | Parameters<Parameters<PGlite['transaction']>[0]>[0]): SqlExecutor => ({
    async query<R>(text: string, params?: unknown[]): Promise<R[]> {
      const result = await q.query(text, params ?? []);
      return result.rows as R[];
    },
  });
  return {
    ...executor(db),
    async withTransaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      return (await db.transaction(async (tx) => fn(executor(tx)))) as T;
    },
    async exec(text: string): Promise<void> {
      await db.exec(text);
    },
    close: () => db.close(),
  };
}
