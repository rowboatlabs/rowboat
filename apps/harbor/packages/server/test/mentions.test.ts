import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  mapMentionTokens,
  mentionToken,
  mentionsAsText,
  parseMentions,
  relabelMentions,
  type Message,
} from '@rowboat/spaces-protocol';
import { legacyToTokens } from '../src/mentions-backfill.js';
import { PgStore } from '../src/pg-store.js';
import { searchTextFor } from '../src/search.js';
import { startHarbor, type HarborOptions, type RunningHarbor } from '../src/server.js';
import type { SqlDb } from '../src/sql.js';
import { agentClient, callStructured, restClient } from './helpers.js';
import { pgliteDb } from './pglite.js';

// Mentions (2026-09-10, protocol mentions.ts): one grammar — link tokens with
// the id in the href — and one parser. The org STAMPS who a message addresses
// from tokens alone (never from names, only space members), a mention follows
// you into the thread, unread counts carry a mention number, push reads the
// stamp, the agent face re-resolves labels, and the search index collapses
// tokens to ids. The pre-token spelling is rewritten once by the backfill,
// through the ordinary edit path as the author.

const tok = (id: string, label = id) => mentionToken({ kind: 'member', id, label });

describe('the grammar', () => {
  it('parses tokens, dedupes ids, and treats tokens inside code as cites', () => {
    const body = `hey ${tok('ramnique', 'Ramnique')} and ${tok('harsh', 'H')} and ${tok('ramnique')} — [@here](#here) \`${tok('arjun')}\` \`\`\`\n[@rowboat](#rowboat)\n\`\`\``;
    expect(parseMentions(body)).toEqual({ members: ['ramnique', 'harsh'], here: true, rowboat: false });
    expect(parseMentions('a bare @ramnique and @here are prose')).toEqual({ members: [], here: false, rowboat: false });
    expect(parseMentions('[@rowboat](#rowboat) summarise')).toMatchObject({ rowboat: true });
  });

  it('serializes a token; brackets and newlines never reach a label', () => {
    expect(mentionToken({ kind: 'member', id: 'x', label: 'Ram [S]\nSingh' })).toBe('[@Ram  S  Singh](#member:x)');
    expect(mentionToken({ kind: 'member', id: 'x', label: '' })).toBe('[@x](#member:x)');
    expect(mentionToken({ kind: 'here' })).toBe('[@here](#here)');
  });

  it('relabels from the roster, keeps unknown ids, and flattens to text', () => {
    const names = new Map([['ramnique', 'Ramnique Singh']]);
    const body = `ping ${tok('ramnique', 'Ram')} and ${tok('ghost', 'Ghost')} and [@here](#here)`;
    expect(relabelMentions(body, names)).toBe(`ping ${tok('ramnique', 'Ramnique Singh')} and ${tok('ghost', 'Ghost')} and [@here](#here)`);
    expect(mentionsAsText(body, names)).toBe('ping @Ramnique Singh and @Ghost and @here');
    expect(mapMentionTokens(`\`${tok('a')}\` ${tok('b')}`, (ref) => (ref.kind === 'member' ? ref.id.toUpperCase() : 'x'))).toBe(`\`${tok('a')}\` B`);
  });

  it('the search text collapses tokens to bare keys so labels and "member" never index', () => {
    expect(searchTextFor(`ask ${tok('ramnique', 'Ramnique Singh')} about [@here](#here)`)).toBe('ask ramnique about here');
  });

  it('the backfill rewrites the pre-token spelling for known ids only, punctuation intact, idempotently', () => {
    const names = new Map([['ramnique', 'Ramnique'], ['harsh', 'Harsh']]);
    const legacy = 'cc @ramnique, @harsh. and @nobody (@here) `@harsh` @rowboat';
    const once = legacyToTokens(legacy, names);
    expect(once).toBe(`cc ${tok('ramnique', 'Ramnique')}, ${tok('harsh', 'Harsh')}. and @nobody ([@here](#here)) \`@harsh\` [@rowboat](#rowboat)`);
    expect(legacyToTokens(once, names)).toBe(once);
  });
});

let harbor: RunningHarbor;
let sqlDb: SqlDb | undefined;
let ramnique: ReturnType<typeof restClient>;
let harsh: ReturnType<typeof restClient>;
let arjun: ReturnType<typeof restClient>;
let main: string;

