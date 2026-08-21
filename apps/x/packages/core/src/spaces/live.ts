import { ServerFrame, type PresenceState } from '@rowboat/spaces-protocol';

// The live face, client side: ONE WebSocket per org (CONTRACT.md decision 2),
// per-space subscriptions, offset-based resume. The socket owns reconnection;
// each subscription remembers the last durable offset it saw, so a reconnect
// resubscribes with afterOffset = lastSeen and the server replays exactly the
// gap. Uses the runtime's native WebSocket (Electron main / Node ≥22).

export type SpacesLiveStatus = 'connecting' | 'open' | 'closed';

export type SpaceFrameHandler = (frame: ServerFrame) => void;

interface Subscription {
  lastOffset: number | undefined; // undefined = live-only (no replay on first subscribe)
  handlers: Set<SpaceFrameHandler>;
}

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;

export interface SpacesLiveOptions {
  /** http(s)://host[:port] — same base as the REST client. */
  baseUrl: string;
  /** Static bearer (dev tokens, tests) or a provider — resolved fresh per connection attempt. */
  token: string | (() => Promise<string>);
  /** Injection point for tests; defaults to the global WebSocket. */
  webSocketImpl?: typeof WebSocket;
}

export class SpacesLive {
  private readonly wsBase: string;
  private readonly token: string | (() => Promise<string>);
  private readonly WebSocketImpl: typeof WebSocket;
  private ws: WebSocket | undefined;
  private connecting = false;
  private subs = new Map<string, Subscription>();
  private statusHandlers = new Set<(status: SpacesLiveStatus) => void>();
  private attempts = 0;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: SpacesLiveOptions) {
    this.wsBase = options.baseUrl.replace(/\/$/, '').replace(/^http/, 'ws');
    this.token = options.token;
    this.WebSocketImpl = options.webSocketImpl ?? WebSocket;
  }

  status: SpacesLiveStatus = 'closed';

  onStatus(handler: (status: SpacesLiveStatus) => void): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  private setStatus(status: SpacesLiveStatus): void {
    this.status = status;
    for (const h of this.statusHandlers) h(status);
  }

  /**
   * Subscribe to a space. `afterOffset` asks for replay of everything after it
   * (pass the last offset your view has seen; omit for live-only). The handler
   * receives every frame scoped to the space, `subscribed` and `error` included.
   */
  subscribe(spaceId: string, handler: SpaceFrameHandler, afterOffset?: number): () => void {
    let sub = this.subs.get(spaceId);
    const isNew = !sub;
    if (!sub) {
      sub = { lastOffset: afterOffset, handlers: new Set() };
      this.subs.set(spaceId, sub);
    } else if (afterOffset !== undefined && (sub.lastOffset === undefined || afterOffset < sub.lastOffset)) {
      sub.lastOffset = afterOffset;
    }
    sub.handlers.add(handler);

    if (isNew && this.ws?.readyState === this.WebSocketImpl.OPEN) {
      this.sendSubscribe(spaceId, sub);
    }
    this.ensureConnected();

    return () => {
      const s = this.subs.get(spaceId);
      if (!s) return;
      s.handlers.delete(handler);
      if (s.handlers.size === 0) {
        this.subs.delete(spaceId);
        if (this.ws?.readyState === this.WebSocketImpl.OPEN) {
          this.ws.send(JSON.stringify({ kind: 'unsubscribe', spaceId }));
        }
      }
    };
  }

  presence(spaceId: string, state: PresenceState, topicId?: string): void {
    if (this.ws?.readyState === this.WebSocketImpl.OPEN) {
      this.ws.send(
        JSON.stringify({ kind: 'presence', spaceId, state, ...(topicId !== undefined ? { topicId } : {}) }),
      );
    }
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = undefined;
    this.setStatus('closed');
  }

  private sendSubscribe(spaceId: string, sub: Subscription): void {
    this.ws?.send(
      JSON.stringify({
        kind: 'subscribe',
        spaceId,
        ...(sub.lastOffset !== undefined ? { afterOffset: sub.lastOffset } : {}),
      }),
    );
  }

  private ensureConnected(): void {
    if (this.closed || this.ws || this.connecting) return;
    this.connecting = true;
    this.setStatus('connecting');
    void (async () => {
      let token: string;
      try {
        token = typeof this.token === 'string' ? this.token : await this.token();
      } catch {
        // Token source failed (refresh dead → org needs re-login). Back off
        // like a connection failure so a later re-auth resumes the stream.
        this.connecting = false;
        this.scheduleReconnect();
        return;
      }
      this.connecting = false;
      if (this.closed || this.ws) return;
      this.openSocket(`${this.wsBase}/v1/live?token=${encodeURIComponent(token)}`);
    })();
  }

  private openSocket(wsUrl: string): void {
    const ws = new this.WebSocketImpl(wsUrl);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.attempts = 0;
      this.setStatus('open');
      // Resubscribe everything with the last offsets we saw — replay fills the gap.
      for (const [spaceId, sub] of this.subs) this.sendSubscribe(spaceId, sub);
    });

    ws.addEventListener('message', (event: MessageEvent) => {
      let frame: ServerFrame;
      try {
        frame = ServerFrame.parse(JSON.parse(String(event.data)));
      } catch {
        return; // a frame we don't understand is not a reason to drop the socket
      }
      const spaceId = 'spaceId' in frame ? frame.spaceId : undefined;
      if (!spaceId) return;
      const sub = this.subs.get(spaceId);
      if (!sub) return;
      if (frame.kind === 'event') sub.lastOffset = frame.offset;
      for (const h of sub.handlers) h(frame);
    });

    ws.addEventListener('close', () => {
      this.ws = undefined;
      if (this.closed) return;
      this.setStatus('connecting');
      this.scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      // close fires after error; reconnect is handled there
    });
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    const delay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** this.attempts) * (0.5 + Math.random() * 0.5);
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.subs.size > 0 || this.statusHandlers.size > 0) this.ensureConnected();
    }, delay);
  }
}
