import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// A stand-in for Agent37, built from its docs (https://www.agent37.com/docs/llms-full.txt,
// read 2026-10-01): the hosting API's instance list, and each instance's Agent
// API (responses streamed as named SSE events, reattach, cancel, sessions with
// history, file writes). Instances live under `/i/<id>` on the same server.
// Each turn plays a script: the test chooses what the agent does, and whether
// the stream drops, or the turn holds until the test finishes it.

export const GOOD_KEY = 'sk_live_good';

export interface Script {
  /** Tool calls before the answer, each a `response.tool_call.started` with this label. */
  tools?: string[];
  answer?: string;
  /** End with `response.failed` and this error instead. */
  error?: { code: string; message: string };
  /** Close every open stream after this many events, with no terminal event (the connector must reattach). */
  dropAfter?: number;
  /** Don't finish: the turn stays in progress until `finish()`. */
  hold?: boolean;
}

interface Turn {
  id: string;
  sessionId: string;
  input: string;
  events: Array<{ event: string; data: Record<string, unknown> }>;
  done: boolean;
  status: 'in_progress' | 'completed' | 'failed' | 'cancelled';
  streams: Set<ServerResponse>;
  script: Script;
}

export interface Received {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

export class FakeAgent37 {
  readonly received: Received[] = [];
  instances: Array<{ id: string; name: string | null; template: string; status: string }> = [
    { id: 'inst1', name: 'main', template: 'agent37-hermes', status: 'running' },
    { id: 'inst2', name: 'claws', template: 'agent37-openclaw', status: 'running' },
  ];
  readonly sessions = new Map<string, { active: string | null; history: Array<{ role: string; content: string }> }>();
  readonly turns = new Map<string, Turn>();
  readonly files = new Map<string, Buffer>();
  /** What the next turn does. */
  next: Script = { answer: 'Done.' };
  /** Refuse every call matching `paths` with this status and code. */
  refuse: { status: number; code: string; paths?: RegExp; flat?: boolean } | undefined;
  /** Forget turns as Agent37 does after its replay window: `/stream` answers response_not_found. */
  forgetTurns = false;
  private server!: Server;
  url = '';

