import process from 'node:process';
import { WorkDir } from '@x/core/dist/config/config.js';
import { initConfigs } from '@x/core/dist/config/initConfigs.js';
import container, {
  registerBrowserControlService,
  registerNotificationService,
} from '@x/core/dist/di/container.js';
import type { ISessions } from '@x/core/dist/runtime/sessions/index.js';
import { createCoreEventSources, createCoreRpcHandlers, resolveWorkspacePath } from './core-deps.js';
import { prepareCoreData, initCoreServices } from '@x/core/dist/boot/services.js';
import { createRowboatServer } from './server.js';
import { capabilityBroker } from './capabilities.js';
import { registerUrlOpener } from '@x/core/dist/auth/url-opener.js';

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

async function main(): Promise<void> {
  // The workdir lock is acquired by createRowboatServer itself — a live
  // Electron-hosted transport makes this boot fail loudly, as it must.
  await initConfigs();
  // Client capabilities route over the WS as reverse calls (RFC Q14): the
  // connected client that advertises each capability performs it.
  const broker = capabilityBroker();
  registerNotificationService({
    isSupported: () => broker.hasCapableClient('notifications'),
    notify: (input) => broker.broadcast('notifications', input),
  });
  registerBrowserControlService({
    execute: async (input, ctx) => {
      void ctx;
      return (await broker.request('browser-control', input, { timeoutMs: 120_000 })) as never;
    },
  });
  registerUrlOpener({
    open: async (url) => {
      await broker.request('open-url', { url }, { timeoutMs: 15_000 });
    },
    focusClient: () => broker.broadcast('focus-client', {}),
  });

  await prepareCoreData();
  const sessions = container.resolve<ISessions>('sessions');
  const sessionsIndexReady = sessions.initialize().catch((err: unknown) => {
    console.error('[server] session index scan failed:', err);
  });
  // Schedulers, sync, event processor, background agents — full parity with
  // the Electron host (Phase 6): the standalone server now runs everything.
  await sessionsIndexReady;
  await initCoreServices();

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
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error('[server] fatal:', err);
  process.exit(1);
});
