import { z } from 'zod';

const ObjectValue = z.record(z.string(), z.unknown());
const str = (v: unknown): string | null => typeof v === 'string' && v.length > 0 ? v : null;
const object = (v: unknown): Record<string, unknown> => ObjectValue.safeParse(v).data ?? {};
const list = (v: unknown, field: string): unknown[] => Array.isArray(v) ? v : Array.isArray(object(v)[field]) ? object(v)[field] as unknown[] : [];
export interface ReplicasImage { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
export interface Workspace { id: string; chatId: string | null; url: string | null; status: string | null }
export interface Conversation { failed?: boolean; finished: boolean; text: string | null; requestSeen: boolean }
export class RemoteError extends Error {
  constructor(readonly status: number) { super(`Replicas returned HTTP ${status}`); }
}
export interface ReplicasApi {
  environments(): Promise<Array<{ id: string; name: string }>>;
  create(input: { name: string; environmentId: string; codingAgent: string; message: string; planMode: boolean; images?: ReplicasImage[] }): Promise<Workspace>;
  workspace(id: string, codingAgent?: string): Promise<Workspace>;
  send(id: string, chatId: string, message: string, planMode: boolean, images?: ReplicasImage[]): Promise<void>;
  history(id: string, chatId: string, requestId: string): Promise<Conversation>;
}

// Fixed upstream: a connection cannot turn Harbor into an arbitrary HTTP proxy (2026-09-28).
export function replicasApi(apiKey: string): ReplicasApi {
  async function call(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`https://api.replicas.dev${path}`, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Replicas-Api-Version': '2026-05-17' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new RemoteError(response.status);
    return response.json();
  }
  function workspace(raw: unknown, codingAgent?: string): Workspace {
    const outer = object(raw);
    const row = object(outer.replica ?? outer.workspace ?? raw);
    const id = str(row.id);
    if (!id) throw new Error('Replicas returned no workspace id');
    const chats = list(row.chats, 'chats').map(object);
    const matching = chats.filter(c => c.provider === codingAgent);
    const chat = matching.length === 1 ? matching[0] : chats.length === 1 ? chats[0] : undefined;
    return { id, chatId: str(row.chat_id) ?? str(chat?.id), url: str(row.url) ?? str(row.app_url), status: str(row.status) };
  }
  return {
    async environments() {
      const raw = await call('/v1/environments');
      return list(raw, 'environments').map(object).flatMap(r => str(r.id) ? [{ id: r.id as string, name: str(r.name) ?? r.id as string }] : []);
    },
    async create(input) {
      return workspace(await call('/v1/replica', { name: input.name, environment_id: input.environmentId, coding_agent: input.codingAgent, message: input.message, plan_mode: input.planMode, ...(input.images?.length ? { images: input.images } : {}) }), input.codingAgent);
    },
    async workspace(id, codingAgent) { return workspace(await call(`/v1/replica/${encodeURIComponent(id)}`), codingAgent); },
    async send(id, chatId, message, planMode, images) {
      await call(`/v1/replica/${encodeURIComponent(id)}/messages`, { chat_id: chatId, message, plan_mode: planMode, ...(images?.length ? { images } : {}) });
    },
    async history(id, chatId, requestId) {
      // Read persisted history, including earlier pages: live SSE deltas alone cannot recover a restart.
      const events: unknown[] = [];
      const turns: unknown[] = [];
      let cursor: string | null = null;
      const cursors = new Set<string>();
      const deadline = Date.now() + 60_000;
      do {
        const query = new URLSearchParams({ chat_id: chatId, limit: '200' });
        if (cursor) query.set('beforeCursor', cursor);
        const page = object(await call(`/v1/replica/${encodeURIComponent(id)}/history?${query}`));
        events.unshift(...list(page.events, 'events'));
        turns.unshift(...list(object(page.codexAspTranscript).turns, 'turns'));
        const codex = summarizeCodexTurns(turns, requestId);
        const summary = codex.requestSeen ? codex : summarizeConversation(events, requestId);
        if (summary.requestSeen) return summary;
        cursor = str(page.beforeCursor);
        if (cursor && cursors.has(cursor)) throw new Error('Replicas repeated a history cursor');
        if (cursor) cursors.add(cursor);
        if (cursor && Date.now() >= deadline) throw new Error('Replicas history exceeded the recovery window');
      } while (cursor);
      return summarizeConversation(events, requestId);
    },
  };
}

export function summarizeConversation(events: unknown[], requestId: string): Conversation {
  const summary: Conversation = { finished: false, text: null, requestSeen: false };
  for (const raw of events) {
    const event = object(raw);
    const payload = object(event.payload);
    const message = object(payload.message);
    const blocks = message.content ?? payload.content;
    const text = typeof blocks === 'string' ? blocks : Array.isArray(blocks)
      ? blocks.map(object).filter(b => b.type === 'text').map(b => str(b.text) ?? '').join('\n') : '';
    const kind = String(event.type).replace(/^[a-z0-9]+-/, '');
    if (kind === 'user' && text.includes(`[Spaces request ${requestId}]`)) {
      summary.requestSeen = true; summary.finished = false; summary.text = null;
    } else if (kind === 'user' && text && summary.requestSeen) {
      break;
    } else if (summary.requestSeen) {
      if (kind === 'assistant' && text) summary.text = text;
      if (kind === 'result') {
        summary.text = str(payload.result) ?? summary.text;
        summary.finished = true;
        if (payload.is_error === true || String(payload.subtype ?? '').startsWith('error')) summary.failed = true;
      }
      if (kind === 'command_lifecycle' && payload.state === 'completed') summary.finished = true;
      if (kind === 'system' && payload.subtype === 'session_state_changed' && payload.state === 'idle') summary.finished = true;
    }
  }
  return summary;
}

// Codex ASP stores structured turns separately from provider events (2026-09-28).
export function summarizeCodexTurns(turns: unknown[], requestId: string): Conversation {
  for (const raw of turns) {
    const turn = object(raw);
    const items = list(turn.items, 'items').map(object);
    const user = items.find(i => i.type === 'userMessage' && JSON.stringify(i.content).includes(`[Spaces request ${requestId}]`));
    if (!user) continue;
    const answers = items.filter(i => i.type === 'agentMessage').map(i => str(i.text)).filter((t): t is string => !!t);
    return { requestSeen: true, ...(turn.status === 'failed' || turn.status === 'interrupted' ? { failed: true } : {}), finished: ['completed', 'failed', 'interrupted'].includes(String(turn.status)), text: answers.at(-1) ?? (turn.status === 'failed' ? 'The coding agent failed to complete this request.' : null) };
  }
  return { requestSeen: false, finished: false, text: null };
}
