import os from 'node:os';
import path from 'node:path';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { app, shell } from 'electron';
import { createEventsClient, type EventsClient } from '@x/client';
import { ipc, pushChannels } from '@x/shared';
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
import { createRelayAuthServer } from '@x/core/dist/auth/loopback-server.js';
import type { Server as HttpServer } from 'node:http';
import { broadcastToWindows, findMainAppWindow, onWorkspaceChange, sessionsIndexReady } from './ipc.js';
import { ElectronNotificationService } from './notification/electron-notification-service.js';
import { ElectronBrowserControlService } from './browser/control-service.js';
import { screenPointerService } from './screen-pointer.js';
import { textInsertService } from './text-insert.js';

// Phase 7a (SEPARATION_PLAN.md): with ROWBOAT_CHILD_SERVER=1, main does not
// host the transport in-process — it spawns the standalone rowboat-server as
// a child (ELECTRON_RUN_AS_NODE) and becomes a client: HTTP for calls (the
// existing forwarder), a WS events bridge for pushes, and Electron-side
// capability handlers for the server's reverse calls (notifications,
// open-url, browser-control). Default remains in-process until 7b parity.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Phase 8: ROWBOAT_REMOTE_SERVER=<url> (+ ROWBOAT_REMOTE_TOKEN) points the
// desktop at a rowboat-server on another machine — no child is spawned, no
// core runs locally. Everything the client does (HTTP calls, WS events,
// capability handlers, workspace file serving) rides the same paths as
// child mode, just over the network.
export type ServerHostMode = 'in-process' | 'child' | 'remote';

// A remote connection saved from the Settings UI. Env vars stay the
// power-user override and always win; the saved config makes remote mode
// reachable without a terminal. Read synchronously once — serverHostMode()
// gates decisions during main's boot, before any async init has run.
const clientConfigPath = path.join(WorkDir, 'config', 'client.json');
let savedRemote: { url: string; token: string } | null | undefined;

function loadSavedRemote(): { url: string; token: string } | null {
  if (savedRemote !== undefined) return savedRemote;
  savedRemote = null;
  try {
    const raw = JSON.parse(fsSync.readFileSync(clientConfigPath, 'utf8')) as {
      remoteServer?: { url?: string; token?: string };
    };
    if (raw.remoteServer?.url && raw.remoteServer.token) {
      savedRemote = { url: raw.remoteServer.url, token: raw.remoteServer.token };
    }
  } catch {
    // no config yet — local mode
  }
  return savedRemote;
}

/** Where the client should connect, or null for a local child. */
function remoteTarget(): { baseUrl: string; key: string; fromEnv: boolean } | null {
  if (process.env.ROWBOAT_REMOTE_SERVER) {
    return {
      baseUrl: process.env.ROWBOAT_REMOTE_SERVER.replace(/\/+$/, ''),
      key: (process.env.ROWBOAT_REMOTE_TOKEN ?? '').trim(),
      fromEnv: true,
    };
  }
  const saved = loadSavedRemote();
  if (saved) return { baseUrl: saved.url, key: saved.token, fromEnv: false };
  return null;
}

export function serverHostMode(): ServerHostMode {
  if (remoteTarget()) return 'remote';
  const env = process.env.ROWBOAT_CHILD_SERVER;
  if (env !== undefined && (env === '0' || env.toLowerCase() === 'false')) return 'in-process';
  return 'child';
}

/** True whenever main is a pure client (child or remote server). */
export function childServerMode(): boolean {
  return serverHostMode() !== 'in-process';
}

interface ChildServer {
  kind: 'child';
  child: ChildProcess;
  baseUrl: string;
  port: number;
  key: string;
  lanEnabled: boolean;
  events: EventsClient;
}

interface RemoteServer {
  kind: 'remote';
  baseUrl: string;
  key: string;
  events: EventsClient;
}

const PUSH_CHANNELS = pushChannels.PUSH_CHANNELS;

// OAuth loopback listeners this client hosts on the server's behalf (Phase
// 8b): the server's `loopback-bind` reverse call binds a local 127.0.0.1
// listener here — the machine whose browser receives the redirect — and every
// callback hit is relayed to the server's oauth:deliverLoopbackCallback RPC,
// which answers with the page to render.
const relayListeners = new Map<string, HttpServer>();

