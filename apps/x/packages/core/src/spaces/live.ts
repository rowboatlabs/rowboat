import { ServerFrame, type PresenceState } from '@rowboat/spaces-protocol';

// The live face, client side: ONE WebSocket per org (CONTRACT.md decision 2),
// per-space subscriptions, offset-based resume. The socket owns reconnection;
// each subscription remembers the last durable offset it saw, so a reconnect
// resubscribes with afterOffset = lastSeen and the server replays exactly the
// gap. Uses the runtime's native WebSocket (Electron main / Node ≥22).
//
// Liveness: a socket that only READS can stay half-open forever — after a
// laptop sleeps or the network path changes, no close event ever arrives, the
// socket reports OPEN, and every event published meanwhile vanishes. The
// server beacons {kind:'ping'} every ~25s, so ANY received frame refreshes
// lastTraffic and prolonged silence means the socket is dead: the watchdog
// bounces it (drop → reconnect → replay from lastOffset). Because timers
// fire immediately after wake, sleep recovery is automatic; bounce() lets the
// host force it (Electron powerMonitor resume).

export type SpacesLiveStatus = 'connecting' | 'open' | 'closed';

export type SpaceFrameHandler = (frame: ServerFrame) => void;

interface Subscription {
  lastOffset: number | undefined; // undefined = live-only (no replay on first subscribe)
  handlers: Set<SpaceFrameHandler>;
}

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;
/** ~3 missed server beacons (25s cadence) before a silent socket is presumed dead. */
const DEFAULT_STALE_AFTER_MS = 80_000;
const DEFAULT_WATCHDOG_TICK_MS = 15_000;

export interface SpacesLiveOptions {
  /** http(s)://host[:port] — same base as the REST client. */
  baseUrl: string;
  /** Static bearer (dev tokens, tests) or a provider — resolved fresh per connection attempt. */
  token: string | (() => Promise<string>);
  /** Injection point for tests; defaults to the global WebSocket. */
  webSocketImpl?: typeof WebSocket;
  /** Frame-silence tolerated before the watchdog bounces the socket (test knob). */
  staleAfterMs?: number;
  /** Watchdog cadence (test knob). */
  watchdogTickMs?: number;
}

export class SpacesLive {
  private readonly wsBase: string;
  private readonly token: string | (() => Promise<string>);
  private readonly WebSocketImpl: typeof WebSocket;
  private readonly staleAfterMs: number;
  private readonly watchdogTickMs: number;
  private ws: WebSocket | undefined;
  private connecting = false;
  private subs = new Map<string, Subscription>();
  private statusHandlers = new Set<(status: SpacesLiveStatus) => void>();
  private attempts = 0;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private lastTraffic = 0;

  constructor(options: SpacesLiveOptions) {
    this.wsBase = options.baseUrl.replace(/\/$/, '').replace(/^http/, 'ws');
    this.token = options.token;
    this.WebSocketImpl = options.webSocketImpl ?? WebSocket;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.watchdogTickMs = options.watchdogTickMs ?? DEFAULT_WATCHDOG_TICK_MS;
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

  /**
   * Send one ephemeral whiteboard frame (scene diff, cursor, idle state).
   * Same posture as presence: silently dropped when the socket is down — the
   * collab loop's periodic full-scene rebroadcast and snapshot reconciliation
   * absorb the gap, so a lost frame costs smoothness, not data.
   */
  whiteboard(spaceId: string, boardId: string, payload: unknown): void {
    if (this.ws?.readyState === this.WebSocketImpl.OPEN) {
      this.ws.send(JSON.stringify({ kind: 'whiteboard', spaceId, boardId, payload }));
    }
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = undefined;
    this.ws?.close();
    this.ws = undefined;
    this.setStatus('closed');
  }

  /**
   * Drop the current socket and reconnect immediately, replaying from the
   * last seen offsets. For moments the host KNOWS the connection is suspect —
   * wake from sleep, a network change — where waiting out the watchdog would
   * leave a silent gap. A no-op when nothing is connected (the reconnect
   * machinery is already on it).
   */
  bounce(): void {
    if (this.closed || !this.ws) return;
    this.attempts = 0;
    this.dropSocket(this.ws);
  }

  /** Detach + discard a socket and get reconnection going. Safe on already-dead sockets. */
  private dropSocket(ws: WebSocket): void {
    if (this.ws === ws) this.ws = undefined;
    try {
      ws.close();
    } catch {
      // a torn socket may throw on close; it is already as dead as we need
    }
    if (this.closed) return;
    this.setStatus('connecting');
    this.scheduleReconnect();
  }

  private ensureWatchdog(): void {
    if (this.watchdog) return;
    this.watchdog = setInterval(() => {
      // After sleep this timer fires promptly on wake, sees the huge silence
      // gap, and bounces — so recovery needs no OS-specific hooks to work.
      const ws = this.ws;
      if (!ws || ws.readyState !== this.WebSocketImpl.OPEN) return;
      if (Date.now() - this.lastTraffic > this.staleAfterMs) {
        this.attempts = 0;
        this.dropSocket(ws);
      }
    }, this.watchdogTickMs);
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
    this.ensureWatchdog();

    ws.addEventListener('open', () => {
      if (this.ws !== ws) return; // a bounced socket finishing its handshake late
      this.attempts = 0;
      this.lastTraffic = Date.now();
      this.setStatus('open');
      // Resubscribe everything with the last offsets we saw — replay fills the gap.
      for (const [spaceId, sub] of this.subs) this.sendSubscribe(spaceId, sub);
    });

    ws.addEventListener('message', (event: MessageEvent) => {
      if (this.ws !== ws) return; // frames from a dropped socket must not touch state
      // ANY frame is proof of life — the server's ping beacon included, and
      // frames that fail to parse below still count (bytes arrived).
      this.lastTraffic = Date.now();
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
      // A watchdog-dropped socket already dispatched reconnection; its
      // eventual close must not disturb the replacement.
      if (this.ws !== ws) return;
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
