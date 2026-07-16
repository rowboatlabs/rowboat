import os from 'node:os';
import { app } from 'electron';
import {
  buildPairingPayload,
  createCoreEventSources,
  createCoreRpcHandlers,
  createRowboatServer,
  loadServerConfig,
  resolveWorkspacePath,
  rotateServerKey,
  saveServerConfig,
  type RowboatServer,
} from '@x/server';
import { WorkDir } from '@x/core/dist/config/config.js';
import { onWorkspaceChange, sessionsIndexReady } from './ipc.js';

// Vertical-slice hosting: main runs the rowboat-server transport in-process
// on its single core instance, so external clients (the phone) and the
// renderer's forwarded channels share one session index, one turn event hub,
// one set of schedulers. When the full server/client split lands (RFC
// SERVER_CLIENT_SPEC.md Phase 1), main stops booting core and spawns the
// standalone entrypoint instead — this module then shrinks to lifecycle
// management and everything else survives unchanged.

let current: RowboatServer | null = null;
let ready: Promise<RowboatServer> | null = null;

async function launch(): Promise<RowboatServer> {
  const server = await createRowboatServer({
    workDir: WorkDir,
    handlers: createCoreRpcHandlers({ sessionsIndexReady }),
    events: {
      ...createCoreEventSources(),
      // workspace:didChange is sourced from main's debounced chokidar watcher,
      // not a core bus — pipe it into the hub alongside the window fan-out.
      subscribeWorkspaceEvents: onWorkspaceChange,
    },
    resolveWorkspacePath,
    serverVersion: app.getVersion(),
  });
  current = server;
  console.log(`[server-host] rowboat-server on http://${server.host}:${server.port} (lan: ${server.lanEnabled})`);
  return server;
}

export function startServerHost(): Promise<RowboatServer> {
  if (!ready) {
    ready = launch();
  }
  return ready;
}

/** Resolves once the transport is listening — the RPC forwarder awaits this. */
export function whenServerReady(): Promise<RowboatServer> {
  return startServerHost();
}

export async function stopServerHost(): Promise<void> {
  const server = current;
  current = null;
  ready = null;
  await server?.close();
}

export async function getPairingInfo(): Promise<{
  running: boolean;
  name: string;
  port: number | null;
  lanEnabled: boolean;
  urls: string[];
  token: string | null;
}> {
  if (!current) {
    return { running: false, name: os.hostname(), port: null, lanEnabled: false, urls: [], token: null };
  }
  const payload = buildPairingPayload(current.port, current.lanEnabled, current.key);
  return {
    running: true,
    name: payload.name,
    port: current.port,
    lanEnabled: current.lanEnabled,
    urls: payload.urls,
    token: current.key,
  };
}

// Persists the toggle and rebinds the listener (127.0.0.1 ⇄ 0.0.0.0).
// Connected clients drop and reconnect — acceptable for a settings flip.
export async function setLanEnabled(enabled: boolean): Promise<void> {
  const config = await loadServerConfig(WorkDir);
  await saveServerConfig(WorkDir, { ...config, lanEnabled: enabled });
  await stopServerHost();
  await startServerHost();
}

/** Mints a new server key, revoking every paired client, then rebinds. */
export async function rotateKey(): Promise<void> {
  await stopServerHost();
  await rotateServerKey(WorkDir);
  await startServerHost();
}
