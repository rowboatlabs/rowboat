import type { turns } from '@x/shared';

// WebSocket client for the rowboat-server /events feed. Mirrors the wire
// protocol in @x/server ws-hub.ts: hello → welcome, seq-stamped messages,
// per-turn delta subscriptions. Handles what Electron IPC never had to —
// drops, reconnects, and gaps — with the RFC's refetch-on-reconnect model:
// this client only *detects* gaps; consumers (turn-follower, list views)
// refetch what they display.

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type PushChannel = 'turns:events' | 'sessions:events' | 'workspace:didChange';

interface ServerMessage {
  seq: number;
  type: 'welcome' | 'event' | 'error';
  channel?: PushChannel;
  payload?: unknown;
}

export interface EventsClient {
  /** Listen to one push channel. Returns unsubscribe. */
  on(channel: PushChannel, listener: (payload: unknown) => void): () => void;
  onStatus(listener: (status: ConnectionStatus) => void): () => void;
  /**
   * Fired after a reconnect or a seq gap — consumers must refetch what they
   * display (snapshots make this exact; there is no server replay).
   */
  onResync(listener: () => void): () => void;
  /** Refcounted turn-delta subscription (text/reasoning deltas for one turn). */
  subscribeTurnDeltas(turnId: string): () => void;
  status(): ConnectionStatus;
  /** Force an immediate reconnect attempt (e.g. app returned to foreground). */
  reconnectNow(): void;
  close(): void;
}

const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

export function createEventsClient(opts: {
  baseUrl: string;
  token: string;
  clientName: string;
  clientVersion?: string;
  /** Fired on a 4401 close — the server key was rotated; stop reconnecting. */
  onUnauthorized?: () => void;
}): EventsClient {
  const wsUrl = `${opts.baseUrl.replace(/\/+$/, '').replace(/^http/, 'ws')}/events`;

  const channelListeners = new Map<PushChannel, Set<(payload: unknown) => void>>();
  const statusListeners = new Set<(status: ConnectionStatus) => void>();
  const resyncListeners = new Set<() => void>();
  const deltaRefs = new Map<string, number>();

  let socket: WebSocket | null = null;
  let currentStatus: ConnectionStatus = 'connecting';
  let lastSeq = 0;
  let everConnected = false;
  let backoff = BACKOFF_MIN_MS;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const setStatus = (status: ConnectionStatus) => {
    if (status === currentStatus) return;
    currentStatus = status;
    for (const l of statusListeners) l(status);
  };

  const fireResync = () => {
    for (const l of resyncListeners) l();
  };

  const send = (message: Record<string, unknown>) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  };

  const connect = () => {
    if (closed) return;
    setStatus('connecting');
    lastSeq = 0;
    // React Native's WebSocket accepts a headers option; browsers don't.
    // The ?token= fallback works everywhere, so use it unconditionally.
    const ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(opts.token)}`);
    socket = ws;

    ws.onopen = () => {
      send({
        type: 'hello',
        v: 1,
        client: { name: opts.clientName, version: opts.clientVersion },
        capabilities: [],
      });
    };

    ws.onmessage = (event: MessageEvent) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (typeof msg.seq === 'number') {
        if (lastSeq !== 0 && msg.seq !== lastSeq + 1) {
          // Transport-level gap: something was dropped between stamped
          // messages. Tell consumers to refetch; keep the socket.
          fireResync();
        }
        lastSeq = msg.seq;
      }
      if (msg.type === 'welcome') {
        backoff = BACKOFF_MIN_MS;
        setStatus('connected');
        // Re-arm delta subscriptions that outlived the previous socket, and
        // let consumers reconcile anything missed while disconnected.
        for (const turnId of deltaRefs.keys()) {
          send({ type: 'subscribe', topic: 'turn-deltas', turnId });
        }
        if (everConnected) fireResync();
        everConnected = true;
        return;
      }
      if (msg.type === 'event' && msg.channel) {
        const listeners = channelListeners.get(msg.channel);
        if (listeners) {
          for (const l of listeners) l(msg.payload);
        }
      }
    };

    const scheduleRetry = () => {
      if (closed || retryTimer) return;
      setStatus('disconnected');
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, backoff);
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    };

    ws.onclose = (event: { code?: number }) => {
      if (event?.code === 4401) {
        closed = true;
        setStatus('disconnected');
        opts.onUnauthorized?.();
        return;
      }
      scheduleRetry();
    };
    ws.onerror = () => {
      // onclose follows onerror; nothing else to do here.
    };
  };

  connect();

  return {
    on(channel, listener) {
      let set = channelListeners.get(channel);
      if (!set) {
        set = new Set();
        channelListeners.set(channel, set);
      }
      set.add(listener);
      return () => set.delete(listener);
    },
    onStatus(listener) {
      statusListeners.add(listener);
      listener(currentStatus);
      return () => statusListeners.delete(listener);
    },
    onResync(listener) {
      resyncListeners.add(listener);
      return () => resyncListeners.delete(listener);
    },
    subscribeTurnDeltas(turnId) {
      const refs = deltaRefs.get(turnId) ?? 0;
      deltaRefs.set(turnId, refs + 1);
      if (refs === 0) {
        send({ type: 'subscribe', topic: 'turn-deltas', turnId });
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const current = deltaRefs.get(turnId) ?? 0;
        if (current <= 1) {
          deltaRefs.delete(turnId);
          send({ type: 'unsubscribe', topic: 'turn-deltas', turnId });
        } else {
          deltaRefs.set(turnId, current - 1);
        }
      };
    },
    status: () => currentStatus,
    reconnectNow() {
      if (closed || currentStatus === 'connected') return;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      backoff = BACKOFF_MIN_MS;
      socket?.close();
      connect();
    },
    close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
      setStatus('disconnected');
    },
  };
}

/**
 * Adapts the events client to the turn-follower's `subscribe` dependency:
 * filters turns:events to TurnBusEvents and manages the delta subscription
 * for the followed turn alongside.
 */
export function turnFeedFromEvents(
  events: EventsClient,
): (listener: (e: turns.TurnBusEvent) => void) => () => void {
  return (listener) => {
    const offEvents = events.on('turns:events', (payload) => {
      listener(payload as turns.TurnBusEvent);
    });
    return offEvents;
  };
}
