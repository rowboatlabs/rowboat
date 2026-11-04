import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPrompt, routes, type Invocation, type Member } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { restClient, startTestHarbor } from './helpers.js';

// Secrets for an agent in a thread (2026-11-04, "secrets card" in Main): a
// person hands an agent the message mentions an API key; every member sees the
// card (the name and the recipient), and only that agent reads the value, on
// its own key, over REST.

const TEST_KEY = 'b'.repeat(64);
const VALUE = 'sk-live-0123456789abcdef';

let harbor: RunningHarbor;
let spaceId: string;
let scout: Member;
let scoutKey: string;
let other: Member;
let otherKey: string;
const as = (token: string) => restClient(harbor, token);
const mention = (agent: Member) => `[@${agent.displayName}](#member:${agent.id})`;
const secretUrl = (messageId: string, name: string) => `/v1/spaces/${spaceId}/messages/${messageId}/secrets/${name}`;

async function readSecret(token: string, messageId: string, name: string) {
  const res = await fetch(`${harbor.url}${secretUrl(messageId, name)}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, text: await res.text(), cache: res.headers.get('cache-control'), type: res.headers.get('content-type') };
}

function postWith(body: string, secrets: unknown[], token = 'dev-gagan') {
  return as(token).post(`/v1/spaces/${spaceId}/messages`, { body, actingMode: 'direct', secrets });
}

beforeAll(async () => {
  process.env.HARBOR_INTEGRATION_KEY = TEST_KEY;
  harbor = await startTestHarbor({
    orgName: 'Rowboat Labs',
    seedSpaces: [{ name: 'Lobby', creator: 'gagan' }],
    seedMembers: [
      { id: 'gagan', displayName: 'Gagan' },
      { id: 'harsh', displayName: 'Harsh' },
    ],
  });
  spaceId = (await as('dev-gagan').post('/v1/spaces', { name: 'Payments' })).body.space.id;
  const a = await as('dev-gagan').post('/v1/agents', { displayName: 'Scout' });
  scout = a.body.agent;
  scoutKey = a.body.key.secret;
  const b = await as('dev-harsh').post('/v1/agents', { displayName: 'Other' });
  other = b.body.agent;
  otherKey = b.body.key.secret;
  await as('dev-gagan').post(`/v1/spaces/${spaceId}/members`, { memberIds: ['harsh', scout.id, other.id], actingMode: 'direct' });
});

afterAll(async () => {
  await harbor.close();
  delete process.env.HARBOR_INTEGRATION_KEY;
});

describe('handing a secret to an agent', () => {
  let messageId: string;

  it('posts the card, names and recipient only, and invokes the agent with the names', async () => {
    const r = await postWith(`${mention(scout)} here is the Stripe key`, [{ name: 'STRIPE_KEY', for: scout.id, value: VALUE }]);
    expect(r.status).toBe(200);
    const { message, invocations } = routes.postMessage.response.parse(r.body);
    messageId = message.id;
    expect(message.secrets).toEqual([{ name: 'STRIPE_KEY', for: scout.id }]);
    expect(invocations[0]?.trigger.secrets).toEqual(['STRIPE_KEY']);
    expect(JSON.stringify(r.body)).not.toContain(VALUE);
  });

  it('keeps the value out of every read others have: the message, the stream, the log', async () => {
    const reads = [
      await as('dev-harsh').get(`/v1/spaces/${spaceId}/messages/${messageId}`),
      await as('dev-harsh').get(`/v1/spaces/${spaceId}/stream`),
    ];
    for (const read of reads) {
      expect(read.status).toBe(200);
      expect(JSON.stringify(read.body)).toContain('STRIPE_KEY');
      expect(JSON.stringify(read.body)).not.toContain(VALUE);
    }
    expect(JSON.stringify(await harbor.store.listEventsAfter(spaceId, 0))).not.toContain(VALUE);
  });

  it('gives the value to its recipient alone, as text, never cached', async () => {
    expect(await readSecret(scoutKey, messageId, 'STRIPE_KEY')).toMatchObject({ status: 200, text: VALUE, cache: 'no-store', type: expect.stringContaining('text/plain') });
    for (const token of ['dev-gagan', 'dev-harsh', otherKey]) {
      expect((await readSecret(token, messageId, 'STRIPE_KEY')).status).toBe(404);
    }
    expect((await readSecret(scoutKey, messageId, 'OTHER')).status).toBe(404);
  });

  it('tells the agent where to read it, and never the value', () => {
    const invocation: Invocation = {
      id: '01KAAAAAAAAAAAAAAAAAAAAAAA',
      agentId: scout.id,
      conversation: { spaceId, threadRootId: messageId },
      trigger: { messageId, authorId: 'gagan', body: 'here is the key', secrets: ['STRIPE_KEY'] },
      where: { spaceKind: 'shared', spaceName: 'Payments' },
      depth: 0,
      state: 'pending',
      createdAt: '2026-11-04T10:00:00.000Z',
      updatedAt: '2026-11-04T10:00:00.000Z',
    };
    const text = buildPrompt({ invocation, agentId: scout.id, context: [], names: new Map(), orgAddress: 'localhost', orgUrl: 'http://localhost', attachments: [], earlierAttachments: [] });
    expect(text).toContain(`- STRIPE_KEY: http://localhost${secretUrl(messageId, 'STRIPE_KEY')}`);
    expect(text).toContain('never write its value in the thread');
  });

  it('is gone with the message: deleting it drops the card and the value', async () => {
    expect((await as('dev-gagan').post(`/v1/spaces/${spaceId}/messages/${messageId}/delete`, { actingMode: 'direct' })).status).toBe(200);
    expect((await readSecret(scoutKey, messageId, 'STRIPE_KEY')).status).toBe(404);
    expect((await as('dev-gagan').get(`/v1/spaces/${spaceId}/messages/${messageId}`)).body.message.secrets).toBeUndefined();
    expect(await harbor.store.getMessageSecret(spaceId, messageId, scout.id, 'STRIPE_KEY')).toBeUndefined();
  });
});

describe('what it refuses, writing nothing', () => {
  const refused = async (body: string, secrets: unknown[], pattern: RegExp) => {
    const head = await harbor.store.head(spaceId);
    const r = await postWith(body, secrets);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(pattern);
    expect(await harbor.store.head(spaceId)).toBe(head);
  };

  it('an agent the message does not mention', () =>
    refused('here is the key', [{ name: 'KEY', for: scout.id, value: VALUE }], /mention Scout/));

  it('a person, or someone outside the space', () =>
    refused('[@Harsh](#member:harsh) here', [{ name: 'KEY', for: 'harsh', value: VALUE }], /to an agent in this space/));

  it('the value in the text too', () =>
    refused(`${mention(scout)} key ${VALUE}`, [{ name: 'KEY', for: scout.id, value: VALUE }], /contains the value of KEY/));

  it('the same name to the same agent twice', () =>
    refused(mention(scout), [{ name: 'KEY', for: scout.id, value: 'a' }, { name: 'KEY', for: scout.id, value: 'b' }], /twice/));

  it('a name that is not an environment variable name', async () => {
    const r = await postWith(mention(scout), [{ name: 'my key', for: scout.id, value: VALUE }]);
    expect(r.status).toBe(400);
  });

  it('on a Harbor that cannot seal', async () => {
    delete process.env.HARBOR_INTEGRATION_KEY;
    try {
      await refused(mention(scout), [{ name: 'KEY', for: scout.id, value: VALUE }], /HARBOR_INTEGRATION_KEY/);
    } finally {
      process.env.HARBOR_INTEGRATION_KEY = TEST_KEY;
    }
  });
});
