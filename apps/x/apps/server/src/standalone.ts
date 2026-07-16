import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { WorkDir } from '@x/core/dist/config/config.js';
import { initConfigs } from '@x/core/dist/config/initConfigs.js';
import container, {
  registerBrowserControlService,
  registerNotificationService,
} from '@x/core/dist/di/container.js';
import type { ISessions } from '@x/core/dist/runtime/sessions/index.js';
import { createCoreEventSources, createCoreRpcHandlers, resolveWorkspacePath } from './core-deps.js';
import { createRowboatServer } from './server.js';

// Headless rowboat-server: the RFC's end-state entrypoint, where main spawns
// this as a child process (or it runs on a remote box) and core lives here.
//
// UNTIL that flip lands, this must never run against a workdir a live
// Electron app is using — two core instances over one ~/.rowboat double-run
// schedulers and split-brain the session index. The pid lockfile plus the
// Electron app's own single-instance lock make that mistake loud instead of
// silent. Intended use today: integration tests and dev, always with an
// isolated ROWBOAT_WORKDIR.
//
// Deliberately NOT started here (Phase 1 work, moves over with the flip):
// schedulers, knowledge sync (gmail/calendar/granola/fireflies), event
// processor, live-note + bg-task agents.

const LOCK_FILE = 'server.lock';

async function acquireLock(workDir: string): Promise<() => Promise<void>> {
  const lockPath = path.join(workDir, LOCK_FILE);
  try {
    const existing = parseInt(await fs.readFile(lockPath, 'utf8'), 10);
    if (Number.isFinite(existing)) {
      try {
        process.kill(existing, 0); // throws if the pid is gone
        throw new Error(
          `another rowboat-server (pid ${existing}) already owns ${workDir} — refusing to split-brain`,
        );
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err;
        // stale lock from a dead process — take over
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  await fs.mkdir(workDir, { recursive: true });
  await fs.writeFile(lockPath, String(process.pid));
  return async () => {
    await fs.rm(lockPath, { force: true });
  };
}

async function main(): Promise<void> {
  const releaseLock = await acquireLock(WorkDir);

  await initConfigs();
  registerNotificationService({ isSupported: () => false, notify: () => {} });
  registerBrowserControlService({
    execute: async () => {
      throw new Error('browser control is unavailable on a headless server');
    },
  });

  const sessions = container.resolve<ISessions>('sessions');
  const sessionsIndexReady = sessions.initialize().catch((err: unknown) => {
    console.error('[server] session index scan failed:', err);
  });

  const server = await createRowboatServer({
    workDir: WorkDir,
    handlers: createCoreRpcHandlers({ sessionsIndexReady }),
    events: createCoreEventSources(),
    resolveWorkspacePath,
    serverVersion: process.env.npm_package_version ?? '0.0.0',
  });

  console.log(`[server] rowboat-server listening on http://${server.host}:${server.port} (workdir: ${WorkDir})`);

  const shutdown = async () => {
    await server.close();
    await releaseLock();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error('[server] fatal:', err);
  process.exit(1);
});
