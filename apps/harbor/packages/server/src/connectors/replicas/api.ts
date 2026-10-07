import type { AgentEvent } from '../common/agent-events.js';

// The Replicas API, as its OpenAPI documents it (https://docs.replicas.dev/openapi.json,
// "Replica API 2.0.0", read 2026-09-30), for the Replicas connector (spec §8
// Connectors). Only what the connector calls. The key is an organization
// bearer key; creation pins the dated API version so it returns at once with
// a `preparing` workspace instead of blocking until it boots.

export const REPLICAS_API = 'https://api.replicas.dev';
const API_VERSION = '2026-05-17';

/** A refusal from Replicas, classified by what the connector does about it. */
export class ReplicasError extends Error {
  constructor(
    /** HTTP status; 0 = no response (network, timeout). */
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
  /** 401: the key is invalid or revoked; 402: the trial or the minutes ran out. The owner must act. */
  get rejectsKey(): boolean {
    return this.status === 401 || this.status === 402;
  }
  /** 429 on create: the org's 100 active API workspaces. */
  get atCapacity(): boolean {
    return this.status === 429;
  }
  /** 404: the workspace is gone (Replicas deletes idle ones after 30 days). */
  get gone(): boolean {
    return this.status === 404;
  }
  /** Replicas or the network is having trouble: worth retrying. */
  get transient(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

export interface ReplicasEnvironment {
  id: string;
  name: string;
}

/** An image for the coding agent: a URL Replicas fetches, or the bytes. */
export type ReplicasImage =
  | { type: 'image'; source: { type: 'url'; url: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string } };

export type { AgentEvent };

/** Replicas's `coding_agent` for each kind it runs. */
export const CODING_AGENTS: Record<string, string> = {
  'claude-code': 'claude',
  codex: 'codex',
  cursor: 'cursor',
  opencode: 'opencode',
  pi: 'pi',
  'muse-code': 'muse',
};

/** One event from a workspace's stream (EngineEvent): `type` discriminates `payload`. */
export interface EngineEvent {
  id?: string;
  ts?: string;
  type: string;
  payload?: Record<string, unknown>;
}

export interface ReplicasChat {
  id: string;
  provider?: string;
  processing?: boolean;
}

export interface ReplicasApi {
  environments(): Promise<ReplicasEnvironment[]>;
  create(input: {
    name: string;
    environmentId: string;
    codingAgent: string;
    message: string;
    planMode: boolean;
    images: ReplicasImage[];
  }): Promise<{ id: string }>;
  send(
    workspaceId: string,
    input: { chatId?: string; message: string; planMode: boolean; images: ReplicasImage[] },
  ): Promise<{ messageId: string | null; chatId: string | null }>;
  /** Workspaces this key created through the API, newest first. */
  recent(limit: number): Promise<Array<{ id: string; name: string }>>;
  chats(workspaceId: string): Promise<ReplicasChat[]>;
  /** The newest `limit` events of a chat's history. */
  history(workspaceId: string, chatId: string, limit: number): Promise<AgentEvent[]>;
  /** The workspace's event stream until `signal` aborts or the stream ends. */
  events(workspaceId: string, signal: AbortSignal): AsyncGenerator<EngineEvent>;
}

export function replicasApi(key: string, base = REPLICAS_API): ReplicasApi {
  const headers = { authorization: `Bearer ${key}`, 'x-replicas-api-version': API_VERSION };

  async function call<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: init.method ?? 'GET',
        headers: { ...headers, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
      });
    } catch (err) {
      throw new ReplicasError(0, `Replicas could not be reached: ${(err as Error).message}`);
    }
    if (!res.ok) throw new ReplicasError(res.status, await errorText(res));
    return (await res.json()) as T;
  }

  return {
    async environments() {
      // "Global" (is_global) is the layer merged under every environment, not one to work in.
      const body = await call<{ environments?: Array<{ id: string; name: string; is_global?: boolean }> }>('/v1/environments');
      return (body.environments ?? []).filter((e) => e.is_global !== true).map(({ id, name }) => ({ id, name }));
    },
    async create(input) {
      const body = await call<{ replica: { id: string } }>('/v1/replica', {
        method: 'POST',
        body: {
          name: input.name,
          environment_id: input.environmentId,
          coding_agent: input.codingAgent,
          message: input.message,
          plan_mode: input.planMode,
          ...(input.images.length > 0 ? { images: input.images } : {}),
        },
      });
      return { id: body.replica.id };
    },
    async send(workspaceId, input) {
      const body = await call<{ message_id: string | null; chat_id: string | null }>(`/v1/replica/${encodeURIComponent(workspaceId)}/messages`, {
        method: 'POST',
        body: {
          message: input.message,
          plan_mode: input.planMode,
          ...(input.chatId ? { chat_id: input.chatId } : {}),
          ...(input.images.length > 0 ? { images: input.images } : {}),
        },
      });
      return { messageId: body.message_id ?? null, chatId: body.chat_id ?? null };
    },
    async recent(limit) {
      const body = await call<{ replicas?: Array<{ id: string; name: string }> }>(`/v1/replica?source=api&limit=${limit}`);
      return (body.replicas ?? []).map(({ id, name }) => ({ id, name }));
    },
    async chats(workspaceId) {
      const body = await call<{ chats?: ReplicasChat[] }>(`/v1/replica/${encodeURIComponent(workspaceId)}/chats`);
      return body.chats ?? [];
    },
    async history(workspaceId, chatId, limit) {
      const body = await call<{ events?: AgentEvent[] }>(
        `/v1/replica/${encodeURIComponent(workspaceId)}/history?chat_id=${encodeURIComponent(chatId)}&limit=${limit}`,
      );
      return body.events ?? [];
    },
    async *events(workspaceId, signal) {
      let res: Response;
      try {
        res = await fetch(`${base}/v1/replica/${encodeURIComponent(workspaceId)}/events`, {
          headers: { ...headers, accept: 'text/event-stream' },
          redirect: 'error',
          signal,
        });
      } catch (err) {
        if (signal.aborted) return;
        throw new ReplicasError(0, `Replicas's event stream could not be reached: ${(err as Error).message}`);
      }
      if (!res.ok || !res.body) throw new ReplicasError(res.status, await errorText(res));
      yield* parseServerSentEvents(res.body, signal);
    },
  };
}

/** `data: <JSON>\n\n` frames (a 15-second ping keeps the stream open; comments and other fields are skipped). */
export async function* parseServerSentEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<EngineEvent> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = '';
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data) continue;
        try {
          const event = JSON.parse(data) as EngineEvent;
          if (event && typeof event.type === 'string') yield event;
        } catch {
          // Not JSON (a ping or a malformed frame): skip it.
        }
      }
    }
  } catch (err) {
    if (signal.aborted) return;
    throw new ReplicasError(0, `Replicas's event stream broke: ${(err as Error).message}`);
  } finally {
    reader.releaseLock();
  }
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; details?: string | null };
    return [body.error, body.details].filter(Boolean).join(': ') || `Replicas answered ${res.status}`;
  } catch {
    return `Replicas answered ${res.status}`;
  }
}
