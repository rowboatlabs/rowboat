import { PGlite } from '@electric-sql/pglite';
import type { SqlDb, SqlExecutor } from '../src/sql.js';

// In-process Postgres (WASM) implementing the same SqlDb boundary as
// node-postgres — hermetic tests for PgStore with zero external services.
// PGlite is single-connection; its internal queue serializes transactions,
// which composes fine with the advisory-lock discipline.

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
