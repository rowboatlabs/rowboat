// The Maritime API, as its OpenAPI documents it (https://api.maritime.sh/openapi.json,
// read 2026-10-24) and as measured on 2026-10-26 (the plan's section 11), for
// the Maritime connector (spec §8 Connectors). Only what the connector calls:
// the agent record, wake, detached execution with its retrieval and cancel,
// and files on the agent's volume. The key is an account's `mk_` key, scoped
// to deploy, secrets and manage, or a person's for an agent they already run.
// Maritime's chat API is not used: for the coding templates it is a 30-second
// request with no handle, and for Hermes it runs one session per agent and
// returns an empty reply after two minutes.

export const MARITIME_API = 'https://api.maritime.sh';
const USER_AGENT = 'Rowboat-Harbor/1 (+https://rowboatlabs.com)';

/** A refusal from Maritime, classified by what the connector does about it. */
export class MaritimeError extends Error {
  constructor(
    /** HTTP status; 0 = no response (network, timeout). */
    readonly status: number,
    /** Maritime's stable `code` (`awake_limit_reached`, `wake_transient`, …), when it gave one. */
    readonly code: string | undefined,
    message: string,
    /** Maritime's retry hint, in seconds, when it gave one. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
  /** 401: the key is invalid or revoked; 403: it lacks the scope. The owner must act. */
  get rejectsKey(): boolean {
    return this.status === 401 || this.status === 403;
  }
  /** 404: the agent, or the execution, is gone. */
  get gone(): boolean {
    return this.status === 404;
  }
  /** The plan's number of machines are awake (429 `awake_limit_reached`), or a rate limit: wait, then try again. */
  get mustWait(): boolean {
    return this.status === 429;
  }
  /** 409 with Maritime's wording: the agent is in an error state and must be started to recover. */
  get errored(): boolean {
    return this.status === 409 && /error state/i.test(this.message);
  }
  /** `start` on an agent that is awake is refused with "is already running" (seen live 2026-10-26): the agent is up, which is what was asked. */
  get alreadyRunning(): boolean {
    return /already running/i.test(this.message);
  }
  /** Maritime, the host, or the network is having trouble: worth retrying. */
  get transient(): boolean {
    return (
      this.status === 0 ||
      this.status >= 500 ||
      this.code === 'wake_transient' ||
      this.code === 'capacity_unavailable' ||
      this.code === 'guest_command_unavailable' ||
      /could not wake/i.test(this.message)
    );
  }
}

export interface MaritimeAgent {
  id: string;
  name: string;
  /** `hermes`, `custom`, … */
  framework: string;
  /** `claude_code`, `codex`, `hermes`, …, or null for an agent made from an image. */
  templateId: string | null;
  /** `sleeping`, `active`, `deploying`, `error`, `stopped`. */
  status: string;
}

/** One execution (`POST /exec` with `detached`), as submitted, polled and cancelled. */
export interface Execution {
  executionId: string;
  /** `running`, `completed`, `cancelled`, `failed`. */
  status: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
}

export interface MaritimeApi {
  agent(agentId: string): Promise<MaritimeAgent>;
  /** Wake or start the agent. A sleeping VM restores from its snapshot in about a second; an awake one is refused with `alreadyRunning`. */
  start(agentId: string): Promise<MaritimeAgent>;
  /** Submit a command. Detached: answers at once with the execution id; the command runs on. Wakes a sleeping agent. */
  exec(agentId: string, command: string[], opts: { detached: boolean; timeoutSeconds: number }): Promise<Execution>;
  /** A retained execution: `running` with no output yet, or its end state with exit code and output. */
  execution(agentId: string, executionId: string): Promise<Execution>;
  cancelExecution(agentId: string, executionId: string): Promise<Execution>;
  /** Write a UTF-8 text file on the agent's volume, creating or replacing it. Wakes a sleeping agent. */
  writeFile(agentId: string, path: string, content: string): Promise<void>;
  /** Read a file on the agent as text; undefined when there is no such file. */
  readFile(agentId: string, path: string): Promise<string | undefined>;
  /** Create or update an end user: the record Rowboat names a managed agent by (`/docs/sdk/end-users`). */
  upsertEndUser(externalId: string, input: { displayName?: string; metadata?: Record<string, unknown>; tags?: string[] }): Promise<void>;
  /** The end user's agent, created exactly once: a repeat call returns the one it has. */
  createEndUserAgent(externalId: string, input: CreateAgentInput): Promise<MaritimeAgent>;
  /** Replace the end user's policy (caps and sizing), applied to every agent it owns. */
  setEndUserPolicy(externalId: string, policy: Record<string, number>): Promise<void>;
  /** Delete the end user with its agents; the platform finishes in the background. 404 counts as done. */
  deleteEndUser(externalId: string): Promise<void>;
}

export interface CreateAgentInput {
  name: string;
  templateId?: string;
  framework?: string;
  imageName?: string;
  instructions?: string;
  useMaritimeLlm?: boolean;
  env?: Array<{ key: string; value: string; secret?: boolean }>;
}

export function maritimeApi(key: string, base = MARITIME_API): MaritimeApi {
  const headers = { authorization: `Bearer ${key}`, 'user-agent': USER_AGENT };

  async function call<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number; text?: boolean } = {}): Promise<T> {
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
      throw new MaritimeError(0, undefined, `Maritime could not be reached: ${(err as Error).message}`);
    }
    if (!res.ok) throw await refusal(res);
    if (init.text) return (await res.text()) as T;
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  const id = encodeURIComponent;
  const shape = (a: Record<string, unknown>): MaritimeAgent => ({
    id: String(a.id),
    name: String(a.name ?? ''),
    framework: String(a.framework ?? ''),
    templateId: typeof a.templateId === 'string' ? a.templateId : null,
    status: String(a.status ?? ''),
  });

  return {
    async agent(agentId) {
      return shape(await call<Record<string, unknown>>(`/api/agents/${id(agentId)}`));
    },
    async start(agentId) {
      return shape(await call<Record<string, unknown>>(`/api/agents/${id(agentId)}/start`, { method: 'POST', timeoutMs: 60_000 }));
    },
    async exec(agentId, command, opts) {
      const body = await call<Record<string, unknown>>(`/api/agents/${id(agentId)}/exec`, {
        method: 'POST',
        body: { command, detached: opts.detached, timeout: opts.timeoutSeconds },
        timeoutMs: opts.detached ? 60_000 : (opts.timeoutSeconds + 30) * 1000,
      });
      // A 200 whose body is only `detail` is Maritime saying it could not deliver the command (seen 2026-10-26: "Could not wake agent").
      if (typeof body.executionId !== 'string') throw new MaritimeError(0, undefined, detailOf(body) ?? 'Maritime accepted the command but named no execution');
      return execution(body);
    },
    async execution(agentId, executionId) {
      return execution(await call<Record<string, unknown>>(`/api/agents/${id(agentId)}/exec/${id(executionId)}`));
    },
    async cancelExecution(agentId, executionId) {
      return execution(await call<Record<string, unknown>>(`/api/agents/${id(agentId)}/exec/${id(executionId)}`, { method: 'DELETE' }));
    },
    async writeFile(agentId, path, content) {
      await call<unknown>(`/api/agents/${id(agentId)}/files/write`, { method: 'PUT', body: { path, content }, timeoutMs: 60_000 });
    },
    async readFile(agentId, path) {
      try {
        return await call<string>(`/api/agents/${id(agentId)}/files/download?path=${id(path)}`, { text: true, timeoutMs: 60_000 });
      } catch (err) {
        if (err instanceof MaritimeError && err.gone) return undefined;
        throw err;
      }
    },
    async upsertEndUser(externalId, input) {
      await call<unknown>(`/api/v1/end-users/${id(externalId)}`, {
        method: 'PUT',
        body: {
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
        },
      });
    },
    async createEndUserAgent(externalId, input) {
      const body = await call<Record<string, unknown>>(`/api/v1/end-users/${id(externalId)}/agents`, {
        method: 'POST',
        timeoutMs: 120_000,
        body: {
          name: input.name,
          ...(input.templateId !== undefined ? { templateId: input.templateId } : {}),
          ...(input.framework !== undefined ? { framework: input.framework } : {}),
          ...(input.imageName !== undefined ? { imageName: input.imageName } : {}),
          ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
          ...(input.useMaritimeLlm !== undefined ? { useMaritimeLlm: input.useMaritimeLlm } : {}),
          ...(input.env && input.env.length > 0 ? { initialEnvVars: input.env.map((e) => ({ key: e.key, value: e.value, isSecret: e.secret ?? true })) } : {}),
        },
      });
      return shape(body);
    },
    async setEndUserPolicy(externalId, policy) {
      await call<unknown>(`/api/v1/end-users/${id(externalId)}/policy`, { method: 'PUT', body: { policy } });
    },
    async deleteEndUser(externalId) {
      try {
        await call<unknown>(`/api/v1/end-users/${id(externalId)}`, { method: 'DELETE' });
      } catch (err) {
        if (err instanceof MaritimeError && err.gone) return;
        throw err;
      }
    },
  };
}

