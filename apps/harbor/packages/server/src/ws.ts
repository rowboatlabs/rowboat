import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { ClientFrame, type ServerFrame } from '@rowboat/spaces-protocol';
import { ensureMember, parseDevToken } from './auth.js';
import { HarborError } from './errors.js';
import type { SpaceHub } from './hub.js';
import type { HarborService } from './service.js';
import type { Store } from './store.js';

// The live face (CONTRACT.md decision 2): one WebSocket per org, per-space
// subscriptions, offset-based resume. subscribe{afterOffset} replays durable
// events after that offset then goes live; presence is ephemeral pass-through.

interface Deps {
  service: HarborService;
  hub: SpaceHub;
  store: Store;
}

export function attachLive(server: Server, deps: Deps): () => void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/v1/live') {
      socket.destroy();
      return;
    }
    let memberId: string;
    try {
      memberId = parseDevToken(req.headers.authorization, url.searchParams.get('token'));
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleConnection(ws, memberId, deps);
    });
  });

  return () => {
    for (const client of wss.clients) client.terminate();
    wss.close();
  };
}

async function handleConnection(ws: WebSocket, memberId: string, deps: Deps): Promise<void> {
  // Listeners MUST attach before any await: a client's subscribe sent right
  // after open arrives while ensureMember is still on its Postgres round trip,
  // and an unattached listener means the frame is silently dropped. Handlers
  // await `ready` instead (in-memory stores resolve it instantly; the race
  // only bites on real I/O).
  const ready = ensureMember(deps.store, memberId);
  const subscriptions = new Map<string, () => void>();

  const send = (frame: ServerFrame): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  };
  const sendError = (code: string, message: string, spaceId?: string): void => {
    send({ kind: 'error', ...(spaceId ? { spaceId } : {}), code, message });
  };

  ws.on('message', (data) => {
    void (async () => {
      await ready;
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
