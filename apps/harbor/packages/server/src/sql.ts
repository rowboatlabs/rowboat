import pg from 'pg';

// Minimal SQL boundary so the Postgres store runs on anything that speaks
// Postgres: a real server via node-postgres here, or in-process PGlite in
// tests (test/pglite.ts implements the same interface). Deliberately tiny —
// parameterized query, transaction, multi-statement exec.

export interface SqlExecutor {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<R[]>;
}

export interface SqlDb extends SqlExecutor {
  withTransaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  /** Multi-statement DDL. */
  exec(text: string): Promise<void>;
  close(): Promise<void>;
}

export function postgresDb(connectionString: string): SqlDb {
  const pool = new pg.Pool({ connectionString });
  return {
    async query<R>(text: string, params?: unknown[]): Promise<R[]> {
      const result = await pool.query(text, params);
      return result.rows as R[];
    },
    async withTransaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx: SqlExecutor = {
          async query<R>(text: string, params?: unknown[]): Promise<R[]> {
            const result = await client.query(text, params);
            return result.rows as R[];
          },
        };
        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    async exec(text: string): Promise<void> {
      await pool.query(text);
    },
    close: () => pool.end(),
  };
}
