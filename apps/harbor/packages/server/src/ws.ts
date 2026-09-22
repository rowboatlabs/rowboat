import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { ClientFrame, type ServerFrame } from '@rowboat/spaces-protocol';
import { authenticateRequest, type OrgAuth } from './auth.js';
import { HarborError } from './errors.js';
import type { SpaceHub } from './hub.js';
import type { HarborService } from './service.js';
import type { LiveStats } from './stats.js';

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
//
// Backpressure is one rule: a socket whose unsent bytes exceed MAX_BUFFERED_BYTES
// is terminated rather than queued onto. A stalled peer (lid shut, tunnel) stops
// draining TCP while whiteboard relay keeps producing ~30 frames/s per editor
// plus full-scene syncs, and `ws` would hold all of it in process memory until
// the heartbeat reaps the socket. Dropping is safe: the client reconnects and
// replays durable events from its last offset; ephemeral frames were never
// promised (the board self-heals on its next full sync).

export interface LiveDeps {
  service: HarborService;
  hub: SpaceHub;
  auth: OrgAuth;
}

const DEFAULT_HEARTBEAT_MS = 25_000;
const DEFAULT_MAX_BUFFERED_BYTES = 2 * 1024 * 1024;

interface LiveSocket extends WebSocket {
  /** False until the next pong/message proves the peer is still there. */
  sawLifeSinceLastBeat?: boolean;
}

/**
 * Resolves the org runtime for a connection — multi-org deployments route by
 * Host (spec §4 tenancy); the single-org server ignores the host. Undefined =
 * no org on that domain.
 */
export type LiveDepsResolver = (host: string | undefined) => LiveDeps | undefined | Promise<LiveDeps | undefined>;

export function attachLive(
  server: Server,
  resolve: LiveDepsResolver,
  opts: { heartbeatMs?: number; maxBufferedBytes?: number; stats?: LiveStats } = {},
): () => void {
  const wss = new WebSocketServer({ noServer: true });
  const maxBufferedBytes = opts.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
  const stats = opts.stats;

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
      let deps: LiveDeps | undefined;
      let memberId: string;
      try {
        const forwarded = req.headers['x-forwarded-host'];
        deps = await resolve(typeof forwarded === 'string' ? forwarded : req.headers.host);
        if (!deps) {
          socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        const credentials = { authorization: req.headers.authorization, queryToken: url.searchParams.get('token') };
        memberId = (await authenticateRequest(deps.auth, credentials)).member.id;
      } catch (err) {
        const status = err instanceof HarborError && err.status === 403 ? '403 Forbidden' : '401 Unauthorized';
        socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
        socket.destroy();
        return;
      }
      if (socket.destroyed) return;
      wss.handleUpgrade(req, socket, head, (ws) => {
        handleConnection(ws, memberId, deps, maxBufferedBytes, stats);
      });
    })();
  });

  return () => {
    clearInterval(heartbeat);
    for (const client of wss.clients) client.terminate();
    wss.close();
  };
}

function handleConnection(
  ws: LiveSocket,
  memberId: string,
  deps: LiveDeps,
  maxBufferedBytes: number,
  stats: LiveStats | undefined,
): void {
  const subscriptions = new Map<string, () => void>();
  /** The one way a subscription ends, so the count (stats.ts) cannot drift from the map. */
  const drop = (spaceId: string): void => {
    const unsubscribe = subscriptions.get(spaceId);
    if (!unsubscribe) return;
    unsubscribe();
    subscriptions.delete(spaceId);
    stats?.unsubscribed();
  };

  stats?.connectionOpened();
  ws.sawLifeSinceLastBeat = true;
  ws.on('pong', () => {
    ws.sawLifeSinceLastBeat = true;
  });

  const send = (frame: ServerFrame): void => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > maxBufferedBytes) {
      // Stalled peer: drop it now rather than buffer without bound (see header).
      // terminate() fires 'close', which releases every hub subscription.
      ws.terminate();
      return;
    }
    ws.send(JSON.stringify(frame));
  };
  const sendError = (code: string, message: string, spaceId?: string): void => {
    send({ kind: 'error', ...(spaceId ? { spaceId } : {}), code, message });
  };

  // Member-addressed frames ride no space subscription: space_added is about
  // a space you could not have subscribed to yet, and space_removed ends the
  // one you hold — dropped here, before the frame is forwarded, so nothing
  // from that space follows your departure (2026-09-22).
  const unsubscribeMember = deps.hub.subscribeMember(memberId, (frame) => {
    if (frame.kind === 'space_removed') drop(frame.spaceId);
    send(frame);
  });

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
            drop(frame.spaceId);

            // Register on the hub BEFORE the catch-up read so nothing published
            // during it is lost; buffer until it completes, dedupe by offset.
            // The read IS the gate (service.replay): a non-member's listener is
            // torn down below having sent nothing — `live` is still false.
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
            stats?.subscribed();

            let replay: Awaited<ReturnType<HarborService['replay']>>;
            try {
              replay = await deps.service.replay({ memberId }, frame.spaceId, frame.afterOffset);
            } catch (err) {
              drop(frame.spaceId);
              throw err;
            }
            const fromOffset = frame.afterOffset ?? replay.head;
            send({ kind: 'subscribed', spaceId: frame.spaceId, fromOffset });

            state.lastSent = fromOffset;
            for (const e of replay.events) {
              send({ kind: 'event', spaceId: frame.spaceId, offset: e.offset, at: e.at, event: e.event });
              state.lastSent = e.offset;
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
            drop(frame.spaceId);
            break;
          }
          case 'presence': {
            await deps.service.publishPresence({ memberId }, frame.spaceId, frame.state, frame.threadRootId);
            break;
          }
          case 'whiteboard': {
            await deps.service.publishWhiteboard({ memberId }, frame.spaceId, frame.boardId, frame.payload);
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
    unsubscribeMember();
    for (const spaceId of [...subscriptions.keys()]) drop(spaceId);
    stats?.connectionClosed();
  });
}
