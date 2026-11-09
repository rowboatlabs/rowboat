import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routes, type Invocation, type Member } from '@rowboat/spaces-protocol';
import { MemoryBlobStore } from '../src/blobs.js';
import type { MentionPayload } from '../src/connectors/grok-bot/connector.js';
import { grokBotPlatform } from '../src/connectors/grok-bot/index.js';
import { parseWebhook } from '../src/connectors/grok-bot/webhook.js';
import { PLATFORMS } from '../src/connectors/platforms.js';
import { startHarbor, type RunningHarbor } from '../src/server.js';
import { freshStore, restClient } from './helpers.js';

// The Grok Bot connector (spec §8 Grok Bot, 2026-11-05), end to end: a real
// Harbor POSTing mentions to a stand-in for a Grok Bot webhook routine, which
// answers the way Grok Bot does, by posting in the thread on the agent's key.

const KEY = 'gb_routine_key';
const original = PLATFORMS['grok-bot'];

/** A webhook routine: records what it gets, answers `status`, and runs `onRun` as Grok Bot would. */
class FakeRoutine {
  server!: Server;
  url = '';
  runs: Array<{ authorization?: string; payload: MentionPayload }> = [];
  status = 200;
  onRun: (payload: MentionPayload) => Promise<void> = async () => {};

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const payload = JSON.parse(body) as MentionPayload;
        this.runs.push({ authorization: req.headers.authorization, payload });
        res.writeHead(this.status).end();
        if (this.status < 300) void this.onRun(payload);
      });
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/routines/r1/webhook`;
    return this;
  }
  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

async function until<T>(check: () => Promise<T | undefined | false>, what: string, ms = 8_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value as T;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

let harbor: RunningHarbor;
let routine: FakeRoutine;
let spaceId: string;
let grok: Member;
let grokKey: string;
const as = (token: string) => restClient(harbor, token);
const mention = (agent: Member) => `[@${agent.displayName}](#member:${agent.id})`;

async function post(body: string) {
  const r = await as('dev-harsh').post(`/v1/spaces/${spaceId}/messages`, { body, actingMode: 'direct' });
  expect(r.status).toBe(200);
  return routes.postMessage.response.parse(r.body);
}
async function invocation(id: string): Promise<Invocation | undefined> {
  return ((await as('dev-ramnique').get(`/v1/spaces/${spaceId}/invocations`)).body.invocations as Invocation[]).find((i) => i.id === id);
}
async function ended(id: string, ms?: number): Promise<Invocation> {
  return until(async () => {
    const i = await invocation(id);
    return i && ['done', 'failed', 'cancelled'].includes(i.state) ? i : undefined;
  }, `invocation ${id} to end`, ms);
}

beforeAll(async () => {
  process.env.HARBOR_INTEGRATION_KEY = 'c'.repeat(64);
  PLATFORMS['grok-bot'] = grokBotPlatform({ allowHttp: true, replyWithinMs: 1_500, watchEveryMs: 50 });
  routine = await new FakeRoutine().start();
  const { store } = await freshStore();
  harbor = await startHarbor({
    store,
    orgName: 'Rowboat Labs',
    seedSpaces: [{ name: 'Lobby', creator: 'ramnique' }],
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'Harsh' },
    ],
    blobs: new MemoryBlobStore(),
  });
  spaceId = (await as('dev-ramnique').post('/v1/spaces', { name: 'Payments' })).body.space.id;
  await as('dev-ramnique').post(`/v1/spaces/${spaceId}/members`, { memberIds: ['harsh'], actingMode: 'direct' });
  const created = await as('dev-ramnique').post('/v1/agents', { displayName: 'Grok', kind: 'grok-bot', connection: 'grok-bot', credential: `${routine.url} ${KEY}` });
  expect(created.status).toBe(200);
  grok = created.body.agent;
  grokKey = created.body.key.secret;
  await as('dev-ramnique').post(`/v1/spaces/${spaceId}/members`, { memberIds: [grok.id], actingMode: 'direct' });
});

