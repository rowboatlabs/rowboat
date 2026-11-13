import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mcpTools, weighGraph, type Space, type SpaceGraph } from '@rowboat/spaces-protocol';
import { jevApi, JevError, type JevAnswer, type JevApi, type JevQuestion, type Json } from '../src/jev.js';
import { codeIn, mainRepository, referencesIn, topicCandidates } from '../src/graph/text.js';
import { mayBeSameTopic } from '../src/graph/questions.js';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, restClient, startTestHarbor } from './helpers.js';

// The space graph (spec §8 Space graph, 2026-11-12), over the wire on both
// faces with a stand-in Jev: an admin's switch, off by default and refused on
// a DM; a worker that judges quiet threads and stores edges with their
// events; a membership-gated read, whole or about one thing; and what a
// deletion, an edit or turning it off does to what was derived. The stand-in
// answers every question from the question itself, so the test says what
// Jev was asked without a network.

interface Asked { state: Json; questions: Record<string, JevQuestion> }

class FakeJev implements JevApi {
  readonly asked: Asked[] = [];
  /** Throw on the next request, once: Jev being busy. */
  failNext = false;
  /** Subjects (topic labels, identifiers) the fake calls central; anything else is a passing mention. */
  central = new Set(['Harbor', 'Postgres', '`lockedAs`']);
  async ask(state: Json, questions: Record<string, JevQuestion>): Promise<Record<string, JevAnswer>> {
    if (this.failNext) {
      this.failNext = false;
      throw new JevError(529, 'Jev is busy (529)');
    }
    this.asked.push({ state, questions });
    const text = JSON.stringify(state);
    const answers: Record<string, JevAnswer> = {};
    for (const [key, q] of Object.entries(questions)) {
      const about = (q.instructions ?? {}) as { subject?: string; identifier?: string; phrase?: string; member?: string; reference?: string };
      if (key === 'kind') answers[key] = { type: 'choice', choice: text.includes('decided') ? 'decision' : 'bug', probabilities: { decision: 0.9, bug: 0.9 } };
      else if (key === 'resolved') answers[key] = { type: 'noul', noul: text.includes('fixed') ? 0.9 : 0.1 };
      else if (key === 'decision') answers[key] = { type: 'noul', noul: text.includes('decided') ? 0.95 : 0.05 };
      else if (key === 'importance') answers[key] = { type: 'score', score: text.includes('decided') ? 3.5 : 2 };
      else if (key.startsWith('topic_')) answers[key] = { type: 'noul', noul: this.central.has(about.subject ?? '') ? 0.9 : 0.01 };
      else if (key.startsWith('code_')) answers[key] = { type: 'noul', noul: this.central.has(`\`${about.identifier}\``) ? 0.8 : 0.01 };
      else if (key.startsWith('reference_')) answers[key] = { type: 'choice', choice: 'produced', probabilities: { produced: 0.8 } };
      else if (key.startsWith('member_')) answers[key] = { type: 'choice', choice: about.member === 'Ramnique' ? 'requester' : 'doer', probabilities: { requester: 0.9, doer: 0.9 } };
      // The vocabulary: capitalised product names are real, everything else is refused.
      else if (key.startsWith('real_')) answers[key] = { type: 'noul', noul: /^(Harbor|Postgres|Harbor server)$/.test(about.phrase ?? '') ? 0.95 : 0.1 };
      else if (key.startsWith('category_')) answers[key] = { type: 'choice', choice: 'own_component', probabilities: { own_component: 0.9 } };
      else if (key.startsWith('same_')) answers[key] = { type: 'score', score: 1.9 };
    }
    return answers;
  }
}

let harbor: RunningHarbor;
let jev: FakeJev;
let spaceId: string;
let dmId: string;
let agent: Client;
const admin = () => restClient(harbor, 'dev-ramnique');
const gagan = () => restClient(harbor, 'dev-gagan');
const outsider = () => restClient(harbor, 'dev-prakhar');
const turn = (enabled: boolean, client = admin(), id = spaceId) => client.post(`/v1/spaces/${id}/graph`, { enabled, actingMode: 'direct' });
const read = async (query = '', client = gagan()): Promise<SpaceGraph> => (await client.get(`/v1/spaces/${spaceId}/graph${query}`)).body as SpaceGraph;
const post = async (client: ReturnType<typeof restClient>, body: string, threadRoot?: string): Promise<string> =>
  ((await client.post(`/v1/spaces/${spaceId}/messages`, { body, actingMode: 'direct', ...(threadRoot ? { threadRoot } : {}) })).body as { message: { id: string } }).message.id;
