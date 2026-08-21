import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventsClient, type EventsClient } from '@x/client';
import type { TurnBusEvent } from '@x/shared/dist/turns.js';
import type { RpcHandlers } from './channels.js';
import { RPC_CHANNELS } from './channels.js';
import { createRowboatServer, type EventSources, type RowboatServer } from './server.js';

// Integration: the real @x/client events client against the real transport —
// the exact pairing the phone app ships with.

function makeEmitter<T>() {
  const listeners = new Set<(e: T) => void>();
  return {
    subscribe: (l: (e: T) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    emit: (e: T) => {
      for (const l of listeners) l(e);
    },
  };
}

const stubHandlers = Object.fromEntries(
  RPC_CHANNELS.map((ch) => [ch, () => Promise.reject(new Error('unused'))]),
) as unknown as RpcHandlers;

const durable = (turnId: string, offset: number): TurnBusEvent =>
  ({ turnId, sessionId: 's1', offset, event: { type: 'turn_created' } }) as unknown as TurnBusEvent;
const delta = (turnId: string): TurnBusEvent =>
  ({ turnId, sessionId: 's1', event: { type: 'text_delta', text: 'x' } }) as unknown as TurnBusEvent;

const waitFor = async (predicate: () => boolean, ms = 5000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe('events client ↔ rowboat-server', () => {
  let workDir: string;
  let server: RowboatServer;
  let client: EventsClient;
  const turnBus = makeEmitter<TurnBusEvent>();
  const sessionBus = makeEmitter<never>();
  const events: EventSources = {
    subscribeTurnEvents: turnBus.subscribe,
    subscribeSessionEvents: sessionBus.subscribe,
  };

  const makeServer = (port: number) =>
    createRowboatServer({
      workDir,
      handlers: stubHandlers,
      events,
      resolveWorkspacePath: (rel) => path.join(workDir, rel),
      serverVersion: 'test',
      port,
    });

  beforeAll(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rowboat-events-client-'));
    server = await makeServer(0);
  });

  afterAll(async () => {
    client?.close();
    await server.close();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('connects, receives durable events, and gates deltas on subscription', async () => {
    client = createEventsClient({
      baseUrl: `http://127.0.0.1:${server.port}`,
      token: server.key,
      clientName: 'test',
    });
    const received: TurnBusEvent[] = [];
    client.on('turns:events', (p) => received.push(p as TurnBusEvent));
    await waitFor(() => client.status() === 'connected');

    turnBus.emit(durable('t1', 1));
    turnBus.emit(delta('t1'));
    await waitFor(() => received.length === 1);
    expect(received[0].offset).toBe(1);

    const release = client.subscribeTurnDeltas('t1');
    await new Promise((r) => setTimeout(r, 100)); // let subscribe reach the hub
    turnBus.emit(delta('t1'));
    await waitFor(() => received.length === 2);
    expect(received[1].event.type).toBe('text_delta');

    release();
    await new Promise((r) => setTimeout(r, 100));
    turnBus.emit(delta('t1'));
    turnBus.emit(durable('t1', 2));
    await waitFor(() => received.length === 3);
    expect(received[2].offset).toBe(2); // the delta after release never arrived
  });

  it('reconnects after a server restart, fires resync, re-arms delta subs', async () => {
    const port = server.port;
    let resyncs = 0;
    client.onResync(() => (resyncs += 1));
    const release = client.subscribeTurnDeltas('t2');

    await server.close();
    await waitFor(() => client.status() !== 'connected');
    server = await makeServer(port);
    client.reconnectNow();
    await waitFor(() => client.status() === 'connected', 10_000);
    expect(resyncs).toBeGreaterThanOrEqual(1);

    // Delta subscription survived the reconnect without a new subscribe call.
    const received: TurnBusEvent[] = [];
    client.on('turns:events', (p) => received.push(p as TurnBusEvent));
    await new Promise((r) => setTimeout(r, 100));
    turnBus.emit(delta('t2'));
    await waitFor(() => received.length === 1);
    expect(received[0].turnId).toBe('t2');
    release();
  });
});
