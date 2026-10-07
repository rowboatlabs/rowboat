import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// A stand-in for TypeSafe's System One API (https://docs.typesafe.ai/api), as
// OpenRouter serves it at https://openrouter.ai/api/v1/systemone, for
// the Jev tests (spec §8 Jev, 2026-10-07). It records every request and
// answers each yes/no question with `judge`, which by default says yes to a
// member the message names and no to everyone else. A /find request (a
// `query` and `messages`, 2026-10-07) is answered by `pick` instead.

export interface FindCall {
  auth: string | undefined;
  model: string;
  state: { space: string; query: string; messages: Array<{ id: string; text: string; at: string; thread_title?: string; by?: string; is_reply?: boolean; replies?: number }> };
  questions: Record<string, { type: string; criteria?: Record<string, unknown> }>;
}

/** Each option's probability (`message_N`, `none_of_these`), and the presence answer. */
export type Pick = (call: FindCall) => { probabilities: Record<string, number>; presence: number };

/** The message whose text or title holds the query's last word, else none of them. */
export const holdsLastWord: Pick = (call) => {
  const word = call.state.query.toLowerCase().split(/\s+/).at(-1) ?? '';
  const hit = call.state.messages.find((m) => `${m.thread_title ?? ''} ${m.text}`.toLowerCase().includes(word));
  return hit
    ? { probabilities: { [hit.id]: 0.8, none_of_these: 0.2 }, presence: 0.9 }
    : { probabilities: { none_of_these: 1 }, presence: 0.1 };
};

export interface SystemOneCall {
  auth: string | undefined;
  model: string;
  state: { space: string; message: { author: string; author_is: string; text: string; tags: string[] }; members: Array<{ id: string; name: string; is: string; agent?: string; tagged_in_thread?: boolean }>; thread?: Array<{ author: string; text: string }> };
  questions: Record<string, { type: string }>;
}

export type Judge = (call: SystemOneCall, member: { id: string; name: string; is: string }) => number;

export const namesThem: Judge = (call, member) => (call.state.message.text.toLowerCase().includes(member.name.toLowerCase()) ? 0.92 : 0.08);

export class FakeTypeSafe {
  readonly calls: SystemOneCall[] = [];
  readonly finds: FindCall[] = [];
  judge: Judge = namesThem;
  pick: Pick = holdsLastWord;
  /** The next responses' statuses, before it answers normally again. */
  failWith: number[] = [];
  private server!: Server;
  url = '';

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        if (req.method !== 'POST' || req.url !== '/v1/systemone') return void res.writeHead(404).end();
        const status = this.failWith.shift();
        if (status) return void res.writeHead(status).end('{"error":"nope"}');
        const parsed = JSON.parse(raw) as { model: string; state: { query?: unknown } };
        if (typeof parsed.state.query === 'string') {
          const find: FindCall = { ...(parsed as Omit<FindCall, 'auth'>), auth: req.headers.authorization };
          this.finds.push(find);
          const { probabilities, presence } = this.pick(find);
          const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]![0];
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ model: find.model, answers: { match: { type: 'choice', choice, probabilities, confidence: 0.9 }, present: { type: 'noul', noul: presence } } }));
          return;
        }
        const body = parsed as Omit<SystemOneCall, 'auth'>;
        const call: SystemOneCall = { ...body, auth: req.headers.authorization };
        this.calls.push(call);
        const answers: Record<string, { type: 'noul'; noul: number }> = {};
        for (const member of call.state.members) answers[member.id] = { type: 'noul', noul: this.judge(call, member) };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ model: body.model, answers }));
      });
    });
    await new Promise<void>((resolve) => this.server.listen(0, resolve));
    this.url = `http://localhost:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
