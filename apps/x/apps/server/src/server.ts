import type { Server as HttpServer } from 'node:http';
import os from 'node:os';
import { createAdaptorServer } from '@hono/node-server';
import { Hono } from 'hono';
import type { TurnBusEvent } from '@x/shared/dist/turns.js';
import type { SessionBusEvent } from '@x/shared/dist/sessions.js';
import { WorkspaceChangeEvent } from '@x/shared/dist/workspace.js';
import { z } from 'zod';
import { extractBearer, loadOrCreateServerKey, tokenMatches } from './auth.js';
import type { RpcHandlers } from './channels.js';
import { loadServerConfig } from './config.js';
import { acquireWorkdirLock } from './lock.js';
import { createRpcRoutes } from './router.js';
import { createWorkspaceRoutes } from './workspace-route.js';
import { createWsHub, type WsHub } from './ws-hub.js';
import { setCapabilityTransport } from './capabilities.js';

// Assembles the transport: HTTP router + workspace files + WS event hub on
// one node:http server. Deliberately does NOT boot @x/core — the host (today
// Electron main in-process, later the standalone headless entrypoint) owns
// exactly one core instance and hands its handler map and event buses in.
// That inversion is what keeps the strangler-fig slice split-brain-free.

export interface EventSources {
  subscribeTurnEvents(listener: (e: TurnBusEvent) => void): () => void;
  subscribeSessionEvents(listener: (e: SessionBusEvent) => void): () => void;
  subscribeWorkspaceEvents?(listener: (e: z.infer<typeof WorkspaceChangeEvent>) => void): () => void;
  subscribeKnowledgeEvents?(listener: () => void): () => void;
  subscribeOAuthEvents?(listener: (e: unknown) => void): () => void;
  subscribeComposioEvents?(listener: (e: unknown) => void): () => void;
  subscribeChatgptEvents?(listener: (e: unknown) => void): () => void;
  subscribeTerminalEvents?(listener: (e: { channel: 'terminal:data' | 'terminal:exit'; payload: unknown }) => void): () => void;
  subscribeTtsChunks?(listener: (e: unknown) => void): () => void;
}

export interface RowboatServerOptions {
  workDir: string;
  handlers: RpcHandlers;
  events: EventSources;
  resolveWorkspacePath: (relPath: string) => string;
  serverVersion: string;
  /** Test overrides; production callers rely on config/server.json. */
  port?: number;
  host?: string;
  helloTimeoutMs?: number;
}

export interface RowboatServer {
  port: number;
  host: string;
  lanEnabled: boolean;
  key: string;
  hub: WsHub;
  close(): Promise<void>;
}

const PORT_FALLBACK_ATTEMPTS = 10;

function listenOnce(server: HttpServer, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

// DNS-rebinding guard: a hostile page can point its own domain at 127.0.0.1
// and fetch with the browser happily sending that domain as Host. Bearer auth
// already stops it reading anything, but rejecting foreign Hosts outright is
// cheap defense-in-depth. The set is the machine's own names and addresses.
export function buildAllowedHosts(): Set<string> {
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1', os.hostname().toLowerCase()]);
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      hosts.add(info.family === 'IPv6' ? `[${info.address.toLowerCase()}]` : info.address);
    }
  }
  return hosts;
}

export function hostAllowed(hostHeader: string | undefined, allowed: Set<string>): boolean {
  if (!hostHeader) return false;
  // Strip the port: "name:3220" or "[::1]:3220".
  const host = hostHeader.replace(/:\d+$/, '').toLowerCase();
  return allowed.has(host);
}

/** Is the process answering on this port another rowboat-server? */
async function isRowboatServer(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    clearTimeout(timer);
    const body = (await res.json().catch(() => null)) as { name?: string } | null;
    return body?.name === 'rowboat-server';
  } catch {
    return false;
  }
}