function closeRelayListeners(): void {
  for (const server of relayListeners.values()) server.close();
  relayListeners.clear();
}

// The client half shared by child and remote modes: WS events relay to
// renderer windows plus the Electron-side capability handlers for the
// server's reverse calls.
function createDesktopEventsClient(baseUrl: string, key: string): EventsClient {
  const notificationService = new ElectronNotificationService(Date.now());
  const browserControl = new ElectronBrowserControlService();
  const events = createEventsClient({
    baseUrl,
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
      'screen-pointer': async (payload) => {
        const p = payload as { type: 'point' | 'hide'; target?: never };
        if (p.type === 'point') return screenPointerService.point(p.target as never);
        await screenPointerService.hide();
        return { success: true };
      },
      'text-insert': async (payload) => {
        const p = payload as { type: 'captureTarget' | 'insert'; text?: string };
        if (p.type === 'insert') return textInsertService.insert(p.text ?? '');
        await textInsertService.captureTarget();
        return { ok: true };
      },
      'loopback-bind': async (payload) => {
        const p = payload as { bindingId: string; port: number; fallback: boolean; callbackPath: string };
        const { server, port } = await createRelayAuthServer(
          p.port,
          async (callbackUrl) => {
            const res = await fetch(`${baseUrl}/rpc/oauth:deliverLoopbackCallback`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
              body: JSON.stringify({ bindingId: p.bindingId, url: callbackUrl.toString() }),
            });
            const body = (await res.json().catch(() => null)) as
              | { accepted?: boolean; message?: string }
              | null;
            if (!res.ok || !body) {
              return { accepted: false, message: 'Could not reach the Rowboat server to complete sign-in' };
            }
            return { accepted: body.accepted === true, message: body.message };
          },
          { fallback: p.fallback, callbackPath: p.callbackPath },
        );
        relayListeners.set(p.bindingId, server);
        return { port };
      },
      'loopback-close': (payload) => {
        const p = payload as { bindingId: string };
        relayListeners.get(p.bindingId)?.close();
        relayListeners.delete(p.bindingId);
        return { ok: true };
      },
    },
  });
  for (const channel of PUSH_CHANNELS) {
    events.on(channel, (payload) => broadcastToWindows(channel as ipc.SendChannels, payload as never));
  }
  return events;
}

async function isRowboatServer(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2500) });
    const body = (await res.json()) as { name?: string };
    return body.name === 'rowboat-server';
  } catch {
    return false;
  }
}

