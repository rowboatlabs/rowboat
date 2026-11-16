import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// A stand-in for Conductor's API, built from its OpenAPI shapes
// (https://api.conductor.build/v0/openapi.json): me, projects, workspaces and
// their sessions, messages (deduped by messageId), status, the transcript with
// `after`, and cancel. Each request plays a script: the test chooses what the
// coding agent writes to the transcript, and whether Conductor refuses or
// never runs it. Transcript entries take the shape read live on 2026-10-07:
// a `userMessage` for the request, then `agent` entries wrapping Claude SDK
// messages in `rawPayload`, all tagged with the request's id as `turnId`, and
// a closing `session_state_changed` → idle.

export interface Turn {
  /** Transcript entries the agent writes, one by one, while the session is working. */
  entries: Array<{ type: string; content: unknown }>;
  /** End in the session's error state with this error. */
  error?: string;
  /** Don't run it: the message is recorded and the session stays idle. */
  hold?: boolean;
}

interface Session {
  id: string;
  workspaceId: string;
  status: 'idle' | 'working' | 'error';
  lastError?: string;
  transcript: Array<{ id: string; sessionId: string; sessionIndex: number; type: string; content: unknown; receivedAt: string }>;
  messageIds: Set<string>;
  /** Bumped by cancel: a playing turn stops at its next step. */
  generation: number;
  lastTurnId?: string;
}

interface Workspace {
  id: string;
  name: string;
  projectId: string;
  createdAt: string;
  deepLink: string;
  body: Record<string, unknown>;
  session: Session;
}

export interface Received {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

export const GOOD_KEY = 'cnd_good';

export class FakeConductor {
  readonly received: Received[] = [];
  readonly workspaces = new Map<string, Workspace>();
  projects = [{ id: 'proj-web', name: 'web-app', gitRemote: 'git@github.com:acme/web.git' }];
  /** What the next request does (a Claude answer by default). */
  nextTurn: Turn | undefined;
  refuse: { status: number; error: string; paths?: RegExp } | undefined;
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

  creates(): Received[] {
    return this.received.filter((r) => r.method === 'POST' && r.path === '/v0/workspaces');
  }
  sends(): Received[] {
    return this.received.filter((r) => r.method === 'POST' && /^\/v0\/sessions\/[^/]+\/messages$/.test(r.path));
  }
  named(name: string): Workspace | undefined {
    return [...this.workspaces.values()].find((w) => w.name === name);
  }

  /** Play a turn in a session now, as the agent would, for the request sent with `turnId`. */
  async play(session: Session, turn: Turn, turnId = session.lastTurnId ?? 'turn'): Promise<void> {
    if (turn.hold) return;
    const generation = session.generation;
    const agent = (rawPayload: unknown) => this.append(session, 'agent', { type: 'agent', rawPayload, turnId, userMessageId: turnId });
    await tick();
    if (session.generation !== generation) return;
    session.status = 'working';
    agent({ type: 'system', subtype: 'session_state_changed', state: 'running' });
    for (const entry of turn.entries) {
      await tick();
      if (session.generation !== generation) return;
      agent(entry.content);
    }
    await tick();
    if (session.generation !== generation) return;
    agent({ type: 'system', subtype: 'session_state_changed', state: 'idle' });
    if (turn.error) {
      session.status = 'error';
      session.lastError = turn.error;
    } else session.status = 'idle';
  }