const eventsOf = async (type: string) => (await harbor.store.listEventsAfter(spaceId, 0)).filter((e) => e.event.type === type);

async function until<T>(check: () => Promise<T | undefined | false>, what: string, ms = 8_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
const settled = (threads: number): Promise<SpaceGraph> => until(async () => { const g = await read(); return g.status === 'ready' && g.pending === 0 && g.threads.length === threads ? g : undefined; }, `${threads} judged threads`);

async function call<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`tool ${name} errored: ${JSON.stringify(result.content)}`);
  const parsed = mcpTools.find((t) => t.name === name)!.output.safeParse(result.structuredContent);
  if (!parsed.success) throw new Error(`tool ${name} output failed its schema: ${parsed.error.message}`);
  return result.structuredContent as T;
}

beforeAll(async () => {
  jev = new FakeJev();
  harbor = await startTestHarbor({
    name: 'Rowboat Labs',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'gagan', displayName: 'Gagan' },
      { id: 'prakhar', displayName: 'Prakhar' },
    ],
    seedSpaces: [{ name: 'Lobby', creator: 'ramnique' }],
    graph: { jev, tickMs: 40, quietMs: 0, vocabularyEvery: 1 },
  });
  spaceId = ((await admin().post('/v1/spaces', { name: 'Engineering' })).body as { space: Space }).space.id;
  await admin().post(`/v1/spaces/${spaceId}/members`, { memberIds: ['gagan'], actingMode: 'direct' });
  dmId = ((await admin().post('/v1/direct', { memberId: 'gagan' })).body as { space: Space }).space.id;
  agent = await agentClient(harbor, 'dev-ramnique', { agentName: 'Claude' });
});

afterAll(async () => {
  await agent.close();
  await harbor.close();
});

describe('the switch', () => {
  it('is off until an admin turns it on, and says so', async () => {
    expect(((await admin().get('/v1/spaces')).body as { spaces: Space[] }).spaces.find((s) => s.id === spaceId)!.graph).toBe(false);
    expect(await read()).toMatchObject({ status: 'off', threads: [], edges: [], entities: [] });
    expect(jev.asked).toHaveLength(0);
  });

  it('refuses a member who is not an admin, an outsider, and a DM', async () => {
    expect((await turn(true, gagan())).body).toMatchObject({ code: 'forbidden' });
    expect((await turn(true, outsider())).status).toBe(403);
    expect((await turn(true, admin(), dmId)).body).toMatchObject({ code: 'invalid_request' });
    expect((await outsider().get(`/v1/spaces/${spaceId}/graph`)).status).toBe(403);
    expect(await eventsOf('space_graph_changed')).toHaveLength(0);
  });
});