export async function createRowboatServer(opts: RowboatServerOptions): Promise<RowboatServer> {
  const config = await loadServerConfig(opts.workDir);
  const key = await loadOrCreateServerKey(opts.workDir);
  const host = opts.host ?? (config.lanEnabled ? '0.0.0.0' : '127.0.0.1');
  const startPort = opts.port ?? config.port;

  // Whoever hosts the transport owns core for this workdir — a second host is
  // a split-brain, not a peer. Held until close().
  const releaseLock = await acquireWorkdirLock(opts.workDir);

  const allowedHosts = buildAllowedHosts();
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (!hostAllowed(c.req.header('host'), allowedHosts)) {
      return c.json({ error: { code: 'forbidden', message: 'unrecognized Host header' } }, 403);
    }
    await next();
    c.header('x-rowboat-api-version', '0');
  });

  // Unauthenticated on purpose: the phone probes candidate URLs with it
  // during pairing, before it can prove it holds the key.
  app.get('/health', (c) =>
    c.json({ ok: true, name: 'rowboat-server', apiVersion: 0, serverVersion: opts.serverVersion }),
  );

  app.use('*', async (c, next) => {
    const token = extractBearer(c.req.header('authorization'), c.req.query('token'));
    if (!token || !tokenMatches(token, key)) {
      return c.json({ error: { code: 'unauthorized', message: 'missing or invalid bearer token' } }, 401);
    }
    await next();
  });

  app.route('/', createRpcRoutes(opts.handlers));
  app.route('/', createWorkspaceRoutes(opts.resolveWorkspacePath));

  const httpServer = createAdaptorServer({ fetch: app.fetch }) as HttpServer;

  try {
    for (let attempt = 0; ; attempt++) {
      const tryPort = startPort + attempt;
      try {
        await listenOnce(httpServer, host, tryPort);
        break;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'EADDRINUSE' || attempt >= PORT_FALLBACK_ATTEMPTS - 1) throw err;
        // Colliding with another rowboat-server means two hosts are live —
        // that must fail loudly, never quietly bind one port over.
        if (tryPort !== 0 && (await isRowboatServer(tryPort))) {
          throw new Error(
            `another rowboat-server is already listening on port ${tryPort} — refusing to start a second instance`,
          );
        }
        console.warn(`[server] port ${tryPort} is taken by another app; trying ${tryPort + 1}`);
      }
    }
  } catch (err) {
    await releaseLock();
    throw err;
  }
  const address = httpServer.address();
  const boundPort = typeof address === 'object' && address ? address.port : startPort;

  const hub = createWsHub();
  setCapabilityTransport({
    request: (capability, payload, opts) => hub.requestCapability(capability, payload, opts),
    broadcast: (capability, payload) => hub.broadcastCapability(capability, payload),
    hasCapableClient: (capability) => hub.hasCapableClient(capability),
  });
  hub.attach(httpServer, {
    serverKey: key,
    serverVersion: opts.serverVersion,
    helloTimeoutMs: opts.helloTimeoutMs,
    allowedHosts,
  });

  const unsubscribers = [
    opts.events.subscribeTurnEvents((e) => hub.handleTurnEvent(e)),
    opts.events.subscribeSessionEvents((e) => hub.broadcast('sessions:events', e)),
    opts.events.subscribeWorkspaceEvents?.((e) => hub.broadcast('workspace:didChange', e)),
    opts.events.subscribeKnowledgeEvents?.(() => hub.broadcast('knowledge:didCommit', {})),
    opts.events.subscribeOAuthEvents?.((e) => hub.broadcast('oauth:didConnect', e)),
    opts.events.subscribeComposioEvents?.((e) => hub.broadcast('composio:didConnect', e)),
    opts.events.subscribeChatgptEvents?.((e) => hub.broadcast('chatgpt:statusChanged', e)),
    opts.events.subscribeTerminalEvents?.((e) => hub.broadcast(e.channel, e.payload)),
    opts.events.subscribeTtsChunks?.((e) => hub.broadcast('voice:tts-chunk', e)),
  ];

  return {
    port: boundPort,
    host,
    lanEnabled: config.lanEnabled,
    key,
    hub,
    close: async () => {
      for (const unsub of unsubscribers) unsub?.();
      hub.close();
      // close() alone waits for keep-alive sockets that may never end (the
      // forwarder's fetch pool, idle browser preconnects) — destroy them so
      // shutdown resolves promptly instead of hanging the process.
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeIdleConnections();
        httpServer.closeAllConnections();
      });
      await releaseLock();
    },
  };
}
