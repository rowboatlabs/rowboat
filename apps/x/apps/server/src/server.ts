import type { Server as HttpServer } from 'node:http';
import { createAdaptorServer } from '@hono/node-server';
import { Hono } from 'hono';
import type { TurnBusEvent } from '@x/shared/dist/turns.js';
import type { SessionBusEvent } from '@x/shared/dist/sessions.js';
import { WorkspaceChangeEvent } from '@x/shared/dist/workspace.js';
import { z } from 'zod';
import { extractBearer, loadOrCreateServerKey, tokenMatches } from './auth.js';
import type { RpcHandlers } from './channels.js';
import { loadServerConfig } from './config.js';
import { createRpcRoutes } from './router.js';
import { createWorkspaceRoutes } from './workspace-route.js';
import { createWsHub, type WsHub } from './ws-hub.js';

// Assembles the transport: HTTP router + workspace files + WS event hub on
// one node:http server. Deliberately does NOT boot @x/core — the host (today
// Electron main in-process, later the standalone headless entrypoint) owns
// exactly one core instance and hands its handler map and event buses in.
// That inversion is what keeps the strangler-fig slice split-brain-free.

export interface EventSources {
  subscribeTurnEvents(listener: (e: TurnBusEvent) => void): () => void;
  subscribeSessionEvents(listener: (e: SessionBusEvent) => void): () => void;
  subscribeWorkspaceEvents?(listener: (e: z.infer<typeof WorkspaceChangeEvent>) => void): () => void;
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

export async function createRowboatServer(opts: RowboatServerOptions): Promise<RowboatServer> {
  const config = await loadServerConfig(opts.workDir);
  const key = await loadOrCreateServerKey(opts.workDir);
  const host = opts.host ?? (config.lanEnabled ? '0.0.0.0' : '127.0.0.1');
  const startPort = opts.port ?? config.port;

  const app = new Hono();
  app.use('*', async (c, next) => {
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

  for (let attempt = 0; ; attempt++) {
    try {
      await listenOnce(httpServer, host, startPort + attempt);
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE' || attempt >= PORT_FALLBACK_ATTEMPTS - 1) throw err;
    }
  }
  const address = httpServer.address();
  const boundPort = typeof address === 'object' && address ? address.port : startPort;

  const hub = createWsHub();
  hub.attach(httpServer, {
    serverKey: key,
    serverVersion: opts.serverVersion,
    helloTimeoutMs: opts.helloTimeoutMs,
  });

  const unsubscribers = [
    opts.events.subscribeTurnEvents((e) => hub.handleTurnEvent(e)),
    opts.events.subscribeSessionEvents((e) => hub.broadcast('sessions:events', e)),
    opts.events.subscribeWorkspaceEvents?.((e) => hub.broadcast('workspace:didChange', e)),
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
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
