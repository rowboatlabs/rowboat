import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// A stand-in for Capy's API, built from its OpenAPI (https://docs.capy.ai/openapi.json,
// read 2026-10-02): projects, threads created with a replayable `requestId`,
// messages deduplicated on `clientKey`, the thread and its transcript, interrupt,
// and the thread stream with `until=run`. Each run plays a script.

export const GOOD_KEY = 'capy_good';

export interface Script {
  /** Tool calls before the answer, each a transcript `tool` message. */
  tools?: string[];
  answer?: string;
  /** End the run `failed`. */
  fail?: boolean;
  /** Stay working until `finish()`. */
  hold?: boolean;
}

interface Thread {
  id: string;
  projectId: string;
  requestId: string;
  status: string;
  transcript: Array<{ id: string; source: string; text?: string; tool?: string; clientKey?: string; createdAt: string }>;
  streams: Set<ServerResponse>;
  script?: Script;
}

export interface Received {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

export class FakeCapy {
  readonly received: Received[] = [];
  projects = [{ id: 'project_web', name: 'web' }];
  readonly threads = new Map<string, Thread>();
  next: Script = { answer: 'Done.' };
  refuse: { status: number; tag: string; paths?: RegExp } | undefined;
  private server!: Server;
  private seq = 0;
  url = '';

  async start(): Promise<this> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(0, resolve));
    this.url = `http://localhost:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async close(): Promise<void> {
    for (const t of this.threads.values()) for (const s of t.streams) s.end();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  calls(method: string, pattern: RegExp): Received[] {
    return this.received.filter((r) => r.method === method && pattern.test(r.path));
  }

  /** Finish a held run. */
  finish(threadId: string, script: Script = { answer: 'Done.' }): void {
    const thread = this.threads.get(threadId)!;
    thread.script = { ...script, hold: false };
    this.play(thread);
  }

  private id(): string {
    return `01M${String(++this.seq).padStart(23, '0')}`;
  }

  private run(thread: Thread): void {
    thread.status = 'working';
    thread.script = this.next;
    this.next = { answer: 'Done.' };
    setTimeout(() => this.play(thread), 30);
  }

  private play(thread: Thread): void {
    const s = thread.script;
    if (!s || thread.status !== 'working') return;
    for (const tool of s.tools ?? []) this.append(thread, { source: 'tool', tool });
    s.tools = [];
    if (s.hold) return;
    if (s.answer) this.append(thread, { source: 'assistant', text: s.answer });
    this.end(thread, s.fail ? 'failed' : 'idle');
  }

  private end(thread: Thread, status: string): void {
    thread.status = status;
    thread.script = undefined;
    for (const stream of thread.streams) {
      stream.write('event: done\ndata: {}\n\n');
      stream.end();
    }
    thread.streams.clear();
  }

  private append(thread: Thread, m: { source: string; text?: string; tool?: string; clientKey?: string }): void {
    const message = { id: this.id(), createdAt: new Date().toISOString(), ...m };
    thread.transcript.push(message);
    for (const stream of thread.streams) stream.write(`event: transcript\nid: ${message.id}\ndata: ${JSON.stringify(message)}\n\n`);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    const body = raw.length > 0 ? (JSON.parse(raw.toString('utf8')) as Record<string, unknown>) : undefined;
    this.received.push({ method: req.method ?? 'GET', path: url.pathname, body });
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (this.refuse && (!this.refuse.paths || this.refuse.paths.test(url.pathname))) return json(this.refuse.status, { _tag: this.refuse.tag });
    if (req.headers.authorization !== `Bearer ${GOOD_KEY}`) return json(401, { _tag: 'capy/Unauthorized' });

    if (req.method === 'GET' && url.pathname === '/api/v1/projects') return json(200, { items: this.projects.map((p) => ({ ...p, code: p.name, repos: [] })) });
    if (req.method === 'POST' && url.pathname === '/api/v1/threads') {
      const requestId = String(body?.requestId);
      const existing = [...this.threads.values()].find((t) => t.requestId === requestId);
      if (existing) return json(200, { id: existing.id, status: existing.status });
      if (!this.projects.some((p) => p.id === body?.projectId)) return json(404, { _tag: 'capy/ProjectNotFound' });
      const thread: Thread = { id: `jam_${this.id()}`, projectId: String(body?.projectId), requestId, status: 'idle', transcript: [], streams: new Set() };
      this.threads.set(thread.id, thread);
      this.append(thread, { source: 'user', text: String(body?.message) });
      this.run(thread);
      return json(200, { id: thread.id, status: thread.status });
    }
    const m = /^\/api\/v1\/threads\/([^/]+)(\/[a-z]+)?$/.exec(url.pathname);
    const thread = m ? this.threads.get(decodeURIComponent(m[1]!)) : undefined;
    if (m && !thread) return json(404, { _tag: 'capy/ThreadNotFound', threadId: m[1] });
    if (!thread) return json(404, { _tag: 'capy/NotFound' });
    const verb = m![2];
    if (req.method === 'GET' && !verb) return json(200, { id: thread.id, status: thread.status });
    if (req.method === 'GET' && verb === '/messages') return json(200, { items: thread.transcript, cursor: null, beforeCursor: null });
    if (req.method === 'POST' && verb === '/message') {
      const clientKey = String(body?.clientKey);
      const seen = thread.transcript.find((x) => x.clientKey === clientKey);
      if (seen) return json(200, { id: seen.id, deduped: true });
      this.append(thread, { source: 'user', text: String(body?.text), clientKey });
      this.run(thread);
      return json(200, { id: thread.transcript.at(-1)!.id, deduped: false });
    }
    if (req.method === 'POST' && verb === '/interrupt') {
      json(200, { id: this.id(), deduped: false });
      setTimeout(() => this.end(thread, 'idle'), 20);
      return;
    }
    if (req.method === 'GET' && verb === '/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      // `until=run`: closes with `done` once the run ends, or at once when the thread is not working.
      if (thread.status !== 'working') {
        res.write('event: done\ndata: {}\n\n');
        return void res.end();
      }
      thread.streams.add(res);
      res.on('close', () => thread.streams.delete(res));
      return;
    }
    return json(404, { _tag: 'capy/NotFound' });
  }
}
