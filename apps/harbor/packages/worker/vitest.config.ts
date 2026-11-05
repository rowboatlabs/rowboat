import { defineConfig } from 'vitest/config';

// The worker's tests run a real Harbor on Postgres in-process (as the server's
// own do) and drive child processes for the harness; neither fits vitest's 5s.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
