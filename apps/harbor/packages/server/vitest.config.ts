import { defineConfig } from 'vitest/config';

// Every test runs on Postgres in-process (sql-pglite.ts), and several boot a
// fresh database inside the test itself — about 0.6s alone, several seconds
// on a loaded CI runner with every file's worker booting at once. Vitest's
// default 5s per test was tuned for pure functions; these are not.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
