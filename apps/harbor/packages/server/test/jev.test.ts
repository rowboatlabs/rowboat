import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routes, type Invocation, type Member, type Message } from '@rowboat/spaces-protocol';
import { jevPlatform } from '../src/connectors/jev/index.js';
import { buildQuestions, decideTags, selectCandidates, type TagInput } from '../src/connectors/jev/questions.js';
import { PLATFORMS } from '../src/connectors/platforms.js';
import { startHarbor, type RunningHarbor } from '../src/server.js';
import { FakeTypeSafe, namesThem } from './fake-typesafe.js';
import { freshStore, restClient } from './helpers.js';

// Jev (spec §8 Jev, 2026-10-07), end to end: a real Harbor running Jev's
// connector against a stand-in for TypeSafe's API as OpenRouter serves it. Jev is in every org, joins spaces
// like any agent, reads every message there, and posts the tags the message
// needs, people and agents alike; its tags take the message's hand-off depth.

const original = PLATFORMS.builtin;
let fake: FakeTypeSafe;

async function until<T>(check: () => Promise<T | undefined | false>, what: string, ms = 8_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value as T;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const settle = () => new Promise((r) => setTimeout(r, 300));
const token = (m: Member) => `[@${m.displayName}](#member:${m.id})`;

beforeAll(async () => {
  process.env.HARBOR_JEV_OPENROUTER_KEY = 'sk-or-test';
  fake = await new FakeTypeSafe().start();
  PLATFORMS.builtin = jevPlatform(fake.url);
});

afterAll(async () => {
  await fake.close();
  PLATFORMS.builtin = original!;
  delete process.env.HARBOR_JEV_OPENROUTER_KEY;
});

describe('Jev', () => {
  let harbor: RunningHarbor;
  let db: Awaited<ReturnType<typeof freshStore>>;
  let spaceId: string;
  let jev: Member;
  const as = (t: string) => restClient(harbor, t);

  const start = async () =>
    startHarbor({
      store: db.store,
      orgName: 'Rowboat Labs',
      seedMembers: [
        { id: 'ramnique', displayName: 'Ramnique' },
        { id: 'harsh', displayName: 'Harsh' },
        { id: 'gagan', displayName: 'Gagan' },
      ],
    });
  async function post(body: string, t = 'dev-ramnique', extra: Record<string, unknown> = {}): Promise<Message> {
    const r = await as(t).post(`/v1/spaces/${spaceId}/messages`, { body, actingMode: 'direct', ...extra });
    expect(r.status).toBe(200);
    return routes.postMessage.response.parse(r.body).message;
  }
  async function jevReplies(rootId: string): Promise<Message[]> {
    const thread = await as('dev-ramnique').get(`/v1/spaces/${spaceId}/threads/${rootId}`);
    return (thread.body.messages as Message[]).filter((m) => m.author.memberId === jev.id);
  }
  const tagged = (rootId: string, n = 1) => until(async () => {
    const replies = await jevReplies(rootId);
    return replies.length >= n ? replies : undefined;
  }, `Jev's tags in ${rootId}`);
  async function addAgent(name: string): Promise<{ agent: Member; key: string }> {
    const created = await as('dev-ramnique').post('/v1/agents', { displayName: name });
    const agent = created.body.agent as Member;
    await as('dev-ramnique').post(`/v1/spaces/${spaceId}/members`, { memberIds: [agent.id], actingMode: 'direct' });
    return { agent, key: created.body.key.secret };
  }
  async function invocations(): Promise<Invocation[]> {
    return (await as('dev-ramnique').get(`/v1/spaces/${spaceId}/invocations`)).body.invocations;
  }

  beforeAll(async () => {
    db = await freshStore();
    harbor = await start();
    spaceId = (await as('dev-ramnique').post('/v1/spaces', { name: 'Payments' })).body.space.id;
    await as('dev-ramnique').post(`/v1/spaces/${spaceId}/members`, { memberIds: ['harsh', 'gagan'], actingMode: 'direct' });
  });
  afterAll(async () => {
    await harbor.close();
    await db.db.close();
  });

  it('is in every org: one ownerless built-in agent, in no space until someone adds it', async () => {
    const roster = (await as('dev-harsh').get('/v1/members')).body.members as Member[];
    const jevs = roster.filter((m) => m.agentKind === 'jev');
    expect(jevs).toHaveLength(1);
    jev = jevs[0]!;
    expect(jev).toMatchObject({ displayName: 'Ro', kind: 'agent', agentConnection: 'builtin', role: 'member' });
    expect(jev.ownerId).toBeUndefined();
    const members = (await as('dev-harsh').get(`/v1/spaces/${spaceId}/members`)).body.members as Member[];
    expect(members.some((m) => m.id === jev.id)).toBe(false);
  });

  it('is never created twice: a restart finds it', async () => {
    await harbor.close();
    harbor = await start();
    const roster = (await as('dev-harsh').get('/v1/members')).body.members as Member[];
    expect(roster.filter((m) => m.agentKind === 'jev').map((m) => m.id)).toEqual([jev.id]);
  });

  it('cannot be added by a person, takes no credential and no key', async () => {
    expect((await as('dev-harsh').post('/v1/agents', { displayName: 'Jev 2', kind: 'jev', connection: 'builtin' })).status).toBe(400);
    expect((await as('dev-ramnique').post(`/v1/agents/${jev.id}/keys`)).status).toBe(403);
  });

  it('reads nothing in a space it is not in', async () => {
    const root = await post('Harsh, can you look at the refund bug?');
    await settle();
    expect(fake.calls).toHaveLength(0);
    expect(await jevReplies(root.id)).toEqual([]);
  });

  it('once added, tags the person a message needs, in its thread', async () => {
    expect((await as('dev-harsh').post(`/v1/spaces/${spaceId}/members`, { memberIds: [jev.id], actingMode: 'direct' })).status).toBe(200);
    await settle();
    const root = await post('Harsh, can you look at the refund bug?');
    const [reply] = await tagged(root.id);
    expect(reply!.body).toBe('cc [@Harsh](#member:harsh)');
    expect(reply!.threadRoot).toBe(root.id);
    expect(reply!.mentions).toEqual(['harsh']);
    // On the deployment's key, never naming ids to Jev; the author and Jev are never candidates.
    const call = fake.calls.at(-1)!;
    expect(call.auth).toBe('Bearer sk-or-test');
    expect(call.model).toBe('~typesafe/jev-latest');
    expect(call.state.message).toMatchObject({ author: 'Ramnique', author_is: 'a person' });
    expect(call.state.members.map((m) => m.name).sort()).toEqual(['Gagan', 'Harsh']);
    expect(JSON.stringify(call)).not.toContain('harsh"');
  });

  it('tags no one when the message needs no one, and never re-tags who is already tagged', async () => {
    const calls = fake.calls.length;
    const plain = await post('Shipping the release at five.');
    const already = await post('[@Harsh](#member:harsh) Harsh, the refund bug again');
    await settle();
    expect(fake.calls.length).toBe(calls + 2);
    // Harsh is tagged already: Jev is asked only about Gagan.
    expect(fake.calls.at(-1)!.state.members.map((m) => m.name)).toEqual(['Gagan']);
    expect(await jevReplies(plain.id)).toEqual([]);
    expect(await jevReplies(already.id)).toEqual([]);
  });

  it('reads replies with their thread, and never reads its own posts', async () => {
    const root = await post('Who owns the refund flow?');
    await settle();
    const calls = fake.calls.length;
    const reply = await post('Gagan wrote it, I think', 'dev-harsh', { threadRoot: root.id });
    const [tags] = await tagged(root.id);
    expect(tags!.body).toBe('cc [@Gagan](#member:gagan)');
    expect(fake.calls[calls]!.state.thread).toEqual([{ author: 'Ramnique', text: 'Who owns the refund flow?' }]);
    // Its own cc was posted and not judged.
    await settle();
    expect(fake.calls.length).toBe(calls + 1);
    expect(reply.threadRoot).toBe(root.id);
  });

  it('tags an agent, which its tag invokes like any mention', async () => {
    const { agent: scribe } = await addAgent('Scribe');
    await settle();
    const root = await post('Scribe, summarize this thread for the changelog');
    const [tags] = await tagged(root.id);
    expect(tags!.body).toBe(`cc ${token(scribe)}`);
    const invocation = await until(async () => (await invocations()).find((i) => i.agentId === scribe.id && i.trigger.messageId === tags!.id), 'Scribe invoked');
    expect(invocation).toMatchObject({ depth: 0, trigger: { authorId: jev.id }, conversation: { threadRootId: root.id } });
    expect(fake.calls.at(-1)!.state.members.find((m) => m.name === 'Scribe')).toMatchObject({ is: 'an agent' });
  });

  it('carries the hand-off depth: an agent naming another in plain text hands it work one hop on', async () => {
    const { agent: alpha, key: alphaKey } = await addAgent('Alpha');
    const { agent: beta, key: betaKey } = await addAgent('Beta');
    await settle();
    // A person asks Alpha (depth 0); Alpha tags Beta (depth 1).
    const root = await post(`${token(alpha)} please fix the build`);
    const first = await until(async () => (await invocations()).find((i) => i.agentId === alpha.id && i.trigger.messageId === root.id), 'Alpha invoked');
    expect((await restClient(harbor, alphaKey).post(`/v1/agent/invocations/${first.id}/ack`)).status).toBe(200);
    await post(`${token(beta)} can you bisect it?`, alphaKey, { threadRoot: root.id });
    const second = await until(async () => (await invocations()).find((i) => i.agentId === beta.id && i.conversation.threadRootId === root.id), 'Beta invoked');
    expect(second.depth).toBe(1);
    expect((await restClient(harbor, betaKey).post(`/v1/agent/invocations/${second.id}/ack`)).status).toBe(200);
    // Beta names Gagan and Scribe in plain text: Jev's tags take Beta's depth, 2, not a fresh 1.
    const ask = await post('Scribe, write this up for Gagan', betaKey, { threadRoot: root.id });
    const tags = await until(async () => (await jevReplies(root.id)).find((m) => m.mentions.length > 0 && m.offset > ask.offset), 'Jev tags Scribe');
    expect(tags.mentions.sort()).toEqual(['gagan', (await harbor.store.listAgentsByConnection(['contract'])).find((a) => a.displayName === 'Scribe')!.id].sort());
    const scribed = await until(async () => (await invocations()).find((i) => i.trigger.messageId === tags.id), 'Scribe invoked by Jev');
    expect(scribed.depth).toBe(2);
    expect(scribed.state).not.toBe('refused');
  });

  it('settles its own invocations: a mention of it is done, a DM to it says it does not chat', async () => {
    const root = await post(`${token(jev)} anything?`);
    const mentioned = await until(async () => {
      const i = (await invocations()).find((x) => x.agentId === jev.id && x.trigger.messageId === root.id);
      return i?.state === 'done' ? i : undefined;
    }, 'mention settled');
    expect(mentioned.state).toBe('done');
    // A second space: a one-space org is a group chat, where DMs are off (2026-10-07).
    await as('dev-gagan').post('/v1/spaces', { name: 'Lobby' });
    const dm = await as('dev-gagan').post('/v1/direct', { memberId: jev.id });
    expect(dm.status).toBe(200);
    const dmId = dm.body.space.id as string;
    await as('dev-gagan').post(`/v1/spaces/${dmId}/messages`, { body: 'hello Harsh', actingMode: 'direct' });
    const failed = await until(async () => {
      const list = (await as('dev-gagan').get(`/v1/spaces/${dmId}/invocations`)).body.invocations as Invocation[];
      return list.find((i) => i.state === 'failed');
    }, 'DM settled');
    expect(failed.error).toMatch(/does not chat/);
  });

  it('keeps a message TypeSafe could not judge, and tags it on the next pass', async () => {
    fake.failWith = [503];
    const first = await post('Gagan, the deploy key expired');
    await settle();
    expect(await jevReplies(first.id)).toEqual([]);
    const second = await post('Harsh, rotate it please');
    expect((await tagged(first.id))[0]!.body).toBe('cc [@Gagan](#member:gagan)');
    expect((await tagged(second.id))[0]!.body).toBe('cc [@Harsh](#member:harsh)');
  });
});

describe('Jev’s questions', () => {
  const member = (id: string, displayName: string, kind: 'human' | 'agent' = 'human'): Member =>
    ({ id, displayName, kind, role: 'member', ...(kind === 'agent' ? { agentKind: 'claude-code', agentConnection: 'replicas' } : {}) }) as Member;
  const members = [member('r', 'Ramnique'), member('h', 'Harsh'), member('g', 'Gagan'), member('c', 'Claude', 'agent'), member('j', 'Ro', 'agent')];
  const input = (over: Partial<TagInput> = {}): TagInput => ({
    spaceName: 'Payments',
    message: { authorId: 'r', text: 'Claude, fix the build' },
    thread: [],
    members,
    jevId: 'j',
    mentioned: [],
    here: false,
    busyAgents: new Set(),
    agentsAllowed: true,
    ...over,
  });

  it('asks about the members the message names first, never the author or Jev', () => {
    expect(selectCandidates(input()).map((m) => m.id)).toEqual(['c', 'h', 'g']);
  });

  it('leaves out agents past the hop limit or already at work, and people when @here reached them', () => {
    expect(selectCandidates(input({ agentsAllowed: false })).map((m) => m.id)).toEqual(['h', 'g']);
    expect(selectCandidates(input({ busyAgents: new Set(['c']) })).map((m) => m.id)).toEqual(['h', 'g']);
    expect(selectCandidates(input({ here: true })).map((m) => m.id)).toEqual(['c']);
  });

  it('describes agents by what they are, and maps answers back over the bar, at most three', () => {
    const candidates = selectCandidates(input());
    const { state, questions } = buildQuestions(input(), candidates);
    expect(JSON.stringify(state)).toContain('Claude Code, a coding agent');
    expect(Object.keys(questions)).toEqual(['member_1', 'member_2', 'member_3']);
    expect(decideTags({ member_1: 0.9, member_2: 0.69, member_3: 0.75 }, candidates).map((m) => m.id)).toEqual(['c', 'g']);
    const many = Array.from({ length: 5 }, (_, i) => member(`m${i}`, `M${i}`));
    expect(decideTags({ member_1: 0.8, member_2: 0.9, member_3: 0.95, member_4: 0.85, member_5: 0.99 }, many).map((m) => m.id)).toEqual(['m4', 'm2', 'm1']);
  });

  it('tells Jev an agent sees only what tags it, even in a thread it wrote in', () => {
    const candidates = selectCandidates(input());
    const { questions } = buildQuestions(input(), candidates);
    const said = (i: number) => questions[`member_${i + 1}`]!.instructions as Record<string, string>;
    const [agent, person] = [candidates.findIndex((m) => m.kind === 'agent'), candidates.findIndex((m) => m.kind !== 'agent')];
    expect(said(agent).context).toContain('an agent sees only messages that tag it');
    expect(said(agent).yes_when).toContain('a thread they already wrote in');
    expect(said(person).context).not.toContain('an agent sees only');
  });

  it('tells Jev who the message already tags, and which people were tagged earlier in the thread', () => {
    const thread = [{ authorId: 'r', text: '@Harsh @Claude look', mentions: ['h', 'c'] }];
    const over = { mentioned: ['g'], thread };
    const candidates = selectCandidates(input(over));
    const { state, questions } = buildQuestions(input(over), candidates);
    const s = state as { message: { tags: string[] }; members: Array<{ name: string; tagged_in_thread?: boolean }> };
    expect(s.message.tags).toEqual(['Gagan']);
    expect(s.members.find((m) => m.name === 'Harsh')!.tagged_in_thread).toBe(true);
    const said = (name: string) => questions[`member_${candidates.findIndex((m) => m.displayName === name) + 1}`]!.instructions as Record<string, string>;
    expect(said('Claude').not_when).toContain('`message.tags` is not empty');
    expect(said('Claude').not_when).not.toContain('already tagged in `thread`');
    expect(said('Harsh').context).toContain('follows it and already sees every reply');
    expect(buildQuestions(input(), selectCandidates(input())).state).toMatchObject({ message: { tags: [] } });
    expect(buildQuestions(input({ here: true }), selectCandidates(input({ here: true }))).state).toMatchObject({ message: { tags: ['@here'] } });
  });

  it('judges with the default stand-in the way the end-to-end tests assume', () => {
    expect(namesThem({ state: { message: { text: 'Harsh, look' } } } as never, { id: 'member_1', name: 'Harsh', is: 'a person' })).toBeGreaterThan(0.7);
  });
});
