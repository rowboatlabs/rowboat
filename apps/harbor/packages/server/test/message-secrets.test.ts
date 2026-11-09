import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPrompt, routes, type Invocation, type Member } from '@rowboat/spaces-protocol';
import type { RunningHarbor } from '../src/server.js';
import { restClient, startTestHarbor } from './helpers.js';

// Secrets in a thread (2026-11-04, "secrets card" in Main): a person shares an
// API key with the members a message mentions, people and agents alike; every
// member sees the card (the names and the readers), and only the readers, fixed
// when it is posted, read the value over REST.

const TEST_KEY = 'b'.repeat(64);
const VALUE = 'sk-live-0123456789abcdef';

let harbor: RunningHarbor;
let spaceId: string;
let scout: Member;
let scoutKey: string;
let other: Member;
let otherKey: string;
let mine: Member;
const as = (token: string) => restClient(harbor, token);
const mention = (m: { id: string; displayName: string }) => `[@${m.displayName}](#member:${m.id})`;
const harsh = { id: 'harsh', displayName: 'Harsh' };
const prakhar = { id: 'prakhar', displayName: 'Prakhar' };
const secretUrl = (messageId: string, name: string) => `/v1/spaces/${spaceId}/messages/${messageId}/secrets/${name}`;

async function readSecret(token: string, messageId: string, name: string) {
  const res = await fetch(`${harbor.url}${secretUrl(messageId, name)}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, text: await res.text(), cache: res.headers.get('cache-control'), type: res.headers.get('content-type') };
}

function postWith(body: string, secrets: unknown[], token = 'dev-gagan', space = () => spaceId) {
  return as(token).post(`/v1/spaces/${space()}/messages`, { body, actingMode: 'direct', secrets });
}

beforeAll(async () => {
  process.env.HARBOR_INTEGRATION_KEY = TEST_KEY;
  harbor = await startTestHarbor({
    name: 'Rowboat Labs',
    seedSpaces: [{ name: 'Lobby', creator: 'gagan' }],
    seedMembers: [
      { id: 'gagan', displayName: 'Gagan' },
      { id: 'harsh', displayName: 'Harsh' },
      { id: 'prakhar', displayName: 'Prakhar' },
    ],
  });
  spaceId = (await as('dev-gagan').post('/v1/spaces', { name: 'Payments' })).body.space.id;
  const a = await as('dev-gagan').post('/v1/agents', { displayName: 'Scout' });
  scout = a.body.agent;
  scoutKey = a.body.key.secret;
  const b = await as('dev-harsh').post('/v1/agents', { displayName: 'Other' });
  other = b.body.agent;
  otherKey = b.body.key.secret;
  mine = (await as('dev-harsh').post('/v1/agents', { displayName: "Harsh's Claude" })).body.agent;
  // Each owner adds their own agents (2026-11-09); Harsh's Claude gets an owner-only seat.
  await as('dev-gagan').post(`/v1/spaces/${spaceId}/members`, { memberIds: ['harsh', 'prakhar', scout.id], actingMode: 'direct' });
  await as('dev-harsh').post(`/v1/spaces/${spaceId}/members`, { memberIds: [other.id], actingMode: 'direct' });
  await as('dev-harsh').post(`/v1/spaces/${spaceId}/members`, { memberIds: [mine.id], invocableBy: 'owner', actingMode: 'direct' });
});

afterAll(async () => {
  await harbor.close();
  delete process.env.HARBOR_INTEGRATION_KEY;
});

describe('sharing a secret with the members a message mentions', () => {
  let messageId: string;

  it('posts the card, names and readers only, and invokes a mentioned agent with the names', async () => {
    const r = await postWith(`${mention(scout)} ${mention(harsh)} here is the Stripe key`, [{ name: 'STRIPE_KEY', value: VALUE }]);
    expect(r.status).toBe(200);
    const { message, invocations } = routes.postMessage.response.parse(r.body);
    messageId = message.id;
    expect(message.secrets).toEqual({ names: ['STRIPE_KEY'], readers: [scout.id, 'harsh'] });
    expect(invocations.find((i) => i.agentId === scout.id)?.trigger.secrets).toEqual(['STRIPE_KEY']);
    expect(JSON.stringify(r.body)).not.toContain(VALUE);
  });

  it('keeps the value out of every read: the message, the stream, the log', async () => {
    const reads = [
      await as('dev-prakhar').get(`/v1/spaces/${spaceId}/messages/${messageId}`),
      await as('dev-harsh').get(`/v1/spaces/${spaceId}/stream`),
    ];
    for (const read of reads) {
      expect(read.status).toBe(200);
      expect(JSON.stringify(read.body)).toContain('STRIPE_KEY');
      expect(JSON.stringify(read.body)).not.toContain(VALUE);
    }
    expect(JSON.stringify(await harbor.store.listEventsAfter(spaceId, 0))).not.toContain(VALUE);
  });

  it('gives the value to each reader, person or agent, as text, never cached', async () => {
    for (const token of [scoutKey, 'dev-harsh']) {
      expect(await readSecret(token, messageId, 'STRIPE_KEY')).toMatchObject({ status: 200, text: VALUE, cache: 'no-store', type: expect.stringContaining('text/plain') });
    }
    expect((await readSecret(scoutKey, messageId, 'OTHER')).status).toBe(404);
  });

  it('gives it to no one else: the author, a member not mentioned, an agent not mentioned', async () => {
    for (const token of ['dev-gagan', 'dev-prakhar', otherKey]) {
      expect((await readSecret(token, messageId, 'STRIPE_KEY')).status).toBe(404);
    }
  });

  it('fixes the readers when it is posted: an edit that mentions someone else adds no one', async () => {
    const edited = await as('dev-gagan').post(`/v1/spaces/${spaceId}/messages/${messageId}/edit`, {
      body: `${mention(scout)} ${mention(harsh)} ${mention(prakhar)} here is the Stripe key`,
      actingMode: 'direct',
    });
    expect(edited.status).toBe(200);
    expect(edited.body.message.secrets).toEqual({ names: ['STRIPE_KEY'], readers: [scout.id, 'harsh'] });
    expect((await readSecret('dev-prakhar', messageId, 'STRIPE_KEY')).status).toBe(404);
  });

  it('tells an agent where to read it, and never the value', () => {
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
    const text = buildPrompt({ invocation, agentId: scout.id, context: [], names: new Map(), address: 'localhost', serverUrl: 'http://localhost', attachments: [], earlierAttachments: [] });
    expect(text).toContain(`- STRIPE_KEY: http://localhost${secretUrl(messageId, 'STRIPE_KEY')}`);
    expect(text).toContain('never write its value in the thread');
  });

  it('is gone with the message: deleting it drops the card and the value', async () => {
    expect((await as('dev-gagan').post(`/v1/spaces/${spaceId}/messages/${messageId}/delete`, { actingMode: 'direct' })).status).toBe(200);
    expect((await readSecret(scoutKey, messageId, 'STRIPE_KEY')).status).toBe(404);
    expect((await readSecret('dev-harsh', messageId, 'STRIPE_KEY')).status).toBe(404);
    expect((await as('dev-gagan').get(`/v1/spaces/${spaceId}/messages/${messageId}`)).body.message.secrets).toBeUndefined();
    expect(await harbor.store.getMessageSecret(spaceId, messageId, 'STRIPE_KEY')).toBeUndefined();
  });
});

