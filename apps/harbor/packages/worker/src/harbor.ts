import WebSocket from 'ws';
import type { z } from 'zod';
import {
  routes,
  type Approval,
  type ConnectorCapabilities,
  type Invocation,
  type InvocationUpdate,
  type Member,
  type Message,
  type ServerFrame,
} from '@rowboat/spaces-protocol';
import { errorText, type Logger } from './log.js';

/** What `postMessage` takes (api.ts): the body, the thread, how the author acts. */
export type NewMessage = z.input<typeof routes.postMessage.request>;

// The worker's side of the agent contract (SPEC.md §8 Invoking agent members;
// CONTRACT.md "Agent invocations"): the connector's routes on the agent's own
// key, and the live socket that brings `invocation`, `invocation_stop` and
// `approval_decided`. The same shape as the echo example and the Hermes
// plugin, in TypeScript, with nothing from the desktop app so the one file the
// bundle makes runs anywhere Node does.

export class HarborRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ThreadPage {
  root: Message;
  messages: Message[];
}

export class HarborClient {
  readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly key: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.key}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json: unknown = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      // Not JSON: reported below with the status.
    }
    if (!res.ok) {
      const err = (json ?? {}) as { code?: string; message?: string };
      throw new HarborRequestError(res.status, err.code ?? 'internal', err.message ?? `${method} ${path} answered ${res.status}`);
    }
    return json as T;
  }

  /** The agent this key belongs to. A 401 here means the key is gone: revoked, or replaced by another computer's. */
  async me(): Promise<Member> {
    return routes.me.response.parse(await this.request('GET', routes.me.path)).member;
  }

  async listAgentInvocations(): Promise<{ invocations: Invocation[]; approvals: Approval[] }> {
    return routes.listAgentInvocations.response.parse(await this.request('GET', routes.listAgentInvocations.path));
  }

  /** pending → working. Idempotent; a cancelled one answers invalid_request (drop it). */
  async acknowledge(invocationId: string): Promise<Invocation> {
    const body = await this.request('POST', `/v1/agent/invocations/${encodeURIComponent(invocationId)}/ack`);
    return routes.acknowledgeInvocation.response.parse(body).invocation;
  }

  async update(invocationId: string, update: InvocationUpdate): Promise<Invocation> {
    const body = await this.request('POST', `/v1/agent/invocations/${encodeURIComponent(invocationId)}/update`, update);
    return routes.updateInvocation.response.parse(body).invocation;
  }

  async declareCapabilities(capabilities: ConnectorCapabilities): Promise<void> {
    await this.request('POST', routes.declareCapabilities.path, capabilities);
  }

  async postMessage(spaceId: string, input: NewMessage): Promise<Message> {
    const body = await this.request('POST', `/v1/spaces/${encodeURIComponent(spaceId)}/messages`, input);
    return routes.postMessage.response.parse(body).message;
  }

  async getMessage(spaceId: string, messageId: string): Promise<Message> {
    const body = await this.request('GET', `/v1/spaces/${encodeURIComponent(spaceId)}/messages/${encodeURIComponent(messageId)}`);
    return routes.getMessage.response.parse(body).message;
  }

  async listThread(spaceId: string, rootMessageId: string, opts: { afterOffset?: number; limit?: number } = {}): Promise<ThreadPage> {
    const q = new URLSearchParams();
    if (opts.afterOffset !== undefined) q.set('afterOffset', String(opts.afterOffset));
    if (opts.limit !== undefined) q.set('limit', String(opts.limit));
    const query = q.size > 0 ? `?${q.toString()}` : '';
    const body = await this.request('GET', `/v1/spaces/${encodeURIComponent(spaceId)}/threads/${encodeURIComponent(rootMessageId)}${query}`);
    const page = routes.listThread.response.parse(body);
    return { root: page.root, messages: page.messages };
  }

  async roster(): Promise<Member[]> {
    return routes.listOrgMembers.response.parse(await this.request('GET', routes.listOrgMembers.path)).members;
  }

  /** A blob's type and size without its bytes (HEAD), for the download lines; undefined when it can't be read. */
  async blobInfo(spaceId: string, hash: string): Promise<{ mime: string; size: number } | undefined> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/spaces/${encodeURIComponent(spaceId)}/blobs/${hash}`, {
        method: 'HEAD',
        headers: { authorization: `Bearer ${this.key}` },
      });
      if (!res.ok) return undefined;
      return { mime: res.headers.get('content-type') ?? 'application/octet-stream', size: Number(res.headers.get('content-length') ?? 0) };
    } catch {
      return undefined;
    }
  }
}

// --- the live socket ------------------------------------------------------------------

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;
/** Harbor beacons every ~25s; three missed and the socket is presumed dead (a VM woke from a snapshot, a laptop slept). */
const DEFAULT_STALE_AFTER_MS = 80_000;
const DEFAULT_WATCHDOG_MS = 15_000;

export interface HarborLiveOptions {
  baseUrl: string;
  key: string;
  onFrame: (frame: ServerFrame) => void;
  onOpen?: () => void;
  onClose?: () => void;
  log: Logger;
  staleAfterMs?: number;
  watchdogMs?: number;
}

/**
 * One WebSocket on the agent's key, reconnecting on its own: the frame is the
 * fast path, the worker's one-minute list the guarantee, so a dropped socket
 * costs latency, never a turn. Silence longer than the stale window bounces
 * it, because a socket that only reads can stay half-open forever after the
 * machine it is on was snapshotted and resumed.
 */
export class HarborLive {
  private ws: WebSocket | undefined;
  private attempt = 0;
  private closed = false;
  private lastTraffic = 0;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private reconnect: ReturnType<typeof setTimeout> | undefined;
  status: 'connecting' | 'open' | 'closed' = 'closed';

  constructor(private readonly opts: HarborLiveOptions) {}

  start(): void {
    this.closed = false;
    this.connect();
    this.watchdog = setInterval(() => {
      if (this.status === 'open' && Date.now() - this.lastTraffic > (this.opts.staleAfterMs ?? DEFAULT_STALE_AFTER_MS)) {
        this.opts.log('live socket silent; bouncing it');
        this.ws?.terminate();
      }
    }, this.opts.watchdogMs ?? DEFAULT_WATCHDOG_MS);
    this.watchdog.unref?.();
  }

  close(): void {
    this.closed = true;
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.reconnect) clearTimeout(this.reconnect);
    this.ws?.terminate();
    this.ws = undefined;
    this.status = 'closed';
  }

  private connect(): void {
    if (this.closed) return;
    const url = `${this.opts.baseUrl.replace(/^http/, 'ws').replace(/\/+$/, '')}/v1/live`;
    this.status = 'connecting';
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${this.opts.key}` } });
    this.ws = ws;
    ws.on('open', () => {
      this.attempt = 0;
      this.lastTraffic = Date.now();
      this.status = 'open';
      this.opts.onOpen?.();
    });
    ws.on('message', (data) => {
      this.lastTraffic = Date.now();
      let frame: ServerFrame;
      try {
        frame = JSON.parse(String(data)) as ServerFrame;
      } catch {
        return;
      }
      if (frame.kind === 'ping') return;
      this.opts.onFrame(frame);
    });
    ws.on('error', (err) => this.opts.log('live socket error', { error: errorText(err) }));
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      const wasOpen = this.status === 'open';
      this.status = 'closed';
      if (wasOpen) this.opts.onClose?.();
      if (this.closed) return;
      const wait = Math.min(BACKOFF_BASE_MS * 2 ** this.attempt, BACKOFF_CAP_MS) * (0.75 + Math.random() / 2);
      this.attempt += 1;
      this.reconnect = setTimeout(() => this.connect(), wait);
      this.reconnect.unref?.();
    });
  }
}
