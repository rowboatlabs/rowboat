import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// A stand-in for Maritime's API, built from its OpenAPI and what was measured
// on 2026-10-26 (the plan's section 11): the agent record, start with the
// plan's awake limit, detached exec with retrieval and cancel, and files on
// the volume. An execution plays a script: the test chooses the JSONL events
// the runtime's CLI writes to the turn's output file, the final message file,
// and the exit code; the fake reads the paths out of the submitted command,
// as the real CLI would be told them. Errors take Maritime's shapes:
// `{detail: "…"}`, `{detail: {code, …}}`, and `{detail: …, retryAfterSeconds}`.

export interface Turn {
  /** JSONL lines the runtime writes to the turn's output file, one per tick. */
  lines: string[];
  /** What the runtime writes to its final-message file (Codex's -o), if anything. */
  last?: string;
  exitCode?: number;
  stderr?: string;
  /** Don't finish it: the execution stays running until the test plays it. */
  hold?: boolean;
}

export interface FakeExecution {
  executionId: string;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** The `sh -c` script submitted. */
  script: string;
  files: { out?: string; last?: string; prompt?: string; err?: string };
  generation: number;
}

export interface Received {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

export const GOOD_KEY = 'mk_good';
export const AGENT_ID = 'agt-1';

export class FakeMaritime {
  readonly received: Received[] = [];
  readonly files = new Map<string, string>();
  /** Directories made through the files API, so an empty one lists. */
  readonly dirs = new Set<string>();
  readonly executions = new Map<string, FakeExecution>();
  agent = { id: AGENT_ID, name: 'Scout', framework: 'hermes', templateId: 'hermes' as string | null, status: 'sleeping' };
  /** Agents created through the end-user route (managed agents), by id; each deploys for two reads, then sleeps. */
  readonly created = new Map<string, { id: string; name: string; framework: string; templateId: string | null; status: string; reads: number; endUser: string }>();
  /** The management area (2026-10-27), per agent id: environment variables, skills, triggers; logs are canned. */
  readonly env = new Map<string, Map<string, { value: string; isSecret: boolean }>>();
  readonly skills = new Map<string, Set<string>>();
  readonly triggers = new Map<string, Map<string, { type: string; config: Record<string, unknown>; enabled: boolean }>>();
  /** Every power call, in order: `restart`, `sleep`, `start`, `reload-env`, by agent id. */
  readonly power: Array<{ agentId: string; action: string }> = [];
  /** Rowboat's credit (2026-10-27), per agent id: the cap that applies, the spend this period, and whether the cap is reached. */
  readonly spend = new Map<string, { limit: number | null; spent: number; reached: boolean }>();
  /** End users by external id, with what was last put and whether a policy was set. */
  readonly endUsers = new Map<string, { body: Record<string, unknown>; policy?: Record<string, unknown>; agentId?: string }>();
  /** What the next submitted turn does (a one-line Hermes answer by default). */
  nextTurn: Turn | undefined;
  /** How many wakes answer 429 awake_limit_reached before one succeeds. */
  awakeLimit = 0;
  refuse: { status: number; body: unknown; paths?: RegExp } | undefined;
  /** Executions Maritime has forgotten: GET answers 404. */
  readonly forgotten = new Set<string>();
  private server!: Server;
  private sequence = 0;
  url = '';

