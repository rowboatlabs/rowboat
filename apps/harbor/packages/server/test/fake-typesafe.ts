import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// A stand-in for TypeSafe's System One API (https://docs.typesafe.ai/api), as
// OpenRouter serves it at https://openrouter.ai/api/v1/systemone, for
// the Jev tests (spec §8 Jev, 2026-10-07). It records every request and
// answers each yes/no question with `judge`, which by default says yes to a
// member the message names and no to everyone else.

export interface SystemOneCall {
  auth: string | undefined;
  model: string;
  state: { space: string; message: { author: string; author_is: string; text: string }; members: Array<{ id: string; name: string; is: string; agent?: string }>; thread?: Array<{ author: string; text: string }> };
  questions: Record<string, { type: string }>;
}

export type Judge = (call: SystemOneCall, member: { id: string; name: string; is: string }) => number;

export const namesThem: Judge = (call, member) => (call.state.message.text.toLowerCase().includes(member.name.toLowerCase()) ? 0.92 : 0.08);

export class FakeTypeSafe {
  readonly calls: SystemOneCall[] = [];
  judge: Judge = namesThem;
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
        const body = JSON.parse(raw) as Omit<SystemOneCall, 'auth'>;
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