afterAll(async () => {
  await harbor.close();
  await routine.close();
  PLATFORMS['grok-bot'] = original!;
  delete process.env.HARBOR_INTEGRATION_KEY;
});

describe('the Grok Bot webhook credential', () => {
  it('takes the POST to address and the key in either order, or the address alone', () => {
    expect(parseWebhook('https://bot.x.ai/hooks/abc gb_key')).toEqual({ url: 'https://bot.x.ai/hooks/abc', key: 'gb_key' });
    expect(parseWebhook('  gb_key\nhttps://bot.x.ai/hooks/abc ')).toEqual({ url: 'https://bot.x.ai/hooks/abc', key: 'gb_key' });
    expect(parseWebhook('https://bot.x.ai/hooks/abc?token=t')).toEqual({ url: 'https://bot.x.ai/hooks/abc?token=t' });
  });

  it('refuses anything but a public https address', () => {
    for (const bad of ['gb_key', 'http://bot.x.ai/h k', 'https://localhost/h k', 'https://127.0.0.1/h k', 'https://10.1.2.3/h k', 'https://169.254.169.254/latest k', 'https://[::1]/h k', 'https://u:p@bot.x.ai/h k', 'https://intranet/h k', 'https://bot.x.ai/h a b']) {
      expect(parseWebhook(bad), bad).toHaveProperty('error');
    }
  });

  it('refuses an agent whose credential is not a webhook, creating nothing', async () => {
    const r = await as('dev-ramnique').post('/v1/agents', { displayName: 'Nope', kind: 'grok-bot', connection: 'grok-bot', credential: 'just-a-key' });
    expect(r).toMatchObject({ status: 400, body: { message: expect.stringMatching(/POST to address/) } });
  });
});

describe('the Grok Bot connector', () => {
  it('POSTs a mention to the routine, and is done when Grok Bot replies in the thread', async () => {
    routine.onRun = async (payload) => {
      const r = await as(grokKey).post(`/v1/spaces/${payload.spaceId}/messages`, { body: 'Here is the answer.', threadRoot: payload.threadRootId, actingMode: 'direct' });
      expect(r.status).toBe(200);
    };
    const { message, invocations } = await post(`${mention(grok)} what changed in payments this week?`);
    expect(invocations).toHaveLength(1);
    const done = await ended(invocations![0]!.id);
    expect(done.state).toBe('done');

    const run = routine.runs.at(-1)!;
    expect(run.authorization).toBe(`Bearer ${KEY}`);
    expect(run.payload).toMatchObject({
      type: 'rowboat.mention',
      invocationId: done.id,
      agentId: grok.id,
      spaceId,
      threadRootId: message.id,
      messageId: message.id,
      mcpUrl: expect.stringMatching(/\/mcp$/),
    });
    expect(run.payload.prompt).toContain('what changed in payments this week?');
    // Grok Bot posts its own reply (2026-11-05): the prompt says so, not that it is posted for it.
    expect(run.payload.prompt).toContain('post it yourself, once, as a reply in this thread with post_message');
    expect(run.payload.prompt).not.toContain('never post it with post_message');
    expect(run.payload.prompt).toContain(`[Spaces request ${message.id}]`);
  });

  it('fails the turn when Grok Bot never replies', async () => {
    routine.onRun = async () => {};
    const { invocations } = await post(`${mention(grok)} are you there?`);
    const failed = await ended(invocations![0]!.id);
    expect(failed).toMatchObject({ state: 'failed', error: expect.stringMatching(/did not reply within/) });
  });

  it('marks the credential rejected when the routine refuses its key, and fails the turn', async () => {
    routine.status = 401;
    try {
      const { invocations } = await post(`${mention(grok)} hello`);
      const failed = await ended(invocations![0]!.id);
      expect(failed).toMatchObject({ state: 'failed', error: expect.stringMatching(/refused the webhook key/) });
      const listed = (await as('dev-ramnique').get('/v1/agents')).body.agents.find((a: { agent: Member }) => a.agent.id === grok.id);
      expect(listed.credential).toMatchObject({ rejectedAt: expect.any(String) });
    } finally {
      routine.status = 200;
    }
  });
});
