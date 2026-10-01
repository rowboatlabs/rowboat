import { PGlite } from '@electric-sql/pglite';
import type { Db, Queryable } from '../src/db.js';

/** A real Postgres in the test process: no server, no Docker. */
export function pgliteDb(pg: PGlite): Db {
  const on = (q: Pick<PGlite, 'query' | 'exec'>): Queryable => ({
    async query<R>(text: string, params?: unknown[]) {
      // PGlite's query takes one statement; a migration holds several.
      if (!params || params.length === 0) {
        const results = await q.exec(text);
        return { rows: (results.at(-1)?.rows ?? []) as R[] };
      }
      const res = await q.query<R>(text, params);
      return { rows: res.rows };
    },
  });
  return {
    ...on(pg),
    transaction: (fn) => pg.transaction((tx) => fn(on(tx))),
  };
}