describe('building', () => {
  let bugRoot: string;
  let decisionRoot: string;

  it('judges each thread once it is on, and reads back threads, entities and edges with events', async () => {
    // Enough threads naming the same things for the statistics to propose them as topics.
    bugRoot = await post(admin(), 'The Harbor server drops frames after a deploy, see https://github.com/rowboatlabs/rowboat/pull/1300');
    await post(gagan(), 'Looking at Harbor now, the lock in `lockedAs` is held too long', bugRoot);
    await post(gagan(), 'fixed in #1301', bugRoot);
    decisionRoot = await post(admin(), 'We decided to keep Harbor on Postgres rather than move it');
    await post(admin(), 'Is Harbor fine after the Postgres upgrade?');
    await post(gagan(), 'Should Harbor expose `lockedAs` to connectors? It touches Postgres directly');
    await post(gagan(), 'Reminder that `lockedAs` wraps the transaction');

    const on = await turn(true);
    expect(on.status).toBe(200);
    expect((on.body as { space: Space }).space.graph).toBe(true);
    const graph = await settled(5);

    const bug = graph.threads.find((t) => t.rootMessageId === bugRoot)!;
    expect(bug).toMatchObject({ kind: 'bug', messageCount: 3, resolved: 0.9, importance: 2, opening: { memberId: 'ramnique' }, latest: { memberId: 'gagan', text: 'fixed in #1301' } });
    expect(graph.threads.find((t) => t.rootMessageId === decisionRoot)).toMatchObject({ kind: 'decision', decision: 0.95, importance: 3.5 });

    const edgesOf = (root: string) => Object.fromEntries(graph.edges.filter((e) => e.rootMessageId === root).map((e) => [e.entityId, e]));
    const edges = edgesOf(bugRoot);
    // Members by the part Jev gave them; the topic it called central; the identifier three threads name; both references, the bare one resolved to the space's repository.
    expect(Object.keys(edges).sort()).toEqual(['code:lockedAs', 'member:gagan', 'member:ramnique', 'reference:rowboatlabs/rowboat#1300', 'reference:rowboatlabs/rowboat#1301', 'topic:harbor']);
    expect(edges['member:gagan']).toMatchObject({ relation: 'doer', probability: 0.9, strength: 0.95 });
    expect(edges['member:ramnique']).toMatchObject({ relation: 'requester', strength: 0.86 });
    expect(edges['topic:harbor']).toMatchObject({ relation: 'subject', probability: 0.9, strength: 0.9 });
    expect(edges['reference:rowboatlabs/rowboat#1301']).toMatchObject({ relation: 'produced', strength: 0.9 });
    // One message is one unit, split across what it touched: Gagan's second reply named Harbor and lockedAs, his third only #1301.
    expect(edges['member:gagan']!.events.map((e) => e.share)).toEqual([0.33, 0.5]);
    expect(edges['topic:harbor']!.events).toHaveLength(2);

    expect(graph.entities.find((e) => e.id === 'member:gagan')).toMatchObject({ kind: 'member', label: 'Gagan', memberId: 'gagan' });
    expect(graph.entities.find((e) => e.id === 'topic:harbor')).toMatchObject({ kind: 'topic', label: 'Harbor', category: 'own_component' });
    expect(graph.entities.find((e) => e.id === 'reference:rowboatlabs/rowboat#1301')).toMatchObject({ kind: 'reference', label: '#1301', url: 'https://github.com/rowboatlabs/rowboat/issues/1301' });
    // A subject the fake called a passing mention left no edge at all.
    expect(graph.edges.some((e) => e.entityId === 'topic:postgres' && e.rootMessageId === bugRoot)).toBe(false);
  });

  it('never tells Jev an id: members go by name, and the thread by its text', async () => {
    const thread = jev.asked.find((a) => 'kind' in a.questions && JSON.stringify(a.state).includes('drops frames'))!;
    const sent = JSON.stringify(thread);
    expect(sent).toContain('Gagan (person)');
    expect(sent).not.toContain(spaceId);
    expect(sent).not.toMatch(/"memberId"|ramnique"/);
    expect(Object.keys(thread.questions).filter((k) => k.startsWith('member_'))).toHaveLength(2);
  });

  it('one event on the log per flip, attributed; a repeat is a no-op', async () => {
    expect((await turn(true)).status).toBe(200);
    const events = await eventsOf('space_graph_changed');
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toMatchObject({ space: { id: spaceId, graph: true }, by: { memberId: 'ramnique', actingMode: 'direct' } });
  });

  it('does not ask again about a thread that has not changed, and asks again when it has', async () => {
    const before = jev.asked.length;
    await new Promise((r) => setTimeout(r, 200)); // several passes
    expect(jev.asked.length).toBe(before);

    await post(admin(), 'confirmed fixed, thanks', bugRoot);
    const graph = await until(async () => { const g = await read(); return g.pending === 0 && g.threads.find((t) => t.rootMessageId === bugRoot)?.messageCount === 4 ? g : undefined; }, 'the reply to be judged');
    expect(jev.asked.length).toBe(before + 1);
    expect(graph.edges.find((e) => e.rootMessageId === bugRoot && e.entityId === 'member:ramnique')!.events).toHaveLength(2);
  });

  it('a failed request leaves the thread pending, and the next pass judges it', async () => {
    jev.failNext = true;
    const root = await post(gagan(), 'Harbor needs a health check');
    const graph = await settled(6);
    expect(graph.threads.some((t) => t.rootMessageId === root)).toBe(true);
  });

  it('a deleted message leaves no text and no thread behind', async () => {
    const root = await post(gagan(), 'Harbor secret plan that should not survive');
    await settled(7);
    expect((await gagan().post(`/v1/spaces/${spaceId}/messages/${root}/delete`, { actingMode: 'direct' })).status).toBe(200);
    const graph = await settled(6);
    expect(JSON.stringify(graph)).not.toContain('secret plan');
    // The read already hides it; the worker's next pass removes the row.
    await until(async () => !(await harbor.store.listGraphThreads(spaceId)).some((t) => t.rootMessageId === root), 'the deleted thread\'s row to go');
  });
});

describe('reading', () => {
  it('about one thing: only its threads, by name, alias, id or reference, strongest first', async () => {
    const harborOnly = await read('?about=harbor');
    expect(harborOnly.status).toBe('ready');
    expect(harborOnly.threads.length).toBeGreaterThanOrEqual(4);
    expect(harborOnly.edges.every((e) => harborOnly.threads.some((t) => t.rootMessageId === e.rootMessageId))).toBe(true);
    const weights = new Map(weighGraph(harborOnly).filter((w) => w.edge.entityId === 'topic:harbor').map((w) => [w.edge.rootMessageId, w.weight]));
    const order = harborOnly.threads.map((t) => weights.get(t.rootMessageId) ?? 0);
    expect(order).toEqual([...order].sort((a, b) => b - a));

    expect((await read('?about=%231301')).threads).toHaveLength(1);
    expect((await read('?about=member:gagan')).threads.length).toBeGreaterThanOrEqual(3);
    expect((await read('?about=%40Gagan')).threads.length).toBeGreaterThanOrEqual(3);
    expect(await read('?about=nothing-like-this')).toMatchObject({ status: 'ready', threads: [], edges: [] });
    expect((await read('?limit=2')).threads).toHaveLength(2);
    expect((await gagan().get(`/v1/spaces/${spaceId}/graph?limit=0`)).status).toBe(400);
  });

  it('the agent face reads the same graph and flips the same switch, attributed', async () => {
    const graph = await call<SpaceGraph>(agent, 'read_graph', { spaceId, about: 'Harbor', limit: 3 });
    expect(graph.status).toBe('ready');
    expect(graph.threads).toHaveLength(3);
    expect(graph.entities.some((e) => e.id === 'topic:harbor')).toBe(true);

    const off = await call<{ space: Space }>(agent, 'set_space_graph', { spaceId, enabled: false });
    expect(off.space.graph).toBe(false);
    const events = await eventsOf('space_graph_changed');
    expect(events).toHaveLength(2);
    expect(events[1]!.event).toMatchObject({ space: { graph: false }, by: { memberId: 'ramnique', actingMode: 'agent', agentName: 'Claude' } });
  });

  it('off deletes what was derived and stops asking', async () => {
    expect(await read()).toMatchObject({ status: 'off', threads: [] });
    expect(await harbor.store.listGraphThreads(spaceId)).toEqual([]);
    expect(await harbor.store.listGraphTopics(spaceId)).toEqual([]);
    const before = jev.asked.length;
    await post(gagan(), 'Harbor again, after the graph was turned off');
    await new Promise((r) => setTimeout(r, 200));
    expect(jev.asked.length).toBe(before);
  });
});

describe('a server without Jev', () => {
  it('says unavailable and refuses to turn the graph on', async () => {
    const plain = await startTestHarbor({ seedMembers: [{ id: 'ramnique', displayName: 'Ramnique' }], seedSpaces: [{ name: 'Engineering', creator: 'ramnique' }] });
    try {
      const client = restClient(plain, 'dev-ramnique');
      const id = ((await client.get('/v1/spaces')).body as { spaces: Space[] }).spaces[0]!.id;
      expect((await client.get(`/v1/spaces/${id}/graph`)).body).toMatchObject({ status: 'unavailable' });
      expect((await client.post(`/v1/spaces/${id}/graph`, { enabled: true, actingMode: 'direct' })).body).toMatchObject({ code: 'invalid_request' });
      expect((await client.post(`/v1/spaces/${id}/graph`, { enabled: false, actingMode: 'direct' })).status).toBe(200);
    } finally {
      await plain.close();
    }
  });
});

describe('what the parsers find', () => {
  it('references: GitHub links anywhere, a bare number only in the space\'s own repository', () => {
    const main = mainRepository(['https://github.com/acme/app/pull/12 and https://github.com/acme/app/issues/9', 'https://github.com/other/lib/pull/3']);
    expect(main).toBe('acme/app');
    expect(referencesIn('see #1234, https://github.com/other/lib/pull/3 and https://x.dev/a#567', main).sort()).toEqual(['acme/app#1234', 'other/lib#3']);
    expect(referencesIn('see #1234', undefined)).toEqual([]);
    expect(referencesIn('[@Sam](#member:01ABC) and color #fff and #12', main)).toEqual([]);
  });

  it('code: backticked identifiers, not fenced blocks or prose', () => {
    expect(codeIn('call `lockedAs()` in `./src/kernel.ts`\n```\n`notThis`\n```\n`a whole sentence in backticks here`')).toEqual(['lockedAs', 'src/kernel.ts']);
  });

  it('topics: recurring proper nouns and collocations, never a member\'s name or a template', () => {
    const threads = [
      { id: '1', bodies: ['We moved the Harbor server today', 'Sam said the Harbor server is fine'] },
      { id: '2', bodies: ['Is Harbor up? Ask Sam'] },
      { id: '3', bodies: ['The Harbor server restarted, Sam saw it'] },
      { id: '4', bodies: ['Daily Standup Prompt 1', 'Daily Standup Prompt 2'] },
      { id: '5', bodies: ['Daily Standup Prompt 3'] },
      { id: '6', bodies: ['nothing here'] },
    ];
    const keys = topicCandidates(threads, ['Sam Smith']).map((c) => c.key);
    expect(keys).toContain('harbor');
    expect(keys).toContain('harbor server');
    expect(keys).not.toContain('sam');
    // The standup prompt is one template posted three times: it counts once, so it does not recur.
    expect(keys.some((k) => k.includes('standup'))).toBe(false);
  });

  it('same-topic shortlist: containment or a shared name, not a shared common word', () => {
    expect(mayBeSameTopic('harbor', 'harbor server')).toBe(true);
    expect(mayBeSameTopic('standup summary', 'daily standup summary')).toBe(true);
    expect(mayBeSameTopic('web app', 'mobile app')).toBe(false);
    expect(mayBeSameTopic('harbor', 'postgres')).toBe(false);
  });
});

describe('the Jev client', () => {
  let server: Server;
  let url: string;
  const received: { path: string; auth: string | undefined; body: { model: string; state: Json; questions: Record<string, JevQuestion> } }[] = [];
  let respond: (n: number) => { status: number; body: unknown } = () => ({ status: 200, body: {} });

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      req.on('end', () => {
        received.push({ path: req.url ?? '', auth: req.headers.authorization, body: JSON.parse(raw) as never });
        const { status, body } = respond(received.length);
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    url = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('posts state and questions to /v1/systemone with the key and OpenRouter\'s model id, and reads each type', async () => {
    respond = () => ({ status: 200, body: { answers: { a: { type: 'noul', noul: 0.7 }, b: { type: 'choice', choice: 'x', probabilities: { x: 0.6, y: 0.4 }, confidence: 0.2 }, c: { type: 'score', score: 1.5 } } } });
    const answers = await jevApi('sk-test', url).ask('half an emoji \ud83d', {
      a: { type: 'noul', instructions: 'q' },
      b: { type: 'choice', instructions: 'q', criteria: { x: 'X', y: 'Y' } },
      c: { type: 'score', instructions: 'q', criteria: ['low', 'high'] },
    });
    expect(answers).toEqual({ a: { type: 'noul', noul: 0.7 }, b: { type: 'choice', choice: 'x', probabilities: { x: 0.6, y: 0.4 } }, c: { type: 'score', score: 1.5 } });
    expect(received[0]).toMatchObject({ path: '/v1/systemone', auth: 'Bearer sk-test', body: { model: '~typesafe/jev-latest', state: 'half an emoji �' } });
  });

  it('retries when Jev is busy, and refuses an answer that does not fit its question', async () => {
    const start = received.length;
    respond = (n) => (n === start + 1 ? { status: 429, body: {} } : { status: 200, body: { answers: { a: { type: 'noul', noul: 1 } } } });
    expect(await jevApi('k', url).ask('s', { a: { type: 'noul', instructions: 'q' } })).toEqual({ a: { type: 'noul', noul: 1 } });
    expect(received.length).toBe(start + 2);

    respond = () => ({ status: 200, body: { answers: { a: { type: 'choice', choice: 'not-an-option', probabilities: {} } } } });
    await expect(jevApi('k', url).ask('s', { a: { type: 'choice', instructions: 'q', criteria: { x: 'X' } } })).rejects.toBeInstanceOf(JevError);
    respond = () => ({ status: 401, body: { error: 'bad key' } });
    await expect(jevApi('k', url).ask('s', { a: { type: 'noul', instructions: 'q' } })).rejects.toMatchObject({ status: 401 });
  });
});
