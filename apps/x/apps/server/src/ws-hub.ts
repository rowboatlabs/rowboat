import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { isDurableTurnEvent, type TurnBusEvent } from '@x/shared/dist/turns.js';
import { extractBearer, tokenMatches } from './auth.js';

// One WebSocket at /events carries every push channel. Delivery mirrors the
// Electron-window semantics in apps/main/src/ipc.ts: durable events broadcast
// to every authenticated client; high-volume turn deltas (text_delta /
// reasoning_delta) go only to connections that subscribed to that turnId.
//
// Every server→client message is stamped with a per-connection monotonic
// `seq`. Broadcast is fire-and-forget with no replay buffer — a client that
// detects a gap refetches what it displays (the event-sourced turn design
// makes that exact; see @x/shared turn-follower).

export type PushChannel =
  | 'turns:events'
  | 'sessions:events'
  | 'workspace:didChange'
  | 'knowledge:didCommit'
  | 'oauth:didConnect'
  | 'composio:didConnect'
  | 'chatgpt:statusChanged'
  | 'terminal:data'
  | 'terminal:exit'
  | 'voice:tts-chunk';

const ClientMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    v: z.literal(1),
    client: z.object({ name: z.string(), version: z.string().optional() }).optional(),
    // Declared but unused in v1 — the handshake slot for reverse-call
    // capabilities (notifications, browser-control) per the RFC.
    capabilities: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal('subscribe'),
    topic: z.literal('turn-deltas'),
    turnId: z.string(),
  }),
  z.object({
    type: z.literal('unsubscribe'),
    topic: z.literal('turn-deltas'),
    turnId: z.string(),
  }),
  // Reply to a server→client capability request (RFC Q14 reverse calls).
  z.object({
    type: z.literal('capability-response'),
    id: z.string(),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
]);

interface Connection {
  socket: WebSocket;
  seq: number;
  helloed: boolean;
  deltaSubs: Set<string>;
  capabilities: Set<string>;
}

const HELLO_TIMEOUT_MS = 5000;

// Close codes (4xxx = application-defined).
export const WS_CLOSE_UNAUTHORIZED = 4401;
export const WS_CLOSE_NO_HELLO = 4400;

const CAPABILITY_TIMEOUT_MS = 30_000;

export interface WsHub {
  attach(
    server: HttpServer,
    opts: {
      path?: string;
      serverKey: string;
      serverVersion: string;
      helloTimeoutMs?: number;
      /** When set, upgrades with a foreign Host header are refused (DNS-rebinding guard). */
      allowedHosts?: Set<string>;
    },
  ): void;
  /** Broadcast a push-channel event to every fully-connected client. */
  broadcast(channel: PushChannel, payload: unknown): void;
  /** Route one turn-spine event: durable → broadcast, delta → subscribers only. */
  handleTurnEvent(event: TurnBusEvent): void;
  /** Reverse call: ask one client advertising `capability` to act; await its reply. */
  requestCapability(capability: string, payload: unknown, opts?: { timeoutMs?: number }): Promise<unknown>;
  /** Fire-and-forget a capability event to every advertising client. */
  broadcastCapability(capability: string, payload: unknown): void;
  hasCapableClient(capability: string): boolean;
  connectionCount(): number;
  close(): void;
}

