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

export type PushChannel = 'turns:events' | 'sessions:events' | 'workspace:didChange';

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
]);

interface Connection {
  socket: WebSocket;
  seq: number;
  helloed: boolean;
  deltaSubs: Set<string>;
}

const HELLO_TIMEOUT_MS = 5000;

// Close codes (4xxx = application-defined).
export const WS_CLOSE_UNAUTHORIZED = 4401;
export const WS_CLOSE_NO_HELLO = 4400;

export interface WsHub {
  attach(
    server: HttpServer,
    opts: { path?: string; serverKey: string; serverVersion: string; helloTimeoutMs?: number },
  ): void;
  /** Broadcast a push-channel event to every fully-connected client. */
  broadcast(channel: PushChannel, payload: unknown): void;
  /** Route one turn-spine event: durable → broadcast, delta → subscribers only. */
  handleTurnEvent(event: TurnBusEvent): void;
  connectionCount(): number;
  close(): void;
}

export function createWsHub(): WsHub {
  const connections = new Set<Connection>();
  let wss: WebSocketServer | null = null;

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
      const conn: Connection = { socket, seq: 0, helloed: false, deltaSubs: new Set() };
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

  return {
    attach,
    broadcast,
    handleTurnEvent,
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
