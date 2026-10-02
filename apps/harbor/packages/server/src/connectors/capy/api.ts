// The Capy API, as its OpenAPI documents it (https://docs.capy.ai/openapi.json,
// "Capy API 1.0.0", read 2026-10-02), for the Capy connector (spec §8
// Connectors). Only what the connector calls. The key (`capy_…`) is scoped to
// one organization and acts as a person or a service user
// (https://docs.capy.ai/api-reference/authentication); errors carry a `_tag`
// such as `capy/Unauthorized`.

export const CAPY_API = 'https://api.capy.ai';

/** A refusal from Capy, classified by what the connector does about it. */
export class CapyError extends Error {
  constructor(
    /** HTTP status; 0 = no response (network, timeout). */
    readonly status: number,
    /** Capy's `_tag` (`capy/Unauthorized`, `capy/RateLimited`…), when it gave one. */
    readonly tag: string | undefined,
    message: string,
    /** On `capy/RateLimited`: how long to wait. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
  /** 401: missing, revoked or expired key (Capy does not say which). The owner must act. */
  get rejectsKey(): boolean {
    return this.status === 401;
  }
  /** 404 on a thread: deleted, or no longer reachable from this key. */
  get threadGone(): boolean {
    return this.tag === 'capy/ThreadNotFound';
  }
  /** Capy, the network, a rate limit, or a stream that is briefly unavailable: worth retrying. */
  get transient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface CapyProject {
  id: string;
  name: string;
}

/**
 * A thread's status. The OpenAPI lists `working`, `waiting`, `idle`,
 * `failed` and `archived`; the API quickstart also names `active`,
 * `pending_user`, `ready_for_review` and `error`
 * (https://docs.capy.ai/api-reference/quickstart). Both are read.
 */
export type CapyStatus = string;

export interface CapyThread {
  id: string;
  status: CapyStatus;
}

/** One transcript entry (https://docs.capy.ai/api-reference/quickstart, step 5). */
export interface CapyMessage {
  id: string;
  source: 'user' | 'assistant' | 'tool' | string;
  text?: string;
  tool?: string;
  clientKey?: string;
  createdAt?: string;
}

/** One event of a thread's stream: `transcript` carries a message; the other frames are JSON the connector only notices. */
export interface CapyStreamEvent {
  event: string;
  data: unknown;
}

export interface CapyApi {
  /** The organization's projects this key can reach. Also the cheap check of a key. */
  projects(): Promise<CapyProject[]>;
  /** Create a thread with its first message; a replayed `requestId` returns the same thread. */
  createThread(input: { requestId: string; projectId: string; message: string }): Promise<CapyThread>;
  /** Send into a thread; a replayed `clientKey` is deduplicated. */
  send(threadId: string, input: { text: string; clientKey: string }): Promise<{ id: string; deduped: boolean }>;
  thread(threadId: string): Promise<CapyThread>;
  /** The whole transcript, oldest first. */
  messages(threadId: string): Promise<CapyMessage[]>;
  interrupt(threadId: string): Promise<void>;
  /** The thread's stream until the run in progress ends (`until=run`), or `signal` aborts. */
  stream(threadId: string, signal: AbortSignal): AsyncGenerator<CapyStreamEvent>;
}

const MAX_TRANSCRIPT_PAGES = 50;

export function capyApi(key: string, base = CAPY_API): CapyApi {
  const headers = { authorization: `Bearer ${key}` };

  async function call<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: init.method ?? 'GET',
        headers: { ...headers, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(init.timeoutMs ?? 60_000),
      });
    } catch (err) {
      throw new CapyError(0, undefined, `Capy could not be reached: ${(err as Error).message}`);
    }
    if (!res.ok) throw await refusal(res);
    return (await res.json()) as T;
  }
  const thread = (t: { id: string; status?: string }): CapyThread => ({ id: t.id, status: t.status ?? '' });
  const id = (value: string) => encodeURIComponent(value);

  return {
    async projects() {
      const body = await call<{ items?: Array<{ id: string; name?: string }> }>('/api/v1/projects', { timeoutMs: 30_000 });
      return (body.items ?? []).map((p) => ({ id: p.id, name: p.name ?? p.id }));
    },
    async createThread(input) {
      return thread(await call('/api/v1/threads', { method: 'POST', body: input }));
    },
    async send(threadId, input) {
      // `queue`: Harbor already runs one invocation per thread at a time, so this only waits
      // out work Capy is still finishing on its own; the default would interrupt it.
      return call(`/api/v1/threads/${id(threadId)}/message`, { method: 'POST', body: { ...input, delivery: 'queue' } });
    },
    async thread(threadId) {
      return thread(await call(`/api/v1/threads/${id(threadId)}`));
    },
    async messages(threadId) {
      const all: CapyMessage[] = [];
      let after: string | null | undefined;
      for (let page = 0; page < MAX_TRANSCRIPT_PAGES; page++) {
        const query = new URLSearchParams({ limit: '100', ...(after ? { after } : {}) });
        const body = await call<{ items?: CapyMessage[]; cursor?: string | null }>(`/api/v1/threads/${id(threadId)}/messages?${query}`);
        const items = body.items ?? [];
        all.push(...items);
        if (!body.cursor || items.length === 0 || body.cursor === after) break;
        after = body.cursor;
      }
      return all;
    },
    async interrupt(threadId) {
      await call(`/api/v1/threads/${id(threadId)}/interrupt`, { method: 'POST' });
    },
    async *stream(threadId, signal) {
      let res: Response;
      try {
        res = await fetch(`${base}/api/v1/threads/${id(threadId)}/stream?until=run`, {
          headers: { ...headers, accept: 'text/event-stream' },
          redirect: 'error',
          signal,
        });
      } catch (err) {
        if (signal.aborted) return;
        throw new CapyError(0, undefined, `Capy's stream could not be reached: ${(err as Error).message}`);
      }
      if (!res.ok || !res.body) throw await refusal(res);
      yield* parseServerSentEvents(res.body, signal);
    },
  };
}

/** `event: <name>\nid: …\ndata: <JSON>\n\n` frames; `data` is parsed when it is JSON, kept as text otherwise. */
export async function* parseServerSentEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<CapyStreamEvent> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = '';
  try {
    while (!signal.aborted) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (signal.aborted) return;
        throw new CapyError(0, undefined, `Capy's stream broke: ${(err as Error).message}`);
      }
      if (chunk.done) return;
      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        let event = 'message';
        const data: string[] = [];
        for (const line of frame.split('\n')) {
          if (line.startsWith(':')) continue;
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        }
        if (data.length === 0 && event === 'message') continue;
        const text = data.join('\n');
        let parsed: unknown = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          // not JSON: keep the text
        }
        yield { event, data: parsed };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function refusal(res: Response): Promise<CapyError> {
  try {
    const body = (await res.json()) as { _tag?: string; message?: string; retryAfterSeconds?: number };
    const tag = typeof body._tag === 'string' ? body._tag : undefined;
    const message = [tag, body.message].filter(Boolean).join(': ') || `Capy answered ${res.status}`;
    return new CapyError(res.status, tag, message, body.retryAfterSeconds);
  } catch {
    return new CapyError(res.status, undefined, `Capy answered ${res.status}`);
  }
}