async function startForStore(kind: 'memory' | 'postgres'): Promise<void> {
  const options: HarborOptions = {
    orgName: 'Rowboat Labs',
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'harsh', displayName: 'Harsh' },
      { id: 'arjun', displayName: 'Arjun' },
      { id: 'gagan', displayName: 'Gagan' },
    ],
    seedSpaces: [{ name: 'Main', creator: 'ramnique' }],
  };
  if (kind === 'postgres') {
    sqlDb = await pgliteDb();
    const store = new PgStore(sqlDb);
    await store.init();
    options.store = store;
  }
  harbor = await startHarbor(options);
  ramnique = restClient(harbor, 'dev-ramnique');
  harsh = restClient(harbor, 'dev-harsh');
  arjun = restClient(harbor, 'dev-arjun');
  // Seed spaces take every seed member; this one takes three, so Gagan is an
  // org member who is NOT in it.
  main = (await ramnique.post('/v1/spaces', { name: 'Mentions' })).body.space.id;
  for (const member of [harsh, arjun]) {
    const invite = await ramnique.post('/v1/invites', { spaceId: main });
    expect((await member.post('/v1/invites/accept', { token: invite.body.token })).status).toBe(200);
  }
}

async function post(client: ReturnType<typeof restClient>, body: string, threadRoot?: string): Promise<Message> {
  const r = await client.post(`/v1/spaces/${main}/messages`, { body, actingMode: 'direct', ...(threadRoot ? { threadRoot } : {}) });
  expect(r.status).toBe(200);
  return r.body.message as Message;
}

async function unreadOf(client: ReturnType<typeof restClient>) {
  const r = await client.get('/v1/unread');
  return (r.body.spaces as Array<{ spaceId: string }>).find((s) => s.spaceId === main) as
    | { readOffset: number; unreadRoots: number; unreadMentions: number; threads: Array<{ rootMessageId: string; unreadReplies: number; unreadMentions: number }> }
    | undefined;
}