function execution(body: Record<string, unknown>): Execution {
  return {
    executionId: String(body.executionId),
    status: String(body.status ?? ''),
    ...(typeof body.exitCode === 'number' || body.exitCode === null ? { exitCode: body.exitCode as number | null } : {}),
    ...(typeof body.stdout === 'string' ? { stdout: body.stdout } : {}),
    ...(typeof body.stderr === 'string' ? { stderr: body.stderr } : {}),
  };
}

/** Maritime's error bodies: `{detail: "…"}`, `{detail: {code, …}}`, or `{error, code}`; a retry hint beside them. */
function detailOf(body: Record<string, unknown>): string | undefined {
  const detail = body.detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object') {
    const d = detail as Record<string, unknown>;
    const text = [d.message, d.detail, d.error, d.code].find((v) => typeof v === 'string' && v.length > 0);
    return typeof text === 'string' ? text : JSON.stringify(detail).slice(0, 300);
  }
  const text = [body.error, body.message].find((v) => typeof v === 'string' && v.length > 0);
  return typeof text === 'string' ? text : undefined;
}

function codeOf(body: Record<string, unknown>): string | undefined {
  const detail = body.detail;
  const code = detail && typeof detail === 'object' ? (detail as Record<string, unknown>).code : body.code;
  return typeof code === 'string' ? code : undefined;
}

async function refusal(res: Response): Promise<MaritimeError> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // no JSON body: the status is the message
  }
  const retry = Number(res.headers.get('retry-after') ?? (typeof body.retryAfterSeconds === 'number' ? body.retryAfterSeconds : NaN));
  return new MaritimeError(res.status, codeOf(body), detailOf(body) ?? `Maritime answered ${res.status}`, Number.isFinite(retry) ? retry : undefined);
}
