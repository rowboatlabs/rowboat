import process from 'node:process';
import { WorkDir } from '@x/core/dist/config/config.js';
import { initConfigs } from '@x/core/dist/config/initConfigs.js';
import container, {
  registerBrowserControlService,
  registerNotificationService,
  registerScreenPointerService,
  registerTextInsertService,
} from '@x/core/dist/di/container.js';
import type { ISessions } from '@x/core/dist/runtime/sessions/index.js';
import { createCoreEventSources, createCoreRpcHandlers, resolveWorkspacePath } from './core-deps.js';
import { startWorkspaceWatcher, subscribeWorkspaceEvents, subscribeKnowledgeEvents } from './workspace-watcher.js';
import { prepareCoreData, initCoreServices } from '@x/core/dist/boot/services.js';
import { createRowboatServer } from './server.js';
import { capabilityBroker } from './capabilities.js';
import { registerUrlOpener } from '@x/core/dist/auth/url-opener.js';
import { installLoopbackRelay } from './loopback-relay.js';
import { createFileCipher } from './file-cipher.js';
import { setTokenCipher as setChatGPTTokenCipher } from '@x/core/dist/auth/chatgpt-auth.js';
import { setAntigravityTokenCipher } from '@x/core/dist/auth/antigravity-auth.js';
import { setTokenCipher as setGithubTokenCipher } from '@x/core/dist/apps/github-auth.js';

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
  registerScreenPointerService({
    // Sync share-state can't round-trip the socket — approximate with
    // "a pointer-capable client is connected"; point() itself reports the
    // truthful result from the client.
    isShareActive: () => broker.hasCapableClient('screen-pointer'),
    point: async (target) =>
      (await broker.request('screen-pointer', { type: 'point', target }, { timeoutMs: 15_000 })) as never,
    hide: async () => {
      await broker.request('screen-pointer', { type: 'hide' }, { timeoutMs: 15_000 }).catch(() => {});
    },
  });
  registerTextInsertService({
    isSupported: () => broker.hasCapableClient('text-insert'),
    captureTarget: async () => {
      await broker.request('text-insert', { type: 'captureTarget' }, { timeoutMs: 15_000 }).catch(() => {});
    },
    insert: async (text) =>
      (await broker.request('text-insert', { type: 'insert', text }, { timeoutMs: 30_000 })) as never,
  });
  registerUrlOpener({
    open: async (url) => {
      await broker.request('open-url', { url }, { timeoutMs: 15_000 });
    },
    focusClient: () => broker.broadcast('focus-client', {}),
  });
  // OAuth loopback listeners are hosted by the loopback-capable client (the
  // machine whose browser gets the redirect); falls back to local binds when
  // none is connected (Phase 8b).
  installLoopbackRelay(broker);
  // Token-at-rest encryption: no OS keychain here — a workdir key file
  // (cipher-key, 0600) backs AES-256-GCM for the github/chatgpt token stores.
  const cipher = await createFileCipher(WorkDir);
  setChatGPTTokenCipher(cipher);
  setAntigravityTokenCipher(cipher);
  setGithubTokenCipher(cipher);

  await prepareCoreData();
  const sessions = container.resolve<ISessions>('sessions');
  const sessionsIndexReady = sessions.initialize().catch((err: unknown) => {
    console.error('[server] session index scan failed:', err);
  });
  // Schedulers, sync, event processor, background agents — full parity with
  // the Electron host (Phase 6): the standalone server now runs everything.
  await sessionsIndexReady;
  await initCoreServices();
  // Filesystem change feed lives server-side (Phase 8): clients — local or
  // remote — get workspace/knowledge pushes over the WS, not from their own
  // disk.
  await startWorkspaceWatcher();

  const server = await createRowboatServer({
    workDir: WorkDir,
    handlers: createCoreRpcHandlers({ sessionsIndexReady }),
    events: { ...createCoreEventSources(), subscribeWorkspaceEvents, subscribeKnowledgeEvents },
    resolveWorkspacePath,
    serverVersion: process.env.npm_package_version ?? '0.0.0',
  });

  console.log(`[server] rowboat-server listening on http://${server.host}:${server.port} (workdir: ${WorkDir})`);

  const shutdown = async () => {
    // Never let a stuck teardown keep the process alive — exit regardless.
    setTimeout(() => process.exit(0), 5000).unref();
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  // Child mode: if the parent Electron app dies without managing to kill us
  // (crash, force-quit), exit rather than run orphaned against its workdir.
  const parentPid = Number(process.env.ROWBOAT_PARENT_PID ?? '');
  if (parentPid > 0) {
    setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        console.error('[server] parent process gone — shutting down');
        void shutdown();
      }
    }, 5000).unref();
  }
}

main().catch((err) => {
  console.error('[server] fatal:', err);
  process.exit(1);
});