describe.each([['memory'], ['postgres']] as const)('mentions (%s store)', (storeKind) => {
  let root: Message;

  beforeAll(async () => {
    await startForStore(storeKind);
  });

  afterAll(async () => {
    await harbor.close();
    await sqlDb?.close();
    sqlDb = undefined;
  });

  it('stamps only tokens naming space members; a bare name or a non-member id is prose', async () => {
    root = await post(harsh, `hey ${tok('ramnique', 'Ramnique')}, ${tok('gagan', 'Gagan')}, ${tok('nobody')} and @Arjun`);
    expect(root).toMatchObject({ mentions: ['ramnique'], mentionsHere: false, mentionsRowboat: false });
    const stream = await ramnique.get(`/v1/spaces/${main}/stream`);
    expect(stream.body.messages.find((m: Message) => m.id === root.id).mentions).toEqual(['ramnique']);
  });

  it('a mention follows you into the thread and counts as an unread mention; @here counts but follows nobody', async () => {
    expect(await unreadOf(ramnique)).toMatchObject({ unreadRoots: 1, unreadMentions: 1 });
    expect((await ramnique.get(`/v1/spaces/${main}/threads/${root.id}`)).body.following).toBe(true);
    expect((await arjun.get(`/v1/spaces/${main}/threads/${root.id}`)).body.following).toBe(false);

    const here = await post(harsh, 'standup in 5 [@here](#here)');
    expect(here.mentionsHere).toBe(true);
    expect(await unreadOf(arjun)).toMatchObject({ unreadRoots: 2, unreadMentions: 1 });
    expect((await arjun.get(`/v1/spaces/${main}/threads/${here.id}`)).body.following).toBe(false);

    // A mention in a reply: the thread entry carries its own mention number, the space number sums both.
    const reply = await post(arjun, `${tok('ramnique', 'Ramnique')} thoughts?`, root.id);
    expect(reply.mentions).toEqual(['ramnique']);
    const u = await unreadOf(ramnique);
    expect(u!.threads).toEqual([expect.objectContaining({ rootMessageId: root.id, unreadReplies: 1, unreadMentions: 1 })]);
    // Two unread roots address ramnique (the mention and the @here) plus the reply.
    expect(u!.unreadMentions).toBe(3);

    // Reading the stream clears the root mention; the thread's stays.
    await ramnique.post(`/v1/spaces/${main}/read`, { offset: here.offset });
    expect(await unreadOf(ramnique)).toMatchObject({ unreadMentions: 1 });
    await ramnique.post(`/v1/spaces/${main}/read`, { threadRootId: root.id, offset: reply.offset });
    expect(await unreadOf(ramnique)).toMatchObject({ unreadMentions: 0, threads: [] });
  });

  it('an edit re-stamps and follows the newly mentioned; a delete clears the stamp', async () => {
    const m = await post(harsh, 'draft');
    expect(m.mentions).toEqual([]);
    const edited = await harsh.post(`/v1/spaces/${main}/messages/${m.id}/edit`, { body: `draft for ${tok('arjun', 'Arjun')}`, actingMode: 'direct' });
    expect(edited.body.message).toMatchObject({ mentions: ['arjun'], editedAt: expect.any(String) });
    expect((await arjun.get(`/v1/spaces/${main}/threads/${m.id}`)).body.following).toBe(true);
    expect((await unreadOf(arjun))!.unreadMentions).toBeGreaterThan(0);
    const events = await harbor.service.eventsAfter(main, 0);
    const edit = events.map((e) => e.event).find((e) => e.type === 'message_edited' && e.edit.messageId === m.id);
    expect(edit).toMatchObject({ edit: { mentions: ['arjun'] } });

    const before = (await unreadOf(arjun))!.unreadMentions;
    const deleted = await harsh.post(`/v1/spaces/${main}/messages/${m.id}/delete`, { actingMode: 'direct' });
    expect(deleted.body.message).toMatchObject({ mentions: [], mentionsHere: false });
    expect((await unreadOf(arjun))!.unreadMentions).toBe(before - 1);
  });

  it('search finds a mention by the current name, never by the label or the word "member"', async () => {
    const m = await post(harsh, `roadmap review with ${tok('ramnique', 'Old Label')}`);
    const byName = await ramnique.get(`/v1/spaces/${main}/search?q=${encodeURIComponent('Ramnique roadmap')}`);
    expect(JSON.stringify(byName.body.messages)).toContain(m.id);
    const byLabel = await ramnique.get(`/v1/spaces/${main}/search?q=${encodeURIComponent('Old Label')}`);
    expect(JSON.stringify(byLabel.body.messages)).not.toContain(m.id);
    const byKeyword = await ramnique.get(`/v1/spaces/${main}/search?q=member`);
    expect(JSON.stringify(byKeyword.body.messages)).not.toContain(m.id);
  });

  it('the agent face re-resolves every label from the roster', async () => {
    const m = await post(harsh, `for ${tok('ramnique', 'Whoever')} and ${tok('ghost', 'Ghost')}`);
    const client: Client = await agentClient(harbor, 'dev-arjun');
    const thread = await callStructured<{ root: Message }>(client, 'read_thread', { spaceId: main, rootMessageId: m.id });
    expect(thread.root.body).toBe(`for ${tok('ramnique', 'Ramnique')} and ${tok('ghost', 'Ghost')}`);
    const stream = await callStructured<{ messages: Message[] }>(client, 'read_stream', { spaceId: main });
    expect(stream.messages.find((x) => x.id === m.id)!.body).toContain(tok('ramnique', 'Ramnique'));
    await client.close();
  });

  it('the backfill rewrites the pre-token spelling through the edit path as the author, once', async () => {
    const head = await harbor.service.headOffset(main);
    const legacy: Message = {
      id: '01J8ZZZZZZZZZZZZZZZZZZZZZA',
      spaceId: main,
      author: { memberId: 'harsh', actingMode: 'direct' },
      body: 'cc @ramnique and @here — `@arjun` stays',
      postedAt: new Date().toISOString(),
      offset: head + 1,
      replyCount: 0,
      reactions: [],
      mentions: [],
      mentionsHere: false,
      mentionsRowboat: false,
    };
    await harbor.store.appendMessage(legacy);
    await harbor.store.appendEvent(main, { offset: head + 1, at: legacy.postedAt, event: { type: 'message', message: legacy } });
    const topic = await harsh.post(`/v1/spaces/${main}/topics`, { rootMessageId: legacy.id, title: 'ask @ramnique', actingMode: 'direct' });
    expect(topic.status).toBe(200);

    // The boot pass already ran (and recorded itself) on an empty org; force it once for the seeded rows.
    const first = await harbor.service.migrateMentions({ force: true });
    expect(first).toEqual({ messages: 1, titles: 1, restamped: 0 });
    const after = (await harbor.store.getMessage(main, legacy.id))!;
    expect(after.body).toBe(`cc ${tok('ramnique', 'Ramnique')} and [@here](#here) — \`@arjun\` stays`);
    expect(after).toMatchObject({ mentions: ['ramnique'], mentionsHere: true, editedAt: expect.any(String) });
    expect((await harbor.store.getTopic(main, topic.body.topic.id))!.title).toBe(`ask ${tok('ramnique', 'Ramnique')}`);
    // The log says the author edited it, and replay serves the new spelling.
    const events = await harbor.service.eventsAfter(main, head + 1);
    expect(events.map((e) => e.event.type)).toEqual(['topic', 'message_edited', 'topic']);
    const edit = events.find((e) => e.event.type === 'message_edited')!.event as Extract<(typeof events)[number]['event'], { type: 'message_edited' }>;
    expect(edit.edit.by).toEqual({ memberId: 'harsh', actingMode: 'direct' });
    const stored = (await harbor.service.eventsAfter(main, head)).find((e) => e.offset === head + 1)!.event as Extract<(typeof events)[number]['event'], { type: 'message' }>;
    expect(stored.message.body).toBe(after.body);
    expect(stored.message.mentions).toEqual(['ramnique']);

    expect(await harbor.service.migrateMentions({ force: true })).toEqual({ messages: 0, titles: 0, restamped: 0 });
    expect(await harbor.service.migrateMentions()).toEqual({ messages: 0, titles: 0, restamped: 0 }); // the ledger: never again
    expect((await harbor.service.eventsAfter(main, head + 1)).length).toBe(3);
  });
});