export function createWsHub(): WsHub {
  const connections = new Set<Connection>();
  let wss: WebSocketServer | null = null;
  let nextRequestId = 0;
  const pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  const capableConnection = (capability: string): Connection | undefined => {
    // Most recently connected capable client wins (matches "the window the
    // user is looking at" heuristic well enough for a v1 router).
    let found: Connection | undefined;
    for (const conn of connections) {
      if (conn.helloed && conn.capabilities.has(capability)) found = conn;
    }
    return found;
  };

  const send = (conn: Connection, message: Record<string, unknown>) => {
    if (conn.socket.readyState !== WebSocket.OPEN) return;
    conn.seq += 1;
    conn.socket.send(JSON.stringify({ seq: conn.seq, ...message }));
  };

  const broadcast = (channel: PushChannel, payload: unknown) => {
    for (const conn of connections) {
      if (conn.helloed) send(conn, { type: 'event', channel, payload });
    }
  };

  const handleTurnEvent = (event: TurnBusEvent) => {
    if (isDurableTurnEvent(event.event)) {
      broadcast('turns:events', event);
      return;
    }
    for (const conn of connections) {
      if (conn.helloed && conn.deltaSubs.has(event.turnId)) {
        send(conn, { type: 'event', channel: 'turns:events', payload: event });
      }
    }
  };

  const attach: WsHub['attach'] = (server, opts) => {
    const wsPath = opts.path ?? '/events';
    wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname !== wsPath) {
        socket.destroy();
        return;
      }
      if (opts.allowedHosts) {
        const hostHeader = request.headers.host?.replace(/:\d+$/, '').toLowerCase();
        if (!hostHeader || !opts.allowedHosts.has(hostHeader)) {
          socket.destroy();
          return;
        }
      }
      const token = extractBearer(request.headers.authorization, url.searchParams.get('token'));
      if (!token || !tokenMatches(token, opts.serverKey)) {
        // Complete the handshake so the client sees a clean close code
        // instead of a socket error, then reject.
        wss!.handleUpgrade(request, socket, head, (ws) => {
          ws.close(WS_CLOSE_UNAUTHORIZED, 'unauthorized');
        });
        return;
      }
      wss!.handleUpgrade(request, socket, head, (ws) => {
        wss!.emit('connection', ws, request);
      });
    });

    wss.on('connection', (socket: WebSocket) => {
      const conn: Connection = { socket, seq: 0, helloed: false, deltaSubs: new Set(), capabilities: new Set() };
      connections.add(conn);

      const helloTimer = setTimeout(() => {
        if (!conn.helloed) socket.close(WS_CLOSE_NO_HELLO, 'hello required');
      }, opts.helloTimeoutMs ?? HELLO_TIMEOUT_MS);

      socket.on('message', (data) => {
        let parsed: z.infer<typeof ClientMessage>;
        try {
          parsed = ClientMessage.parse(JSON.parse(String(data)));
        } catch {
          send(conn, { type: 'error', code: 'bad_message', message: 'unrecognized message' });
          return;
        }
        switch (parsed.type) {
          case 'hello':
            if (!conn.helloed) {
              conn.helloed = true;
              for (const cap of parsed.capabilities ?? []) conn.capabilities.add(cap);
              clearTimeout(helloTimer);
              send(conn, {
                type: 'welcome',
                apiVersion: 0,
                serverVersion: opts.serverVersion,
                capabilities: [],
              });
            }
            break;
          case 'subscribe':
            conn.deltaSubs.add(parsed.turnId);
            break;
          case 'unsubscribe':
            conn.deltaSubs.delete(parsed.turnId);
            break;
          case 'capability-response': {
            const pending = pendingRequests.get(parsed.id);
            if (pending) {
              pendingRequests.delete(parsed.id);
              clearTimeout(pending.timer);
              if (parsed.ok) pending.resolve(parsed.result);
              else pending.reject(new Error(parsed.error ?? 'capability request failed'));
            }
            break;
          }
        }
      });

      socket.on('close', () => {
        clearTimeout(helloTimer);
        connections.delete(conn);
      });
      socket.on('error', () => {
        clearTimeout(helloTimer);
        connections.delete(conn);
      });
    });
  };

  const requestCapability: WsHub['requestCapability'] = (capability, payload, opts) => {
    const conn = capableConnection(capability);
    if (!conn) {
      return Promise.reject(new Error(`no client connected that provides '${capability}'`));
    }
    const id = `cap-${++nextRequestId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(`capability '${capability}' request timed out`));
      }, opts?.timeoutMs ?? CAPABILITY_TIMEOUT_MS);
      pendingRequests.set(id, { resolve, reject, timer });
      send(conn, { type: 'capability-request', id, capability, payload });
    });
  };

  const broadcastCapability: WsHub['broadcastCapability'] = (capability, payload) => {
    for (const conn of connections) {
      if (conn.helloed && conn.capabilities.has(capability)) {
        send(conn, { type: 'capability-request', id: `cap-${++nextRequestId}`, capability, payload, fireAndForget: true });
      }
    }
  };

  return {
    attach,
    broadcast,
    handleTurnEvent,
    requestCapability,
    broadcastCapability,
    hasCapableClient: (capability) => capableConnection(capability) !== undefined,
    connectionCount: () => connections.size,
    close: () => {
      for (const conn of connections) {
        conn.socket.close(1001, 'server shutting down');
      }
      connections.clear();
      wss?.close();
      wss = null;
    },
  };
}