  async start(): Promise<this> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(0, resolve));
    this.url = `http://localhost:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** The body of the newest end-user agent creation. */
  lastCreation(): Record<string, unknown> | undefined {
    return this.received.filter((r) => r.method === 'POST' && /^\/api\/v1\/end-users\/[^/]+\/agents$/.test(r.path)).at(-1)?.body;
  }
  submits(): FakeExecution[] {
    return [...this.executions.values()];
  }
  starts(): Received[] {
    return this.received.filter((r) => r.method === 'POST' && r.path === `/api/agents/${AGENT_ID}/start`);
  }
  /** The request file the newest turn read. */
  lastPrompt(): string | undefined {
    const e = this.submits().at(-1);
    return e?.files.prompt ? this.files.get(e.files.prompt) : undefined;
  }

  /** Play a turn on an execution now, as the runtime's CLI would. */
  async play(execution: FakeExecution, turn: Turn): Promise<void> {
    if (turn.hold) return;
    const generation = execution.generation;
    const append = (path: string | undefined, text: string) => {
      if (path) this.files.set(path, (this.files.get(path) ?? '') + text);
    };
    for (const line of turn.lines) {
      await tick();
      if (execution.generation !== generation) return;
      append(execution.files.out, `${line}\n`);
    }
    await tick();
    if (execution.generation !== generation) return;
    if (turn.last !== undefined && execution.files.last) this.files.set(execution.files.last, turn.last);
    if (turn.stderr) append(execution.files.err, turn.stderr);
    execution.exitCode = turn.exitCode ?? 0;
    execution.status = execution.exitCode === 0 ? 'completed' : 'completed';
    execution.stderr = turn.stderr ?? '';
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url);
    const path = url.pathname;
    const body = await readJson(req);
    this.received.push({ method: req.method ?? 'GET', path, body });
    const send = (status: number, json: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    };
    if (req.headers.authorization !== `Bearer ${GOOD_KEY}`) return send(401, { detail: 'Invalid or expired API key' });
    if (this.refuse && (!this.refuse.paths || this.refuse.paths.test(path))) return send(this.refuse.status, this.refuse.body);

    const endUser = path.match(/^\/api\/v1\/end-users\/([^/]+)(?:\/(agents|policy|tokens))?$/);
    if (endUser) {
      const [, externalId, what] = endUser;
      const record = this.endUsers.get(externalId!);
      if (req.method === 'PUT' && !what) {
        this.endUsers.set(externalId!, { ...(record ?? {}), body: body ?? {} });
        return send(record ? 200 : 201, { id: `eu-${externalId}`, externalId, status: 'active' });
      }
      if (req.method === 'POST' && what === 'agents') {
        const existing = record?.agentId ? this.created.get(record.agentId) : undefined;
        if (existing) return send(200, existing);
        const n = ++this.sequence;
        const created = {
          id: `agt-m${n}`,
          name: String(body?.name ?? ''),
          framework: String(body?.framework ?? (body?.templateId ? 'custom' : 'custom')),
          templateId: typeof body?.templateId === 'string' ? body.templateId : null,
          status: 'deploying',
          reads: 0,
          endUser: externalId!,
        };
        this.created.set(created.id, created);
        const vars = Array.isArray(body?.initialEnvVars) ? (body.initialEnvVars as Array<{ key: string; value: string; isSecret?: boolean }>) : [];
        this.env.set(created.id, new Map(vars.map((v) => [v.key, { value: v.value, isSecret: v.isSecret === true }])));
        this.endUsers.set(externalId!, { ...(record ?? { body: {} }), agentId: created.id });
        return send(201, created);
      }
      if (req.method === 'POST' && what === 'tokens') {
        // A delegated token for the end user's own client (`/docs/sdk/end-users`): one agent, chosen scopes, a short life.
        if (!record) return send(404, { detail: 'End user not found' });
        const agentId = typeof body?.agentId === 'string' ? body.agentId : record.agentId;
        if (!agentId || agentId !== record.agentId) return send(404, { detail: 'Agent not found for this end user' });
        const scopes = Array.isArray(body?.scopes) ? (body.scopes as string[]) : ['chat'];
        const ttl = typeof body?.ttlSeconds === 'number' ? body.ttlSeconds : 900;
        return send(201, { token: `eu_${externalId}_${++this.sequence}`, agentId, scopes, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() });
      }
      if (req.method === 'PUT' && what === 'policy') {
        this.endUsers.set(externalId!, { ...(record ?? { body: {} }), policy: (body?.policy as Record<string, unknown>) ?? {} });
        return send(200, { policy: body?.policy ?? null, appliedToAgents: record?.agentId ? 1 : 0 });
      }
      if (req.method === 'DELETE' && !what) {
        if (!record) return send(404, { detail: 'End user not found' });
        if (record.agentId) this.created.delete(record.agentId);
        this.endUsers.delete(externalId!);
        res.writeHead(204);
        res.end();
        return;
      }
      return send(404, { detail: 'Not Found' });
    }

    const agentPath = path.match(/^\/api\/agents\/([^/]+)(?:\/(.*))?$/);
    if (!agentPath) return send(404, { detail: 'Not Found' });
    const [, agentId, rest = ''] = agentPath;
    const managed = this.created.get(agentId!);
    if (agentId !== this.agent.id && !managed) return send(404, { detail: 'Agent not found' });

    if (req.method === 'GET' && rest === '') {
      if (!managed) return send(200, this.agent);
      // A fresh deploy takes a couple of reads, then the agent sleeps, as a Maritime deploy ends.
      managed.reads++;
      if (managed.status === 'deploying' && managed.reads >= 2) managed.status = 'sleeping';
      const { reads: _reads, endUser: _endUser, ...shape } = managed;
      return send(200, shape);
    }
    // --- the management area (2026-10-27) ---
    const record = managed ?? this.agent;
    const setStatus = (status: string) => {
      record.status = status;
    };
    if (req.method === 'POST' && (rest === 'restart' || rest === 'sleep' || rest === 'stop' || rest === 'reload-env')) {
      this.power.push({ agentId: agentId!, action: rest });
      if (rest === 'sleep') setStatus('sleeping');
      else if (rest === 'stop') setStatus('stopped');
      else setStatus('active');
      const { reads: _r, endUser: _e, ...shape } = managed ?? { ...this.agent, reads: 0, endUser: '' };
      return send(200, { ...shape, tier: 'always_on' });
    }
    // Rowboat's credit: the cap that applies to the agent and its spend this period; a PUT sets the agent's own cap.
    if (rest === 'llm-spend-limit') {
      const s = this.spend.get(agentId!) ?? { limit: 500, spent: 120, reached: false };
      if (req.method === 'PUT') {
        const limit = body?.monthlyLimitCents === null ? null : Number(body?.monthlyLimitCents);
        this.spend.set(agentId!, { ...s, limit, reached: limit !== null && s.spent >= limit });
        return send(200, { ok: true });
      }
      return send(200, { monthlyLimitCents: s.limit, source: s.limit === null ? 'none' : 'agent', spentThisMonthCents: s.spent, limitReached: s.reached, periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-11-01T00:00:00Z' });
    }
    const envOf = () => {
      let m = this.env.get(agentId!);
      if (!m) {
        m = new Map();
        this.env.set(agentId!, m);
      }
      return m;
    };
    const envRow = (key: string, v: { value: string; isSecret: boolean }) => ({ id: `env-${key}`, agentId, key, value: v.isSecret ? '••••' : v.value, isSecret: v.isSecret });
    if (req.method === 'GET' && rest === 'env') return send(200, [...envOf()].map(([k, v]) => envRow(k, v)));
    if (req.method === 'POST' && rest === 'env') {
      const key = String(body?.key ?? '');
      if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) return send(422, { detail: 'Invalid env var key' });
      if (envOf().has(key)) return send(409, { detail: `Env var ${key} already exists` });
      envOf().set(key, { value: String(body?.value ?? ''), isSecret: body?.isSecret === true });
      return send(201, envRow(key, envOf().get(key)!));
    }
    const envKey = rest.match(/^env\/([^/]+)$/);
    if (envKey) {
      const key = decodeURIComponent(envKey[1]!);
      if (req.method === 'PUT') {
        if (!envOf().has(key)) return send(404, { detail: 'Env var not found' });
        envOf().set(key, { value: String(body?.value ?? ''), isSecret: body?.isSecret === true });
        return send(200, envRow(key, envOf().get(key)!));
      }
      if (req.method === 'DELETE') {
        if (!envOf().delete(key)) return send(404, { detail: 'Env var not found' });
        res.writeHead(204);
        res.end();
        return;
      }
    }
    if (req.method === 'GET' && rest.startsWith('logs')) {
      const limit = Number(url.searchParams.get('limit') ?? 100);
      const before = url.searchParams.get('before');
      const all = Array.from({ length: 5 }, (_, i) => ({ id: `log-${5 - i}`, agentId, level: i === 0 ? 'warning' : 'info', message: `line ${5 - i}`, timestamp: `2026-10-27T10:00:0${5 - i}Z`, source: 'agent' }));
      const from = before ? all.findIndex((l) => l.id === before) + 1 : 0;
      return send(200, all.slice(from, from + limit));
    }
    if (req.method === 'GET' && rest.startsWith('files/list')) {
      const dir = url.searchParams.get('path') ?? '/';
      const base = dir.endsWith('/') ? dir : `${dir}/`;
      const seen = new Map<string, { name: string; path: string; type: string; size?: number }>();
      for (const [path, content] of this.files) {
        if (!path.startsWith(base)) continue;
        const restPath = path.slice(base.length);
        const [head, ...tail] = restPath.split('/');
        if (!head) continue;
        if (tail.length === 0) seen.set(head, { name: head, path, type: 'file', size: content.length });
        else if (!seen.has(head)) seen.set(head, { name: head, path: `${base}${head}`, type: 'directory' });
      }
      for (const d of this.dirs) {
        if (d.startsWith(base) && !d.slice(base.length).includes('/') && d !== base) seen.set(d.slice(base.length), { name: d.slice(base.length), path: d, type: 'directory' });
      }
      return send(200, { path: dir, entries: [...seen.values()] });
    }
    if (req.method === 'POST' && rest === 'files/mkdir') {
      this.dirs.add(String(body?.path ?? '').replace(/\/$/, ''));
      return send(200, { ok: true });
    }
    if (req.method === 'POST' && rest === 'files/move') {
      const from = String(body?.from ?? body?.source ?? '');
      const to = String(body?.to ?? body?.destination ?? '');
      const content = this.files.get(from);
      if (content === undefined) return send(404, { detail: 'File not found' });
      this.files.delete(from);
      this.files.set(to, content);
      return send(200, { ok: true });
    }
    if (req.method === 'DELETE' && rest.startsWith('files/delete')) {
      const path = url.searchParams.get('path') ?? '';
      if (!this.files.delete(path) && !this.dirs.delete(path)) return send(404, { detail: 'File not found' });
      return send(200, { ok: true });
    }
    const skillsOf = () => {
      let set = this.skills.get(agentId!);
      if (!set) {
        set = new Set(['rowboat-spaces']);
        this.skills.set(agentId!, set);
      }
      return set;
    };
    if (req.method === 'GET' && rest === 'skills') return send(200, { skills: [...skillsOf()].map((name) => ({ name, version: '1.0.0', description: `The ${name} skill` })) });
    if (req.method === 'GET' && rest.startsWith('skills/search')) {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const catalog = ['github', 'gmail', 'notion-notes'].filter((n) => n.includes(q));
      return send(200, { results: catalog.map((name) => ({ slug: name, description: `${name} from the catalog` })) });
    }
    if (req.method === 'POST' && rest === 'skills/install') {
      const name = String(body?.name ?? body?.slug ?? '');
      if (!name) return send(422, { detail: 'name required' });
      skillsOf().add(name);
      return send(200, { ok: true, name });
    }
    const skillName = rest.match(/^skills\/([^/]+)$/);
    if (skillName && req.method === 'DELETE') {
      if (!skillsOf().delete(decodeURIComponent(skillName[1]!))) return send(404, { detail: 'Skill not found' });
      res.writeHead(204);
      res.end();
      return;
    }
    const triggersOf = () => {
      let m = this.triggers.get(agentId!);
      if (!m) {
        m = new Map();
        this.triggers.set(agentId!, m);
      }
      return m;
    };
    const triggerRow = (id: string, t: { type: string; config: Record<string, unknown>; enabled: boolean }) => ({ id, agentId, ...t });
    if (req.method === 'GET' && rest === 'triggers') return send(200, [...triggersOf()].map(([id, t]) => triggerRow(id, t)));
    if (req.method === 'POST' && rest === 'triggers') {
      const id = `trg-${++this.sequence}`;
      const t = { type: String(body?.type ?? ''), config: (body?.config as Record<string, unknown>) ?? {}, enabled: body?.enabled !== false };
      triggersOf().set(id, t);
      return send(201, triggerRow(id, t));
    }
    const triggerId = rest.match(/^triggers\/([^/]+)$/);
    if (triggerId) {
      const t = triggersOf().get(triggerId[1]!);
      if (!t) return send(404, { detail: 'Trigger not found' });
      if (req.method === 'PUT') {
        if (body?.config && typeof body.config === 'object') t.config = body.config as Record<string, unknown>;
        if (typeof body?.enabled === 'boolean') t.enabled = body.enabled;
        return send(200, triggerRow(triggerId[1]!, t));
      }
      if (req.method === 'DELETE') {
        triggersOf().delete(triggerId[1]!);
        res.writeHead(204);
        res.end();
        return;
      }
    }
    if (req.method === 'POST' && rest === 'start') {
      if (this.awakeLimit > 0) {
        this.awakeLimit--;
        return send(429, { detail: { code: 'awake_limit_reached', message: 'The plan allows 1 machine awake at once', awake: 1, maxAwake: 1 }, retryAfterSeconds: 0.01 });
      }
      this.power.push({ agentId: agentId!, action: 'start' });
      // Maritime refuses to start an agent that is awake (seen live 2026-10-26).
      if (record.status === 'active') return send(409, { detail: `Agent ${record.id} is already running` });
      record.status = 'active';
      return send(200, managed ? { ...managed, reads: undefined, endUser: undefined } : this.agent);
    }
    if (req.method === 'POST' && rest === 'exec') {
      if (record.status === 'error') return send(409, { detail: 'Agent is in an error state. Start it to recover.' });
      record.status = 'active';
      const command = body?.command;
      const script = Array.isArray(command) && command[0] === 'sh' && command[1] === '-c' ? String(command[2]) : String(command);
      const execution: FakeExecution = {
        executionId: `exec-${++this.sequence}`,
        status: 'running',
        exitCode: null,
        stdout: '',
        stderr: '',
        script,
        files: {
          out: script.match(/> '([^']+\.jsonl)'/)?.[1],
          err: script.match(/2> '([^']+\.err)'/)?.[1],
          last: script.match(/-o '([^']+)'/)?.[1],
          prompt: script.match(/(?:--query-file|cat) '([^']+\.prompt)'/)?.[1],
        },
        generation: 0,
      };
      this.executions.set(execution.executionId, execution);
      if (!execution.files.out && !execution.files.last) {
        // Not a turn: a command from the page, or a readiness check. It ran, and said what it echoed.
        const echoed = script.match(/echo ([A-Za-z0-9_-]+)/)?.[1] ?? '';
        const failed = /\bfalse\b|exit 1/.test(script);
        Object.assign(execution, { status: failed ? 'failed' : 'completed', exitCode: failed ? 1 : 0, stdout: echoed ? `${echoed}\n` : `ran: ${script}\n`, stderr: '' });
        const { executionId, status, exitCode, stdout, stderr } = execution;
        return send(200, body?.detached ? { executionId, status: 'running' } : { executionId, status, exitCode, stdout, stderr });
      }
      if (body?.detached) {
        const turn = this.nextTurn ?? hermesTurn('Done.');
        this.nextTurn = undefined;
        void this.play(execution, turn);
        return send(200, { executionId: execution.executionId, status: 'running' });
      }
      const echoed = script.match(/echo ([A-Za-z0-9_-]+)/)?.[1] ?? '';
      return send(200, { executionId: execution.executionId, status: 'completed', exitCode: 0, stdout: echoed ? `${echoed}\n` : '', stderr: '' });
    }
    const execPath = rest.match(/^exec\/([^/]+)$/);
    if (execPath) {
      const execution = this.executions.get(execPath[1]!);
      if (!execution || this.forgotten.has(execution.executionId)) return send(404, { detail: 'Execution not found' });
      if (req.method === 'DELETE') {
        execution.generation++;
        execution.status = 'cancelled';
        execution.exitCode = -1;
      }
      const { executionId, status, exitCode, stdout, stderr } = execution;
      return send(200, { executionId, status, ...(status === 'running' ? {} : { exitCode }), stdout, stderr });
    }
    if (req.method === 'PUT' && rest === 'files/write') {
      this.agent.status = 'active';
      this.files.set(String(body?.path), String(body?.content ?? ''));
      return send(200, { ok: true });
    }
    if (req.method === 'GET' && rest === 'files/download') {
      const file = this.files.get(url.searchParams.get('path') ?? '');
      if (file === undefined) return send(404, { detail: 'File not found' });
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(file);
      return;
    }
    return send(404, { detail: 'Not Found' });
  }
}

/** A Hermes turn, as `hermes chat --format stream-json` writes it (measured 2026-10-26). */
export function hermesTurn(answer: string, extra: Partial<Turn> & { session?: string } = {}): Turn {
  const { session = 'local-abc123', ...rest } = extra;
  return {
    lines: [
      JSON.stringify({ type: 'system', session_id: session }),
      JSON.stringify({ type: 'text', content: answer }),
      JSON.stringify({ type: 'result', session_id: session, exit_code: rest.exitCode ?? 0, text: answer, tokens: { input: 10, output: 5, total: 15 }, duration_ms: 1200 }),
    ],
    ...rest,
  };
}

/** A Codex turn, as `codex exec --json` writes it (measured 2026-10-26): it runs a command, then answers. */
export function codexTurn(answer: string, extra: Partial<Turn> & { thread?: string } = {}): Turn {
  const { thread = '01a1-thread', ...rest } = extra;
  return {
    lines: [
      JSON.stringify({ type: 'thread.started', thread_id: thread }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'item.started', item: { id: 'item_0', type: 'command_execution', command: 'npm test', status: 'in_progress' } }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'command_execution', command: 'npm test', exit_code: 0, status: 'completed' } }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: answer } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 10 } }),
    ],
    last: answer,
    ...rest,
  };
}

/** A Claude Code turn, as `claude -p --output-format stream-json --verbose` writes it. */
export function claudeTurn(answer: string, extra: Partial<Turn> & { session?: string } = {}): Turn {
  const { session = 'ses-claude-1', ...rest } = extra;
  return {
    lines: [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: session }),
      JSON.stringify({ type: 'assistant', session_id: session, message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } }),
      JSON.stringify({ type: 'assistant', session_id: session, message: { content: [{ type: 'text', text: answer }] } }),
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: answer, session_id: session }),
    ],
    ...rest,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 15));

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
