import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpacesLive } from './live.js';

// Incoming frames are schema-parsed; ids must be shape-valid (SpaceId is a ULID).
const SPACE_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

// Recovery tests: every wedge here was a REAL production state — the live
// client dark forever while REST kept working, which silently killed all
// presence ("Rowboat is working…" chips included) and live frames.

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  url: string;
  sent: string[] = [];
  private listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, fn: (event: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close', {});
  }

  emit(type: string, event: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', {});
  }
}

class ThrowingWebSocket {
  static OPEN = 1;
  static attempts = 0;
  constructor() {
    ThrowingWebSocket.attempts += 1;
    throw new Error('no dice');
  }
  addEventListener(): void {}
}

function makeLive(opts?: {
  token?: string | (() => Promise<string>);
  impl?: unknown;
  staleAfterMs?: number;
  watchdogTickMs?: number;
  tokenTimeoutMs?: number;
}): SpacesLive {
  return new SpacesLive({
    baseUrl: 'https://org.example',
    token: opts?.token ?? 'tok',
    webSocketImpl: (opts?.impl ?? FakeWebSocket) as typeof WebSocket,
    staleAfterMs: opts?.staleAfterMs ?? 1_000,
    watchdogTickMs: opts?.watchdogTickMs ?? 100,
    tokenTimeoutMs: opts?.tokenTimeoutMs ?? 500,
  });
}

/** Let the async token/connect hop inside ensureConnected run. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  ThrowingWebSocket.attempts = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SpacesLive recovery', () => {
  it('abandons a token resolution that never settles and retries with backoff', async () => {
    let calls = 0;
    const live = makeLive({
      token: () => {
        calls += 1;
        // First resolution hangs FOREVER (an un-timed-out refresh fetch on a
        // dead network); later ones succeed.
        return calls === 1 ? new Promise<never>(() => {}) : Promise.resolve('tok');
      },
    });
    live.subscribe('space-1', () => {});
    await settle();
    expect(FakeWebSocket.instances).toHaveLength(0);

    // Past the token timeout + reconnect backoff: a fresh attempt must run —
    // `connecting` was previously pinned true here forever.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toBeGreaterThan(1);
    expect(FakeWebSocket.instances.length).toBeGreaterThan(0);
    live.close();
  });

  it('watchdog revives a client whose connect attempt died scheduling nothing', async () => {
    const live = makeLive({ impl: ThrowingWebSocket });
    live.subscribe('space-1', () => {});
    await settle();
    const first = ThrowingWebSocket.attempts;
    expect(first).toBeGreaterThan(0);

    // Constructor throw → scheduleReconnect → throw again → … the loop must
    // keep trying (backoff-capped), not stop after the first death.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(ThrowingWebSocket.attempts).toBeGreaterThan(first);
    live.close();
  });

  it('drops a socket stuck in CONNECTING once it goes stale', async () => {
    const live = makeLive();
    live.subscribe('space-1', () => {});
    await settle();
    expect(FakeWebSocket.instances).toHaveLength(1);
    // Never opens — a handshake hung by a vanished network path.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
    live.close();
  });

  it('presence while disconnected kick-starts the connection instead of dropping forever', async () => {
    const live = makeLive();
    // No subscriptions at all — the agent-presence path (topic agent holds no
    // subscription of its own, it only renews a working lease every 10s).
    live.presence('space-1', 'agent_working', 'root-1');
    await settle();
    expect(FakeWebSocket.instances).toHaveLength(1);

    FakeWebSocket.instances[0].open();
    // The dropped frame is gone (droppable by contract) but the NEXT renewal
    // rides the socket the first one opened.
    live.presence('space-1', 'agent_working', 'root-1');
    expect(FakeWebSocket.instances[0].sent.map((s) => JSON.parse(s).kind)).toContain('presence');
    live.close();
  });

  it('bounce reconnects immediately even when no socket object exists', async () => {
    let calls = 0;
    const live = makeLive({
      token: () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('offline')) : Promise.resolve('tok');
      },
    });
    live.subscribe('space-1', () => {});
    await settle();
    expect(FakeWebSocket.instances).toHaveLength(0); // failed, waiting out backoff

    live.bounce(); // wake-from-sleep: reconnect NOW — used to be a no-op here
    await settle();
    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0].open();
    expect(FakeWebSocket.instances[0].sent.map((s) => JSON.parse(s).kind)).toContain('subscribe');
    live.close();
  });

  it('reconnect resubscribes with the last seen offset', async () => {
    const live = makeLive();
    const frames: unknown[] = [];
    live.subscribe(SPACE_ULID, (frame) => frames.push(frame), 5);
    await settle();
    const first = FakeWebSocket.instances[0];
    first.open();
    expect(JSON.parse(first.sent[0])).toEqual({ kind: 'subscribe', spaceId: SPACE_ULID, afterOffset: 5 });
    first.emit('message', {
      data: JSON.stringify({
        kind: 'event',
        spaceId: SPACE_ULID,
        offset: 6,
        at: '2026-01-01T00:00:00.000Z',
        event: {
          type: 'membership',
          membership: { spaceId: SPACE_ULID, memberId: 'm-1', joinedAt: '2026-01-01T00:00:00.000Z' },
          action: 'joined',
        },
      }),
    });
    expect(frames.some((f) => (f as { kind?: string }).kind === 'event')).toBe(true);

    first.close(); // server drop → reconnect
    // Past the max backoff jitter (1s at attempt 0) but inside the stale
    // window, so the reconnect attempt exists and hasn't been recycled yet.
    await vi.advanceTimersByTimeAsync(1_100);
    const second = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    expect(second).not.toBe(first);
    second.open();
    expect(JSON.parse(second.sent[0])).toEqual({ kind: 'subscribe', spaceId: SPACE_ULID, afterOffset: 6 });
    live.close();
  });
});
