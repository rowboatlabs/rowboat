import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { ClientFrame, type ServerFrame } from '@rowboat/spaces-protocol';
import type { AuthDriver } from './auth.js';
import { HarborError } from './errors.js';
import type { SpaceHub } from './hub.js';
import type { HarborService } from './service.js';
import type { Store } from './store.js';

// The live face (CONTRACT.md decision 2): one WebSocket per org, per-space
// subscriptions, offset-based resume. subscribe{afterOffset} replays durable
// events after that offset then goes live; presence is ephemeral pass-through.
//
// Liveness is two-sided. Every HEARTBEAT_MS the server (a) sends a protocol
// ping and terminates connections that produced no pong or traffic since the
// last beat — dead clients stop holding hub subscriptions — and (b) sends the
// JSON {kind:'ping'} frame, which is the CLIENT'S evidence of life: a laptop
// that slept or changed networks holds a half-open socket that will never see
// a close event, so prolonged frame-silence is what tells it to bounce.

interface Deps {
  service: HarborService;
  hub: SpaceHub;
  store: Store;
  auth: AuthDriver;
}

const DEFAULT_HEARTBEAT_MS = 25_000;

interface LiveSocket extends WebSocket {
  /** False until the next pong/message proves the peer is still there. */
  sawLifeSinceLastBeat?: boolean;
}

/**
 * Resolves the org runtime for a connection — multi-org deployments route by
 * Host (spec §4 tenancy); the single-org server ignores the host. Undefined =
 * no org on that domain.
 */
export type LiveDepsResolver = (host: string | undefined) => Deps | undefined | Promise<Deps | undefined>;

export function attachLive(
  server: Server,
  resolve: LiveDepsResolver,
  opts: { heartbeatMs?: number } = {},
): () => void {
  const wss = new WebSocketServer({ noServer: true });

  const heartbeat = setInterval(() => {
    const at = new Date().toISOString();
    const beacon = JSON.stringify({ kind: 'ping', at });
    for (const client of wss.clients as Set<LiveSocket>) {
      if (client.sawLifeSinceLastBeat === false) {
        client.terminate();
        continue;
      }
      client.sawLifeSinceLastBeat = false;
      client.ping();
      if (client.readyState === WebSocket.OPEN) client.send(beacon);
    }
  }, opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/v1/live') {
      socket.destroy();
      return;
    }
    // Auth completes BEFORE handleUpgrade: the client hasn't seen 101 yet, so
    // no frames can arrive while we're on the auth/store round trips — the
    // old race (subscribe sent before listeners attach) is now structurally
    // impossible. Nobody reads the socket during the await; bytes just buffer.
    socket.on('error', () => {});
    void (async () => {
      let deps: Deps | undefined;
      let memberId: string;
      try {
        const forwarded = req.headers['x-forwarded-host'];
        deps = await resolve(typeof forwarded === 'string' ? forwarded : req.headers.host);
        if (!deps) {
          socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        const identity = await deps.auth.authenticate(req.headers.authorization, url.searchParams.get('token'));
        memberId = (await deps.auth.resolveMember(deps.store, identity)).id;
      } catch (err) {
        const status = err instanceof HarborError && err.status === 403 ? '403 Forbidden' : '401 Unauthorized';
        socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
        socket.destroy();
        return;
      }
      if (socket.destroyed) return;
      wss.handleUpgrade(req, socket, head, (ws) => {
        handleConnection(ws, memberId, deps);
      });
    })();
  });

  return () => {
    clearInterval(heartbeat);
    for (const client of wss.clients) client.terminate();
    wss.close();
  };
}

function handleConnection(ws: LiveSocket, memberId: string, deps: Deps): void {
  const subscriptions = new Map<string, () => void>();

  ws.sawLifeSinceLastBeat = true;
  ws.on('pong', () => {
    ws.sawLifeSinceLastBeat = true;
  });

  const send = (frame: ServerFrame): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  };
  const sendError = (code: string, message: string, spaceId?: string): void => {
    send({ kind: 'error', ...(spaceId ? { spaceId } : {}), code, message });
  };

  ws.on('message', (data) => {
    ws.sawLifeSinceLastBeat = true;
    void (async () => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(data));
      } catch {
        sendError('invalid_request', 'frame is not valid JSON');
        return;
      }
      const parsed = ClientFrame.safeParse(raw);
      if (!parsed.success) {
        sendError('invalid_request', 'frame does not match ClientFrame');
        return;
      }
      const frame = parsed.data;

      try {
        switch (frame.kind) {
          case 'subscribe': {
            // Re-subscribing replaces the previous subscription (fresh resume point).
            subscriptions.get(frame.spaceId)?.();
            subscriptions.delete(frame.spaceId);

            await deps.service.requireMember({ memberId }, frame.spaceId);

            // Register on the hub BEFORE replaying so nothing published during
            // replay is lost; buffer until replay completes, dedupe by offset.
            const state = { live: false, lastSent: 0, buffer: [] as ServerFrame[] };
            const unsubscribe = deps.hub.subscribe(frame.spaceId, (f) => {
              if (!state.live) {
                state.buffer.push(f);
              } else if (f.kind !== 'event' || f.offset > state.lastSent) {
                if (f.kind === 'event') state.lastSent = f.offset;
                send(f);
              }
            });
            subscriptions.set(frame.spaceId, unsubscribe);

            const head = await deps.service.headOffset(frame.spaceId);
            const fromOffset = frame.afterOffset ?? head;
            send({ kind: 'subscribed', spaceId: frame.spaceId, fromOffset });

            if (frame.afterOffset !== undefined) {
              for (const e of await deps.service.eventsAfter(frame.spaceId, frame.afterOffset)) {
                send({ kind: 'event', spaceId: frame.spaceId, offset: e.offset, at: e.at, event: e.event });
                state.lastSent = e.offset;
              }
            } else {
              state.lastSent = head;
            }
            for (const f of state.buffer) {
              if (f.kind !== 'event' || f.offset > state.lastSent) {
                if (f.kind === 'event') state.lastSent = f.offset;
                send(f);
              }
            }
            state.buffer = [];
            state.live = true;
            break;
          }
          case 'unsubscribe': {
            subscriptions.get(frame.spaceId)?.();
            subscriptions.delete(frame.spaceId);
            break;
          }
          case 'presence': {
            await deps.service.publishPresence({ memberId }, frame.spaceId, frame.state, frame.topicId);
            break;
          }
        }
      } catch (err) {
        if (err instanceof HarborError) sendError(err.code, err.message, frame.spaceId);
        else sendError('internal', 'unexpected error', frame.spaceId);
      }
    })();
  });

  ws.on('close', () => {
    for (const unsubscribe of subscriptions.values()) unsubscribe();
    subscriptions.clear();
  });
}