describe('who reads it when the message names no one', () => {
  it('in a DM, the others in it', async () => {
    const dm = (await as('dev-gagan').post('/v1/direct', { memberId: 'harsh' })).body.space.id as string;
    const r = await postWith('the staging key', [{ name: 'KEY', value: VALUE }], 'dev-gagan', () => dm);
    expect(r.status).toBe(200);
    expect(r.body.message.secrets).toEqual({ names: ['KEY'], readers: ['harsh'] });
  });

  it('@here is not a reader: a message that mentions only @here is refused', async () => {
    const head = await harbor.store.head(spaceId);
    const r = await postWith('[@here](#here) the key', [{ name: 'KEY', value: VALUE }]);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/mention who should read the secret/);
    expect(await harbor.store.head(spaceId)).toBe(head);
  });
});

describe('what it refuses, writing nothing', () => {
  const refused = async (body: string, secrets: unknown[], pattern: RegExp, status = 400) => {
    const head = await harbor.store.head(spaceId);
    const r = await postWith(body, secrets);
    expect(r.status).toBe(status);
    expect(r.body.message).toMatch(pattern);
    expect(await harbor.store.head(spaceId)).toBe(head);
  };

  it('a message that mentions no one', () => refused('here is the key', [{ name: 'KEY', value: VALUE }], /mention who should read the secret/));

  it('someone else’s owner-only agent among the readers', () =>
    refused(`${mention(scout)} ${mention(mine)} key`, [{ name: 'KEY', value: VALUE }], /answers only its owner here/, 403));

  it('the value in the text too', () => refused(`${mention(scout)} key ${VALUE}`, [{ name: 'KEY', value: VALUE }], /contains the value of KEY/));

  it('the same name twice', () => refused(mention(scout), [{ name: 'KEY', value: 'a' }, { name: 'KEY', value: 'b' }], /twice/));

  it('a name that is not an environment variable name', async () => {
    const r = await postWith(mention(scout), [{ name: 'my key', value: VALUE }]);
    expect(r.status).toBe(400);
  });

  it('on a Harbor that cannot seal', async () => {
    delete process.env.HARBOR_INTEGRATION_KEY;
    try {
      await refused(mention(scout), [{ name: 'KEY', value: VALUE }], /HARBOR_INTEGRATION_KEY/);
    } finally {
      process.env.HARBOR_INTEGRATION_KEY = TEST_KEY;
    }
  });
});