  private append(session: Session, type: string, content: unknown): void {
    session.transcript.push({
      id: `msg-${++this.sequence}`,
      sessionId: session.id,
      sessionIndex: session.transcript.length,
      type,
      content,
      receivedAt: new Date().toISOString(),
    });
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
    if (req.headers.authorization !== `Bearer ${GOOD_KEY}`) return send(401, { userMessage: 'Unauthorized client request', code: 'UNAUTHORIZED' });
    if (this.refuse && (!this.refuse.paths || this.refuse.paths.test(path))) return send(this.refuse.status, { userMessage: this.refuse.error, code: 'REFUSED' });

    if (req.method === 'GET' && path === '/me') return send(200, { userId: 'user-1', organizationId: 'org-1', authMethod: 'api-key' });
    if (req.method === 'GET' && path === '/v0/projects') return send(200, { data: this.projects, offset: 0, hasMore: false });
    if (req.method === 'POST' && path === '/v0/workspaces') {
      const n = ++this.sequence;
      const workspace: Workspace = {
        id: `ws-${n}`,
        name: String(body?.name),
        projectId: String(body?.projectId),
        createdAt: new Date(Date.now() + n).toISOString(),
        deepLink: `https://app.conductor.build/workspaces/ws-${n}`,
        body: body ?? {},
        session: { id: `ses-${n}`, workspaceId: `ws-${n}`, status: 'idle', transcript: [], messageIds: new Set(), generation: 0 },
      };
      this.workspaces.set(workspace.id, workspace);
      return send(201, { workspaceId: workspace.id, sessionId: workspace.session.id, deepLink: workspace.deepLink });
    }
    if (req.method === 'GET' && path === '/v0/workspaces') {
      const name = url.searchParams.get('name');
      const data = [...this.workspaces.values()]
        .filter((w) => !name || w.name.includes(name))
        .map((w) => ({ id: w.id, name: w.name, projectId: w.projectId, state: 'ready', repoUrl: 'https://github.com/acme/web', createdAt: w.createdAt, deepLink: w.deepLink }));
      return send(200, { data, offset: 0, hasMore: false });
    }
    const sessionsOf = path.match(/^\/v0\/workspaces\/([^/]+)\/sessions$/);
    if (req.method === 'GET' && sessionsOf) {
      const w = this.workspaces.get(sessionsOf[1]!);
      if (!w) return send(404, { error: 'Workspace not found' });
      return send(200, { data: [{ id: w.session.id, deepLink: w.deepLink }], offset: 0, hasMore: false });
    }
    const sessionPath = path.match(/^\/v0\/sessions\/([^/]+)\/(messages|status|cancel)$/);
    if (sessionPath) {
      const session = [...this.workspaces.values()].map((w) => w.session).find((s) => s.id === sessionPath[1]);
      if (!session) return send(404, { error: 'Session not found' });
      const [, , what] = sessionPath;
      if (req.method === 'POST' && what === 'messages') {
        const messageId = String(body?.messageId);
        if (!session.messageIds.has(messageId)) {
          session.messageIds.add(messageId);
          session.lastTurnId = messageId;
          this.append(session, 'userMessage', { type: 'userMessage', id: messageId, message: String(body?.message), state: 'sent', turnId: messageId });
          const turn = this.nextTurn ?? claudeTurn('Done.');
          this.nextTurn = undefined;
          void this.play(session, turn);
        }
        return send(201, { messageId, state: 'sent', deepLink: `https://app.conductor.build/sessions/${session.id}` });
      }
      if (req.method === 'GET' && what === 'messages') {
        const after = url.searchParams.get('after');
        const limit = Number(url.searchParams.get('limit') ?? 100);
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const from = after ? session.transcript.findIndex((m) => m.id === after) + 1 : offset;
        const data = session.transcript.slice(from, from + limit);
        return send(200, { data, offset: from, hasMore: from + limit < session.transcript.length });
      }
      if (req.method === 'GET' && what === 'status') {
        return send(200, { workspaceId: session.workspaceId, sessionId: session.id, status: session.status, updatedAt: new Date().toISOString(), ...(session.lastError ? { lastError: session.lastError } : {}) });
      }
      if (req.method === 'POST' && what === 'cancel') {
        session.generation++;
        session.status = 'idle';
        return send(200, { workspaceId: session.workspaceId, sessionId: session.id, status: 'idle', canceledQueuedMessages: 0 });
      }
    }
    return send(404, { error: 'Not found' });
  }
}

/** A Claude Code turn: it runs the tests, then answers. */
export function claudeTurn(answer: string, extra: Partial<Turn> = {}): Turn {
  return {
    entries: [
      { type: 'assistant', content: { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } } },
      { type: 'user', content: { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } } },
      { type: 'assistant', content: { type: 'assistant', message: { content: [{ type: 'text', text: answer }] } } },
      { type: 'result', content: { type: 'result', subtype: 'success', is_error: false, result: answer } },
    ],
    ...extra,
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
