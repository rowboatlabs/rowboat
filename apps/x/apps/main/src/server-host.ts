import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { app, shell } from 'electron';
import { createEventsClient, type EventsClient } from '@x/client';
import { ipc } from '@x/shared';
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
import { broadcastToWindows, findMainAppWindow, onWorkspaceChange, sessionsIndexReady } from './ipc.js';
import { ElectronNotificationService } from './notification/electron-notification-service.js';
import { ElectronBrowserControlService } from './browser/control-service.js';

// Phase 7a (SEPARATION_PLAN.md): with ROWBOAT_CHILD_SERVER=1, main does not
// host the transport in-process — it spawns the standalone rowboat-server as
// a child (ELECTRON_RUN_AS_NODE) and becomes a client: HTTP for calls (the
// existing forwarder), a WS events bridge for pushes, and Electron-side
// capability handlers for the server's reverse calls (notifications,
// open-url, browser-control). Default remains in-process until 7b parity.
export function childServerMode(): boolean {
  return process.env.ROWBOAT_CHILD_SERVER === '1';
}

interface ChildServer {
  kind: 'child';
  child: ChildProcess;
  port: number;
  key: string;
  lanEnabled: boolean;
  events: EventsClient;
}

const PUSH_CHANNELS = [
  'turns:events',
  'sessions:events',
  'workspace:didChange',
  'oauth:didConnect',
  'composio:didConnect',
  'chatgpt:statusChanged',
  'terminal:data',
  'terminal:exit',
] as const;

async function launchChild(): Promise<ChildServer> {
  const fs = await import('node:fs/promises');
  const entry =
    process.env.ROWBOAT_SERVER_ENTRY ??
    path.resolve(app.getAppPath(), '../server/dist/standalone.js');
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('exit', (code) => {
    console.error(`[server-host] child rowboat-server exited (code ${code})`);
  });

  const config = await loadServerConfig(WorkDir);
  const deadline = Date.now() + 60_000;
  const port = config.port;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
      const body = (await res.json()) as { name?: string };
      if (body.name === 'rowboat-server') break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error('child rowboat-server did not become healthy within 60s');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const key = (await fs.readFile(path.join(WorkDir, 'server-key'), 'utf8')).trim();

  const notificationService = new ElectronNotificationService(Date.now());
  const browserControl = new ElectronBrowserControlService();
  const events = createEventsClient({
    baseUrl: `http://127.0.0.1:${port}`,
    token: key,
    clientName: 'electron-main',
    capabilities: {
      notifications: (payload) => {
        notificationService.notify(payload as Parameters<ElectronNotificationService['notify']>[0]);
        return { ok: true };
      },
      'open-url': async (payload) => {
        await shell.openExternal((payload as { url: string }).url);
        return { ok: true };
      },
      'focus-client': () => {
        const win = findMainAppWindow();
        if (win) {
          if (win.isMinimized()) win.restore();
          win.focus();
        }
        return { ok: true };
      },
      'browser-control': (payload) => browserControl.execute(payload as never),
    },
  });
  for (const channel of PUSH_CHANNELS) {
    events.on(channel, (payload) => broadcastToWindows(channel as ipc.SendChannels, payload as never));
  }
  return { kind: 'child', child, port, key, lanEnabled: config.lanEnabled, events };
}

// Renderer turn-delta subscriptions bridge to the child's WS feed.
const deltaReleases = new Map<string, () => void>();
export function bridgeDeltaSubscribe(turnId: string): void {
  const c = current;
  if (!c || !('events' in c)) return;
  if (!deltaReleases.has(turnId)) {
    deltaReleases.set(turnId, c.events.subscribeTurnDeltas(turnId));
  }
}
export function bridgeDeltaUnsubscribe(turnId: string): void {
  deltaReleases.get(turnId)?.();
  deltaReleases.delete(turnId);
}

// Vertical-slice hosting: main runs the rowboat-server transport in-process
// on its single core instance, so external clients (the phone) and the
// renderer's forwarded channels share one session index, one turn event hub,
// one set of schedulers. When the full server/client split lands (RFC
// SERVER_CLIENT_SPEC.md Phase 1), main stops booting core and spawns the
// standalone entrypoint instead — this module then shrinks to lifecycle
// management and everything else survives unchanged.

let current: RowboatServer | ChildServer | null = null;
let ready: Promise<RowboatServer | ChildServer> | null = null;

async function launchInProcess(): Promise<RowboatServer> {
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

export function startServerHost(): Promise<RowboatServer | ChildServer> {
  if (!ready) {
    ready = childServerMode() ? launchChild().then((c) => (current = c)) : launchInProcess();
  }
  return ready;
}

/** Resolves once the transport is listening — the RPC forwarder awaits this. */
export function whenServerReady(): Promise<{ port: number; key: string }> {
  return startServerHost();
}

export async function stopServerHost(): Promise<void> {
  const server = current;
  current = null;
  ready = null;
  if (!server) return;
  if ('close' in server) {
    await server.close();
  } else {
    server.events.close();
    server.child.kill();
  }
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