  async start(): Promise<this> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(0, resolve));
    this.url = `http://localhost:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  instanceUrl = (id: string) => `${this.url}/i/${id}`;

  async close(): Promise<void> {
    for (const turn of this.turns.values()) for (const s of turn.streams) s.end();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  responses(): Received[] {
    return this.received.filter((r) => r.method === 'POST' && /\/v1\/responses$/.test(r.path));
  }

  /** Finish a held turn with this script's ending. */
  finish(turnId: string, script: Script = { answer: 'Done.' }): void {
    const turn = this.turns.get(turnId)!;
    turn.script = { ...script, hold: false };
    this.play(turn, true);
  }

  /** Start a turn on a session as something other than the connector would (the instance's own UI, say). */
  startForeign(instanceId: string, sessionId: string, input: string): string {
    return this.begin(instanceId, sessionId, input, { hold: true }).id;
  }

  private begin(_instanceId: string, sessionId: string, input: string, script: Script): Turn {
    const turn: Turn = { id: randomBytes(16).toString('hex'), sessionId, input, events: [], done: false, status: 'in_progress', streams: new Set(), script };
    this.turns.set(turn.id, turn);
    const session = this.sessions.get(sessionId) ?? { active: null, history: [] };
    session.active = turn.id;
    this.sessions.set(sessionId, session);
    this.emit(turn, 'response.created', { id: turn.id, session_id: sessionId });
    return turn;
  }

  private play(turn: Turn, resume = false): void {
    const s = turn.script;
    if (!resume) for (const label of s.tools ?? []) this.emit(turn, 'response.tool_call.started', { tool: 'terminal', label });
    if (s.hold) return;
    if (s.dropAfter !== undefined) {
      for (const stream of turn.streams) stream.end();
      turn.streams.clear();
      turn.script = { ...s, dropAfter: undefined };
      // The turn carries on without anyone listening, and ends a moment later.
      setTimeout(() => this.play(turn, true), 50);
      return;
    }
    if (s.error) {
      this.end(turn, 'failed', 'response.failed', { error: s.error });
    } else {
      const answer = s.answer ?? '';
      if (answer) this.emit(turn, 'response.output_text.delta', { text: answer });
      this.end(turn, 'completed', 'response.completed', { output_text: answer, usage: null, context: null });
    }
  }

  private end(turn: Turn, status: Turn['status'], event: string, data: Record<string, unknown>): void {
    if (turn.done) return;
    turn.done = true;
    turn.status = status;
    const session = this.sessions.get(turn.sessionId)!;
    session.active = null;
    // The harness writes a turn's messages at its end (https://www.agent37.com/docs/agents-api/sessions).
    if (status !== 'failed') {
      session.history.push({ role: 'user', content: turn.input });
      const text = typeof data.output_text === 'string' ? data.output_text : '';
      if (text) session.history.push({ role: 'assistant', content: text });
    }
    this.emit(turn, event, data);
    for (const stream of turn.streams) stream.end();
    turn.streams.clear();
  }

  private emit(turn: Turn, event: string, data: Record<string, unknown>): void {
    turn.events.push({ event, data });
    for (const stream of turn.streams) stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  private attach(turn: Turn, res: ServerResponse): void {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(':keepalive\n\n');
    for (const { event, data } of turn.events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (turn.done) return void res.end();
    turn.streams.add(res);
    res.on('close', () => turn.streams.delete(res));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    let body: Record<string, unknown> | undefined;
    if (raw.length > 0 && String(req.headers['content-type']).includes('json')) body = JSON.parse(raw.toString('utf8'));
    this.received.push({ method: req.method ?? 'GET', path: url.pathname, body });

    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    const error = (status: number, code: string, extra: Record<string, unknown> = {}) => json(status, { error: { code, message: `${code} (fake)`, ...extra } });

    if (this.refuse && (!this.refuse.paths || this.refuse.paths.test(url.pathname))) {
      return this.refuse.flat ? json(this.refuse.status, { error: this.refuse.code }) : error(this.refuse.status, this.refuse.code);
    }

    if (url.pathname === '/v1/instances') {
      if (req.headers.authorization !== `Bearer ${GOOD_KEY}`) return error(401, 'invalid_api_key');
      if (req.method === 'POST') {
        const created = { id: `new${this.instances.length + 1}`, name: (body?.name as string) ?? null, template: String(body?.template ?? 'agent37-hermes'), status: 'running' };
        this.instances.push(created);
        return json(201, created);
      }
      return json(200, { data: this.instances });
    }

    const m = /^\/i\/([^/]+)(\/v1\/.*)$/.exec(url.pathname);
    if (!m) return error(404, 'not_found');
    if (req.headers['x-agent37-key'] !== GOOD_KEY) return json(401, { error: 'invalid_api_key', message: 'This instance URL requires authentication' });
    const [, instanceId, path] = m as unknown as [string, string, string];
    if (!this.instances.some((i) => i.id === instanceId)) return json(404, { error: 'not_found' });

    if (req.method === 'POST' && path === '/v1/responses') {
      const sessionId = String(body?.session_id);
      if (!/^[0-9a-f]{32}$/.test(sessionId)) return error(400, 'validation_error', { param: 'session_id' });
      const session = this.sessions.get(sessionId);
      if (session?.active) return error(409, 'session_busy', { response_id: session.active });
      for (const file of (body?.files as string[] | undefined) ?? []) if (!this.files.has(file)) return error(400, 'validation_error', { param: 'files' });
      const turn = this.begin(instanceId, sessionId, String(body?.input ?? ''), this.next);
      this.next = { answer: 'Done.' };
      this.attach(turn, res);
      setTimeout(() => this.play(turn), 20);
      return;
    }
    let r = /^\/v1\/responses\/([0-9a-f]+)\/stream$/.exec(path);
    if (req.method === 'GET' && r) {
      const turn = this.turns.get(r[1]!);
      if (!turn || this.forgetTurns) return error(404, 'response_not_found');
      return this.attach(turn, res);
    }
    r = /^\/v1\/responses\/([0-9a-f]+)\/cancel$/.exec(path);
    if (req.method === 'POST' && r) {
      const turn = this.turns.get(r[1]!);
      if (!turn) return error(404, 'response_not_found');
      json(200, { id: turn.id, status: turn.status });
      // A cancelled turn still ends with response.completed (https://www.agent37.com/docs/agents-api/streaming).
      setTimeout(() => this.end(turn, 'cancelled', 'response.completed', { output_text: '', usage: null, context: null }), 20);
      return;
    }
    r = /^\/v1\/sessions\/([0-9a-f]+)$/.exec(path);
    if (req.method === 'GET' && r) {
      const session = this.sessions.get(r[1]!) ?? { active: null, history: [] };
      return json(200, { id: r[1], agent: url.searchParams.get('agent'), active_response_id: session.active, history: session.history, context: null });
    }
    if (req.method === 'PUT' && path === '/v1/files/content') {
      const where = (url.searchParams.get('path') ?? '').replace(/^~\//, '/home/node/');
      this.files.set(where, raw);
      return json(200, { name: where.split('/').at(-1), path: where, type: 'file', size: raw.length, modified: Date.now(), hidden: false });
    }
    return error(404, 'not_found');
  }
}
