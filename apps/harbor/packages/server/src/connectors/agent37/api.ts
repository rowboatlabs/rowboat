// The Agent37 API, as its docs describe it (https://www.agent37.com/docs/llms-full.txt,
// read 2026-10-01; Agent37 publishes no OpenAPI), for the Agent37 connector
// (spec §8 Connectors). Only what the connector calls. One `sk_live_` key works
// on two planes: the hosting API at api.agent37.com takes it as a Bearer token
// (https://www.agent37.com/docs/agents-api/concepts), and each instance serves
// its own Agent API at https://{instanceId}.agent37.app, which takes it as
// X-Agent37-Key (https://www.agent37.com/docs/agents-api/chat).

export const AGENT37_API = 'https://api.agent37.com';

/** How an instance's own address is made from its id; tests point it at a stand-in. */
export type InstanceUrl = (instanceId: string) => string;
export const instanceUrl: InstanceUrl = (id) => `https://${id}.agent37.app`;

/** A refusal from Agent37, classified by what the connector does about it (https://www.agent37.com/docs/agents-api/errors). */
export class Agent37Error extends Error {
  constructor(
    /** HTTP status; 0 = no response (network, timeout). */
    readonly status: number,
    /** Agent37's stable code (`invalid_api_key`, `session_busy`…), when it gave one. */
    readonly code: string | undefined,
    message: string,
    /** On `session_busy`: the response already running on the session. */
    readonly responseId?: string,
  ) {
    super(message);
  }
  /**
   * The owner must act: the key is missing, malformed or revoked (401), it is
   * refused from this address (403 ip_not_allowed), or the instance is
   * suspended or the wallet empty (402).
   */
  get rejectsKey(): boolean {
    return this.status === 401 || this.status === 402 || this.code === 'ip_not_allowed';
  }
  /** The instance is gone: deleted, failed, or another workspace's (404 not_found on its URL). */
  get gone(): boolean {
    return this.status === 404 && this.code === 'not_found';
  }
  /** The stream replay has expired (about 30 minutes after a turn, or a gateway restart). */
  get responseGone(): boolean {
    return this.code === 'response_not_found';
  }
  get busy(): boolean {
    return this.code === 'session_busy';
  }
  /** Agent37, the network, or the instance (stopped, waking, restarting) is having trouble: worth retrying. */
  get transient(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 429 || this.code === 'try_again';
  }
}

export interface Agent37Instance {
  id: string;
  name: string | null;
  template: string;
  status: string;
}

export interface Agent37Model {
  id: string;
  label?: string;
}

/** One message of a session's transcript (https://www.agent37.com/docs/agents-api/sessions). */
export interface HistoryEntry {
  role: 'user' | 'assistant' | 'system' | string;
  content: string;
}

export interface Agent37Session {
  /** The response running on the session, or null when it is idle. */
  activeResponseId: string | null;
  history: HistoryEntry[];
}

/** One named event of a turn's stream (https://www.agent37.com/docs/agents-api/streaming). */
export interface TurnEvent {
  event: string;
  data: Record<string, unknown>;
}

export interface TurnRequest {
  input: string;
  sessionId: string;
  /** Which harness runs the turn: the agent's kind. */
  agent: string;
  files: string[];
  model?: string;
  reasoningEffort?: string;
  metadata: Record<string, string>;
}

export interface Agent37Api {
  /** The workspace's instances, newest first. Also the cheap check of a key: there is no /me. */
  instances(): Promise<Agent37Instance[]>;
  /** The models one harness on an instance can run. */
  models(instanceId: string, agent: string): Promise<Agent37Model[]>;
  /** Start a turn and stream it, until the stream ends or `signal` aborts. */
  respond(instanceId: string, turn: TurnRequest, signal: AbortSignal): AsyncGenerator<TurnEvent>;
  /** Replay a turn's stream from its start, then follow it live. */
  reattach(instanceId: string, responseId: string, signal: AbortSignal): AsyncGenerator<TurnEvent>;
  cancel(instanceId: string, responseId: string): Promise<void>;
  session(instanceId: string, sessionId: string, agent: string): Promise<Agent37Session>;
  /** Write a file on the instance (creating its folders, replacing what is there); returns its absolute path. */
  writeFile(instanceId: string, path: string, bytes: Uint8Array, mime: string): Promise<string>;
}

/**
 * How long a request to an instance may wait for its first byte: a sleeping
 * instance wakes first, which can take a couple of minutes, and the edge gives
 * up at about three (https://www.agent37.com/docs/agents-api/streaming).
 */
const FIRST_BYTE_MS = 4 * 60_000;
/** The gateway writes `:keepalive` every 30 seconds; this much silence means the stream is dead. */
const STREAM_SILENCE_MS = 2 * 60_000;

