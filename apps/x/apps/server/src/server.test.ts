import fs from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { TurnBusEvent } from '@x/shared/dist/turns.js';
import type { RpcHandlers } from './channels.js';
import { RPC_CHANNELS } from './channels.js';
import { createRowboatServer, type EventSources, type RowboatServer } from './server.js';
import { WS_CLOSE_NO_HELLO, WS_CLOSE_UNAUTHORIZED } from './ws-hub.js';

type Listener<T> = (e: T) => void;

function makeEmitter<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    subscribe: (l: Listener<T>) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    emit: (e: T) => {
      for (const l of listeners) l(e);
    },
  };
}

// Full handler map: every exposed channel throws unless a test overrides it.
function stubHandlers(overrides: Partial<RpcHandlers>): RpcHandlers {
  const base = Object.fromEntries(
    RPC_CHANNELS.map((ch) => [
      ch,
      () => {
        throw new Error(`no stub for ${ch}`);
      },
    ]),
  );
  return { ...base, ...overrides } as RpcHandlers;
}

const durable = (turnId: string, offset: number): TurnBusEvent =>
  ({ turnId, sessionId: 's1', offset, event: { type: 'turn_created' } }) as unknown as TurnBusEvent;
const delta = (turnId: string): TurnBusEvent =>
  ({ turnId, sessionId: 's1', event: { type: 'text_delta', text: 'x' } }) as unknown as TurnBusEvent;

interface WsProbe {
  socket: WebSocket;
  messages: Array<Record<string, unknown>>;
  next(predicate?: (m: Record<string, unknown>) => boolean): Promise<Record<string, unknown>>;
  closed: Promise<number>;
}

function connect(url: string, opts?: { token?: string; hello?: boolean }): WsProbe {
  const socket = new WebSocket(
    url,
    opts?.token ? { headers: { authorization: `Bearer ${opts.token}` } } : undefined,
  );
  const messages: Array<Record<string, unknown>> = [];
  const waiters: Array<{ predicate: (m: Record<string, unknown>) => boolean; resolve: (m: Record<string, unknown>) => void }> = [];
  socket.on('message', (data) => {
    const msg = JSON.parse(String(data)) as Record<string, unknown>;
    messages.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].predicate(msg)) {
        waiters.splice(i, 1)[0].resolve(msg);
      }
    }
  });
  const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)));
  if (opts?.hello) {
    socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', v: 1, client: { name: 'test' } })));
  }
  return {
    socket,
    messages,
    closed,
    next: (predicate = () => true) => {
      const already = messages.find(predicate);
      if (already) return Promise.resolve(already);
      return new Promise((resolve) => waiters.push({ predicate, resolve }));
    },
  };
}

