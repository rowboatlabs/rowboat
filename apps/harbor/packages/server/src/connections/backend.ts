import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ConnectionTriggerType } from '@rowboat/spaces-protocol';

// The control plane's side of a space connection (spec §8 Space connections,
// 2026-11-28): rowboatx-backend holds the Composio key, so the app's
// authorisation, its trigger instances and Composio's webhook all live there,
// and Harbor asks for them over its internal routes on the operator's key,
// the one billing.ts already presents. The backend forwards each event to
// Harbor signed with that same key, so no second secret is shared. Contract:
// rowboatx-backend packages/api/README.md, Spaces channel connections.
//
// `ref` is the connection's id: the backend keys the app's account and its
// triggers on it, and never learns the space or the org.

export interface BackendApp {
  slug: string;
  name: string;
  logo?: string;
  description?: string;
  triggersCount: number;
  /** Whether Composio provides the OAuth app: without it a person cannot authorise from a link. */
  managedAuth: boolean;
}

export interface ConnectionsBackend {
  /** One page of the app catalogue, most used first. */
  apps(opts?: { search?: string; cursor?: string }): Promise<{ items: BackendApp[]; nextCursor?: string }>;
  triggerTypes(app: string): Promise<ConnectionTriggerType[]>;
  /** A hosted address where a person authorises the app for this connection. Billed to `customer`, so refused without credits. */
  link(ref: string, input: { customer: string; app: string }): Promise<{ accountId: string; redirectUrl: string }>;
  /** The account's status in Composio's words (INITIATED, ACTIVE, FAILED, EXPIRED, …); undefined when it is gone. */
  account(ref: string, accountId: string): Promise<{ status: string } | undefined>;
  createTrigger(ref: string, input: { customer: string; accountId: string; slug: string; config: Record<string, unknown>; deliverUrl: string }): Promise<{ triggerId: string }>;
  deleteTrigger(ref: string, triggerId: string): Promise<void>;
  /** Everything the backend holds for the connection: its triggers and its accounts. Idempotent. */
  deleteConnection(ref: string): Promise<void>;
  /** Whether a delivery was signed by the control plane, recently. */
  verify(delivery: { timestamp: string | undefined; signature: string | undefined; body: string }): boolean;
}

export class ConnectionsBackendError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 30_000;
/** A signed delivery older or newer than this is refused: a captured one cannot be replayed later. */
export const DELIVERY_TOLERANCE_S = 300;

/** `v1=<hex HMAC-SHA256 of "<timestamp>.<body>">`, keyed with the shared internal key. */
export function signDelivery(key: string, timestamp: string, body: string): string {
  return `v1=${createHmac('sha256', key).update(`${timestamp}.${body}`).digest('hex')}`;
}

export function verifyDelivery(key: string, delivery: { timestamp: string | undefined; signature: string | undefined; body: string }, nowMs = Date.now()): boolean {
  const { timestamp, signature, body } = delivery;
  if (!timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > DELIVERY_TOLERANCE_S) return false;
  const expected = Buffer.from(signDelivery(key, timestamp, body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function httpConnectionsBackend(options: { url: string; key: string; fetch?: typeof fetch }): ConnectionsBackend {
  const base = `${options.url.replace(/\/+$/, '')}/internal/composio`;
  const doFetch = options.fetch ?? fetch;

  async function call<T>(method: string, path: string, body?: unknown, accept: number[] = []): Promise<{ status: number; data: T }> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${options.key}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new ConnectionsBackendError(0, `the control plane could not be reached: ${(err as Error).message}`);
    }
    const data = (await res.json().catch(() => ({}))) as T & { error?: unknown };
    if (!res.ok && !accept.includes(res.status)) {
      throw new ConnectionsBackendError(res.status, typeof data?.error === 'string' ? data.error : `the control plane answered ${res.status}`);
    }
    return { status: res.status, data };
  }
  const connection = (ref: string) => `/connections/${encodeURIComponent(ref)}`;

  return {
    async apps(opts = {}) {
      const query = new URLSearchParams();
      if (opts.search) query.set('search', opts.search);
      if (opts.cursor) query.set('cursor', opts.cursor);
      const { data } = await call<{ items?: BackendApp[]; nextCursor?: string }>('GET', `/apps${query.size > 0 ? `?${query}` : ''}`);
      return { items: data.items ?? [], ...(data.nextCursor ? { nextCursor: data.nextCursor } : {}) };
    },
    async triggerTypes(app) {
      const { data } = await call<{ items?: ConnectionTriggerType[] }>('GET', `/apps/${encodeURIComponent(app)}/triggers`);
      return data.items ?? [];
    },
    async link(ref, input) {
      const { data } = await call<{ accountId: string; redirectUrl: string }>('POST', `${connection(ref)}/link`, input);
      return { accountId: data.accountId, redirectUrl: data.redirectUrl };
    },
    async account(ref, accountId) {
      const { status, data } = await call<{ status?: string }>('GET', `${connection(ref)}/accounts/${encodeURIComponent(accountId)}`, undefined, [404]);
      return status === 404 || typeof data.status !== 'string' ? undefined : { status: data.status };
    },
    async createTrigger(ref, input) {
      const { data } = await call<{ triggerId: string }>('POST', `${connection(ref)}/triggers`, input);
      return { triggerId: data.triggerId };
    },
    async deleteTrigger(ref, triggerId) {
      await call('DELETE', `${connection(ref)}/triggers/${encodeURIComponent(triggerId)}`, undefined, [404]);
    },
    async deleteConnection(ref) {
      await call('DELETE', connection(ref), undefined, [404]);
    },
    verify: (delivery) => verifyDelivery(options.key, delivery),
  };
}

/** The deployment's control plane, when it says where it is: the same two variables billing reads. */
export function connectionsBackendFromEnv(): ConnectionsBackend | undefined {
  const url = process.env.HARBOR_BILLING_URL?.trim();
  const key = process.env.HARBOR_BILLING_KEY?.trim();
  return url && key ? httpConnectionsBackend({ url, key }) : undefined;
}
