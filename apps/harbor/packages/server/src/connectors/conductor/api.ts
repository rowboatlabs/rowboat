// The Conductor API, as its OpenAPI documents it (https://api.conductor.build/v0/openapi.json,
// "Roundhouse public API 0.0.1", read 2026-10-05), for the Conductor connector
// (spec §8 Connectors). Only what the connector calls. The key is a user's
// bearer key (Pro plan or higher); cloud workspaces run on GitHub repos only.
// No event stream: the connector polls a session's status and transcript.

export const CONDUCTOR_API = 'https://api.conductor.build';
/** Conductor rejects some default client signatures; its docs ask custom clients to name themselves. */
const USER_AGENT = 'Rowboat-Harbor/1 (+https://rowboatlabs.com)';

/** A refusal from Conductor, classified by what the connector does about it. */
export class ConductorError extends Error {
  constructor(
    /** HTTP status; 0 = no response (network, timeout). */
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
  /** 401: the key is invalid or revoked; 402: the plan doesn't include the API. The owner must act. */
  get rejectsKey(): boolean {
    return this.status === 401 || this.status === 402;
  }
  get atCapacity(): boolean {
    return this.status === 429;
  }
  /** 404: the workspace or session is gone (archived and deleted). */
  get gone(): boolean {
    return this.status === 404;
  }
  /** Conductor or the network is having trouble: worth retrying. */
  get transient(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

export interface ConductorProject {
  id: string;
  name: string;
  gitRemote: string;
}

export type WorkspaceState = 'initializing' | 'ready' | 'sleeping' | 'archived' | 'deleted' | 'updating' | 'unstarted';
export type SessionStatus = 'idle' | 'working' | 'error';

/** One transcript entry. `content` is undocumented ("any"); turns.ts reads it. */
export interface TranscriptMessage {
  id: string;
  sessionId: string;
  sessionIndex: number;
  type: string;
  content: unknown;
  receivedAt: string;
}

export interface CreateWorkspace {
  projectId: string;
  name: string;
  agent: string;
  model?: string;
  effort?: string;
  fastMode?: boolean;
  env: Record<string, string>;
}

export interface ConductorApi {
  me(): Promise<{ userId: string; organizationId?: string }>;
  projects(): Promise<ConductorProject[]>;
  /** Not idempotent: a retry after a lost response makes a second workspace. Created without a message, so the send can be. */
  createWorkspace(input: CreateWorkspace): Promise<{ workspaceId: string; sessionId: string; deepLink: string }>;
  /** Workspaces with exactly this name, newest first. */
  workspacesNamed(name: string): Promise<Array<{ id: string; deepLink: string }>>;
  sessions(workspaceId: string): Promise<Array<{ id: string; deepLink: string }>>;
  /** Send into a session; `messageId` (a uuid the caller picks) dedupes a retry. */
  send(sessionId: string, input: { messageId: string; message: string }): Promise<{ state: 'queued' | 'sent'; deepLink: string }>;
  workspaceStatus(workspaceId: string): Promise<{ status: WorkspaceState; errorMessage?: string }>;
  sessionStatus(sessionId: string): Promise<{ status: SessionStatus; errorMessage?: string; lastError?: string }>;
  /** Every transcript message after `after` (all of them without it), oldest first. */
  messages(sessionId: string, after?: string): Promise<TranscriptMessage[]>;
  /** Stop the running turn and drop queued messages; a no-op when idle. */
  cancel(sessionId: string): Promise<void>;
}

const PAGE = 100;
/** Bounds a transcript read: a long turn is a few hundred entries. */
const MAX_PAGES = 20;

export function conductorApi(key: string, base = CONDUCTOR_API): ConductorApi {
  const headers = { authorization: `Bearer ${key}`, 'user-agent': USER_AGENT };

  async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: init.method ?? 'GET',
        headers: { ...headers, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new ConductorError(0, `Conductor could not be reached: ${(err as Error).message}`);
    }
    if (!res.ok) throw new ConductorError(res.status, await errorText(res));
    return (await res.json()) as T;
  }

  const id = encodeURIComponent;

  return {
    async me() {
      return call<{ userId: string; organizationId?: string }>('/me');
    },
    async projects() {
      const all: ConductorProject[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const body = await call<{ data: ConductorProject[]; hasMore: boolean }>(`/v0/projects?limit=${PAGE}&offset=${page * PAGE}`);
        all.push(...body.data.map(({ id, name, gitRemote }) => ({ id, name, gitRemote })));
        if (!body.hasMore) break;
      }
      return all;
    },
    async createWorkspace(input) {
      return call<{ workspaceId: string; sessionId: string; deepLink: string }>('/v0/workspaces', {
        method: 'POST',
        body: {
          projectId: input.projectId,
          name: input.name,
          sessionName: 'Rowboat',
          agent: input.agent,
          ...(input.model ? { model: input.model } : {}),
          ...(input.effort ? { effort: input.effort } : {}),
          ...(input.fastMode !== undefined ? { fastMode: input.fastMode } : {}),
          env: input.env,
        },
      });
    },
    async workspacesNamed(name) {
      const body = await call<{ data: Array<{ id: string; name: string; deepLink: string; createdAt: string }> }>(
        `/v0/workspaces?name=${id(name)}&limit=${PAGE}`,
      );
      return body.data
        .filter((w) => w.name === name)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(({ id, deepLink }) => ({ id, deepLink }));
    },
    async sessions(workspaceId) {
      const body = await call<{ data: Array<{ id: string; deepLink: string }> }>(`/v0/workspaces/${id(workspaceId)}/sessions?limit=${PAGE}`);
      return body.data.map(({ id, deepLink }) => ({ id, deepLink }));
    },
    async send(sessionId, input) {
      return call<{ state: 'queued' | 'sent'; deepLink: string }>(`/v0/sessions/${id(sessionId)}/messages`, {
        method: 'POST',
        body: { messageId: input.messageId, message: input.message },
      });
    },
    async workspaceStatus(workspaceId) {
      return call<{ status: WorkspaceState; errorMessage?: string }>(`/v0/workspaces/${id(workspaceId)}/status`);
    },
    async sessionStatus(sessionId) {
      return call<{ status: SessionStatus; errorMessage?: string; lastError?: string }>(`/v0/sessions/${id(sessionId)}/status`);
    },
    async messages(sessionId, after) {
      const all: TranscriptMessage[] = [];
      if (after) {
        // `after` returns only newer messages, ascending; it can't combine with offset, so page by moving it.
        let cursor = after;
        for (let page = 0; page < MAX_PAGES; page++) {
          const body = await call<{ data: TranscriptMessage[]; hasMore: boolean }>(
            `/v0/sessions/${id(sessionId)}/messages?after=${id(cursor)}&limit=${PAGE}`,
          );
          all.push(...body.data);
          if (!body.hasMore || body.data.length === 0) break;
          cursor = body.data[body.data.length - 1]!.id;
        }
        return all;
      }
      for (let page = 0; page < MAX_PAGES; page++) {
        const body = await call<{ data: TranscriptMessage[]; hasMore: boolean }>(
          `/v0/sessions/${id(sessionId)}/messages?limit=${PAGE}&offset=${page * PAGE}`,
        );
        all.push(...body.data);
        if (!body.hasMore) break;
      }
      return all;
    },
    async cancel(sessionId) {
      await call<unknown>(`/v0/sessions/${id(sessionId)}/cancel`, { method: 'POST' });
    },
  };
}

async function errorText(res: Response): Promise<string> {
  try {
    // Conductor's errors are `{ userMessage, code, … }` (found live 2026-10-07); `error` and `message` as a fallback.
    const body = (await res.json()) as { userMessage?: unknown; error?: unknown; message?: unknown };
    const text = [body.userMessage ?? body.error ?? body.message].filter((v) => typeof v === 'string').join('');
    return text || `Conductor answered ${res.status}`;
  } catch {
    return `Conductor answered ${res.status}`;
  }
}