async function connectRemote(): Promise<RemoteServer> {
  const target = remoteTarget();
  if (!target) throw new Error('no remote server configured');
  const { baseUrl, key } = target;
  if (!key) {
    throw new Error('remote server configured without an access token');
  }
  const deadline = Date.now() + 20_000;
  while (!(await isRowboatServer(baseUrl))) {
    if (Date.now() > deadline) {
      throw new Error(`no rowboat-server reachable at ${baseUrl} within 20s`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const events = createDesktopEventsClient(baseUrl, key);
  console.log(`[server-host] connected to remote rowboat-server at ${baseUrl}`);
  return { kind: 'remote', baseUrl, key, events };
}

async function launchChild(): Promise<ChildServer> {
  const fs = await import('node:fs/promises');
  const entry =
    process.env.ROWBOAT_SERVER_ENTRY ??
    (app.isPackaged
      ? path.join(__dirname, 'rowboat-server.cjs')
      : path.resolve(app.getAppPath(), '../server/dist/standalone.js'));
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ROWBOAT_PARENT_PID: String(process.pid) },
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
  const baseUrl = `http://127.0.0.1:${port}`;
  const events = createDesktopEventsClient(baseUrl, key);
  return { kind: 'child', child, baseUrl, port, key, lanEnabled: config.lanEnabled, events };
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

type HostedServer = RowboatServer | ChildServer | RemoteServer;

let current: HostedServer | null = null;
let ready: Promise<HostedServer> | null = null;

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

export function startServerHost(): Promise<HostedServer> {
  if (!ready) {
    const mode = serverHostMode();
    ready =
      mode === 'remote'
        ? connectRemote().then((c) => (current = c))
        : mode === 'child'
          ? launchChild().then((c) => (current = c))
          : launchInProcess();
  }
  return ready;
}

/** Resolves once the transport is reachable — the RPC forwarder awaits this. */
export async function whenServerReady(): Promise<{ baseUrl: string; key: string }> {
  const server = await startServerHost();
  const baseUrl = 'baseUrl' in server ? server.baseUrl : `http://127.0.0.1:${server.port}`;
  return { baseUrl, key: server.key };
}

export async function stopServerHost(): Promise<void> {
  const server = current;
  current = null;
  ready = null;
  if (!server) return;
  closeRelayListeners();
  if ('close' in server) {
    await server.close();
  } else {
    server.events.close();
    if (server.kind === 'child') server.child.kill();
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
  if ('kind' in current && current.kind === 'remote') {
    // Phones pair directly with the remote server, not through this client.
    return {
      running: true,
      name: new URL(current.baseUrl).hostname,
      port: Number(new URL(current.baseUrl).port) || null,
      lanEnabled: false,
      urls: [current.baseUrl],
      token: current.key,
    };
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
  if (serverHostMode() === 'remote') {
    throw new Error('Not available while connected to a remote rowboat-server');
  }
  const config = await loadServerConfig(WorkDir);
  await saveServerConfig(WorkDir, { ...config, lanEnabled: enabled });
  await stopServerHost();
  await startServerHost();
}

// ============================================================================
// Remote connection management (Settings → Connect to server)
// ============================================================================

export function getConnectionInfo(): { mode: ServerHostMode; url: string | null; fromEnv: boolean } {
  const target = remoteTarget();
  return {
    mode: serverHostMode(),
    url: target?.baseUrl ?? null,
    fromEnv: target?.fromEnv ?? false,
  };
}

async function saveClientConfig(remote: { url: string; token: string } | null): Promise<void> {
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await fs.readFile(clientConfigPath, 'utf8')) as Record<string, unknown>;
  } catch {
    // fresh file
  }
  if (remote) existing.remoteServer = remote;
  else delete existing.remoteServer;
  await fs.mkdir(path.dirname(clientConfigPath), { recursive: true });
  await fs.writeFile(clientConfigPath, JSON.stringify(existing, null, 2) + '\n', { mode: 0o600 });
}

/**
 * Validate the address + token against a live server, persist them, and
 * switch the running app over (the local child, if any, is stopped).
 */
export async function connectRemoteServer(url: string, token: string): Promise<{ success: boolean; error?: string }> {
  if (process.env.ROWBOAT_REMOTE_SERVER) {
    return { success: false, error: 'The server address is set by environment variables — unset them to manage it here.' };
  }
  if (serverHostMode() === 'in-process') {
    return { success: false, error: 'Not available while ROWBOAT_CHILD_SERVER=0 is set.' };
  }
  const baseUrl = url.trim().replace(/\/+$/, '');
  const key = token.trim();
  if (!/^https?:\/\//.test(baseUrl)) {
    return { success: false, error: 'Enter a full address like http://100.x.y.z:3220' };
  }
  if (!key) return { success: false, error: 'Enter the server’s access code' };
  if (!(await isRowboatServer(baseUrl))) {
    return { success: false, error: 'No Rowboat server answered at that address' };
  }
  try {
    const res = await fetch(`${baseUrl}/rpc/sessions:list`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401) return { success: false, error: 'The server rejected that access code' };
    if (!res.ok) return { success: false, error: `The server answered with an error (${res.status})` };
  } catch {
    return { success: false, error: 'Could not reach the server to verify the access code' };
  }
  await saveClientConfig({ url: baseUrl, token: key });
  savedRemote = { url: baseUrl, token: key };
  await stopServerHost();
  await startServerHost();
  return { success: true };
}

/** Back to local: forget the saved server and spawn the local child again. */
export async function disconnectRemoteServer(): Promise<{ success: boolean; error?: string }> {
  if (process.env.ROWBOAT_REMOTE_SERVER) {
    return { success: false, error: 'The server address is set by environment variables — unset them to manage it here.' };
  }
  await saveClientConfig(null);
  savedRemote = null;
  await stopServerHost();
  await startServerHost();
  return { success: true };
}

/** Mints a new server key, revoking every paired client, then rebinds. */
export async function rotateKey(): Promise<void> {
  if (serverHostMode() === 'remote') {
    throw new Error('Not available while connected to a remote rowboat-server');
  }
  await stopServerHost();
  await rotateServerKey(WorkDir);
  await startServerHost();
}