export function agent37Api(key: string, base = AGENT37_API, instance: InstanceUrl = instanceUrl): Agent37Api {
  async function call<T>(
    url: string,
    headers: Record<string, string>,
    init: { method?: string; json?: unknown; raw?: { bytes: Uint8Array; mime: string }; timeoutMs?: number } = {},
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method ?? 'GET',
        headers: {
          ...headers,
          ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(init.raw ? { 'content-type': init.raw.mime } : {}),
        },
        ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
        ...(init.raw ? { body: Buffer.from(init.raw.bytes) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(init.timeoutMs ?? FIRST_BYTE_MS),
      });
    } catch (err) {
      throw new Agent37Error(0, undefined, `Agent37 could not be reached: ${(err as Error).message}`);
    }
    if (!res.ok) throw await refusal(res);
    return (await res.json()) as T;
  }
  const hosting = { authorization: `Bearer ${key}` };
  const agent = { 'x-agent37-key': key };
  const at = (instanceId: string, path: string) => `${instance(encodeURIComponent(instanceId))}${path}`;

  async function* stream(url: string, init: RequestInit, signal: AbortSignal): AsyncGenerator<TurnEvent> {
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    let silence = setTimeout(() => abort.abort(), FIRST_BYTE_MS);
    try {
      let res: Response;
      try {
        res = await fetch(url, { ...init, headers: { ...agent, accept: 'text/event-stream', ...(init.headers as Record<string, string>) }, redirect: 'error', signal: abort.signal });
      } catch (err) {
        if (signal.aborted) return;
        throw new Agent37Error(0, undefined, `Agent37 could not be reached: ${(err as Error).message}`);
      }
      if (!res.ok || !res.body) throw await refusal(res);
      const alive = () => {
        clearTimeout(silence);
        silence = setTimeout(() => abort.abort(), STREAM_SILENCE_MS);
      };
      alive();
      yield* parseServerSentEvents(res.body, abort.signal, alive);
    } catch (err) {
      if (signal.aborted) return;
      if (err instanceof Agent37Error) throw err;
      throw new Agent37Error(0, undefined, `Agent37's stream broke: ${(err as Error).message}`);
    } finally {
      clearTimeout(silence);
      signal.removeEventListener('abort', onAbort);
    }
  }

  return {
    async instances() {
      const body = await call<{ data?: Array<{ id: string; name?: string | null; template?: string; status?: string }> }>(`${base}/v1/instances`, hosting, { timeoutMs: 30_000 });
      return (body.data ?? []).map((i) => ({ id: i.id, name: i.name ?? null, template: i.template ?? '', status: i.status ?? '' }));
    },
    async models(instanceId, harness) {
      const body = await call<{ data?: Array<{ id: string; label?: string }> }>(at(instanceId, `/v1/models?agent=${encodeURIComponent(harness)}`), agent);
      return (body.data ?? []).map(({ id, label }) => ({ id, ...(label ? { label } : {}) }));
    },
    respond(instanceId, turn, signal) {
      const body = {
        input: turn.input,
        session_id: turn.sessionId,
        agent: turn.agent,
        stream: true,
        ...(turn.files.length > 0 ? { files: turn.files } : {}),
        ...(turn.model ? { model: turn.model } : {}),
        ...(turn.reasoningEffort ? { reasoning_effort: turn.reasoningEffort } : {}),
        metadata: turn.metadata,
      };
      return stream(at(instanceId, '/v1/responses'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, signal);
    },
    reattach(instanceId, responseId, signal) {
      return stream(at(instanceId, `/v1/responses/${encodeURIComponent(responseId)}/stream`), { method: 'GET' }, signal);
    },
    async cancel(instanceId, responseId) {
      await call(at(instanceId, `/v1/responses/${encodeURIComponent(responseId)}/cancel`), agent, { method: 'POST', timeoutMs: 60_000 });
    },
    async session(instanceId, sessionId, harness) {
      const body = await call<{ active_response_id?: string | null; history?: HistoryEntry[] }>(
        at(instanceId, `/v1/sessions/${encodeURIComponent(sessionId)}?agent=${encodeURIComponent(harness)}`),
        agent,
      );
      return { activeResponseId: body.active_response_id ?? null, history: body.history ?? [] };
    },
    async writeFile(instanceId, path, bytes, mime) {
      const body = await call<{ path: string }>(at(instanceId, `/v1/files/content?path=${encodeURIComponent(path)}&overwrite=true`), agent, {
        method: 'PUT',
        raw: { bytes, mime },
      });
      return body.path;
    },
  };
}

/** `event: <name>\ndata: <JSON>\n\n` frames; `:keepalive` comments only prove the stream is alive. */
export async function* parseServerSentEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal, alive: () => void = () => {}): AsyncGenerator<TurnEvent> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = '';
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) return;
      alive();
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
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
        if (data.length === 0) continue;
        try {
          const parsed = JSON.parse(data.join('\n')) as unknown;
          if (parsed && typeof parsed === 'object') yield { event, data: parsed as Record<string, unknown> };
        } catch {
          // a malformed frame: skip it
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Agent37's two error envelopes: `{error: {code, message, response_id?}}`, or a flat `{error: "<code>", message?}` from the edge. */
async function refusal(res: Response): Promise<Agent37Error> {
  try {
    const body = (await res.json()) as { error?: string | { code?: string; message?: string; response_id?: string }; message?: string };
    if (typeof body.error === 'string') return new Agent37Error(res.status, body.error, body.message ? `${body.error}: ${body.message}` : body.error);
    const code = body.error?.code;
    const message = [code, body.error?.message].filter(Boolean).join(': ') || `Agent37 answered ${res.status}`;
    return new Agent37Error(res.status, code, message, body.error?.response_id);
  } catch {
    return new Agent37Error(res.status, undefined, `Agent37 answered ${res.status}`);
  }
}