describe('rowboat-server transport', () => {
  let workDir: string;
  let server: RowboatServer;
  let base: string;
  const turnBus = makeEmitter<TurnBusEvent>();
  const sessionBus = makeEmitter<never>();

  const events: EventSources = {
    subscribeTurnEvents: turnBus.subscribe,
    subscribeSessionEvents: sessionBus.subscribe,
  };

  beforeAll(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rowboat-server-test-'));
    await fs.mkdir(path.join(workDir, 'notes'), { recursive: true });
    await fs.writeFile(path.join(workDir, 'notes', 'hello.md'), '# hi\n');
    server = await createRowboatServer({
      workDir,
      handlers: stubHandlers({
        'sessions:list': async () => ({ sessions: [] }),
      }),
      events,
      resolveWorkspacePath: (rel) => {
        if (rel.includes('..') || rel.startsWith('forbidden') || path.isAbsolute(rel)) {
          throw new Error('traversal');
        }
        return path.join(workDir, rel);
      },
      serverVersion: 'test',
      port: 0, // let the OS pick a free port
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  const authed = (init?: RequestInit): RequestInit => ({
    ...init,
    headers: { ...(init?.headers as Record<string, string>), authorization: `Bearer ${server.key}` },
  });

  it('serves /health unauthenticated', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, apiVersion: 0 });
    expect(res.headers.get('x-rowboat-api-version')).toBe('0');
  });

  it('rejects rpc without a bearer token', async () => {
    const res = await fetch(`${base}/rpc/sessions:list`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('rejects a wrong bearer token', async () => {
    const res = await fetch(`${base}/rpc/sessions:list`, {
      method: 'POST',
      headers: { authorization: 'Bearer nope' },
    });
    expect(res.status).toBe(401);
  });

  it('answers an allowlisted channel', async () => {
    const res = await fetch(`${base}/rpc/sessions:list`, authed({ method: 'POST', body: '{}' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessions: [] });
  });

  it('404s channels outside the allowlist without leaking the surface', async () => {
    for (const channel of ['models:list', 'no-such-channel', 'turns:subscribe']) {
      const res = await fetch(`${base}/rpc/${channel}`, authed({ method: 'POST', body: '{}' }));
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('unknown_channel');
    }
  });

  it('400s a payload that fails the request schema', async () => {
    const res = await fetch(
      `${base}/rpc/sessions:get`,
      authed({ method: 'POST', body: JSON.stringify({ wrong: true }) }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_request');
  });

  it('500s a handler failure with the internal code', async () => {
    const res = await fetch(
      `${base}/rpc/sessions:get`,
      authed({ method: 'POST', body: JSON.stringify({ sessionId: 's1' }) }),
    );
    expect(res.status).toBe(500);
  });

  it('serves workspace files with auth and blocks traversal', async () => {
    const ok = await fetch(`${base}/workspace/notes/hello.md`, authed());
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('# hi\n');
    expect(ok.headers.get('content-type')).toContain('text/markdown');

    const noAuth = await fetch(`${base}/workspace/notes/hello.md`);
    expect(noAuth.status).toBe(401);

    // Dot segments (raw or percent-encoded) are collapsed by WHATWG URL
    // parsing inside the node adapter before routing, so a traversal path
    // never reaches the handler — assert it can't leak a file either way.
    const traversal = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: server.port,
          path: '/workspace/notes/../../../../etc/passwd',
          headers: { authorization: `Bearer ${server.key}` },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect([403, 404]).toContain(traversal.status);
    expect(traversal.body).not.toContain('root:');

    // The handler's own guard: resolver refusals map to 403.
    const refused = await fetch(`${base}/workspace/forbidden/x.md`, authed());
    expect(refused.status).toBe(403);

    const missing = await fetch(`${base}/workspace/notes/nope.md`, authed());
    expect(missing.status).toBe(404);
  });

  it('closes unauthorized websockets with 4401', async () => {
    const probe = connect(`ws://127.0.0.1:${server.port}/events`);
    expect(await probe.closed).toBe(WS_CLOSE_UNAUTHORIZED);
  });

  it('accepts ?token= for browser clients', async () => {
    const probe = connect(`ws://127.0.0.1:${server.port}/events?token=${server.key}`, { hello: true });
    const welcome = await probe.next((m) => m.type === 'welcome');
    expect(welcome.seq).toBe(1);
    probe.socket.close();
  });

  it('broadcasts durable turn events, routes deltas to subscribers only, seq stays monotonic', async () => {
    const sub = connect(`ws://127.0.0.1:${server.port}/events`, { token: server.key, hello: true });
    const bystander = connect(`ws://127.0.0.1:${server.port}/events`, { token: server.key, hello: true });
    await sub.next((m) => m.type === 'welcome');
    await bystander.next((m) => m.type === 'welcome');

    sub.socket.send(JSON.stringify({ type: 'subscribe', topic: 'turn-deltas', turnId: 't1' }));
    // subscribe is fire-and-forget; give the server a beat to process it
    await new Promise((r) => setTimeout(r, 50));

    turnBus.emit(durable('t1', 1));
    turnBus.emit(delta('t1'));
    turnBus.emit(durable('t1', 2));

    await sub.next((m) => {
      const p = m.payload as { offset?: number } | undefined;
      return m.type === 'event' && p?.offset === 2;
    });
    await bystander.next((m) => {
      const p = m.payload as { offset?: number } | undefined;
      return m.type === 'event' && p?.offset === 2;
    });

    const subEvents = sub.messages.filter((m) => m.type === 'event');
    const bystanderEvents = bystander.messages.filter((m) => m.type === 'event');
    expect(subEvents).toHaveLength(3); // durable + delta + durable
    expect(bystanderEvents).toHaveLength(2); // durable only

    const seqs = sub.messages.map((m) => m.seq as number);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);

    sub.socket.close();
    bystander.socket.close();
  });

  it('drops clients that never say hello', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rowboat-hello-test-'));
    const quick = await createRowboatServer({
      workDir: tmp,
      handlers: stubHandlers({}),
      events,
      resolveWorkspacePath: (rel) => path.join(tmp, rel),
      serverVersion: 'test',
      port: 0,
      helloTimeoutMs: 100,
    });
    const probe = connect(`ws://127.0.0.1:${quick.port}/events`, { token: quick.key });
    expect(await probe.closed).toBe(WS_CLOSE_NO_HELLO);
    await quick.close();
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
