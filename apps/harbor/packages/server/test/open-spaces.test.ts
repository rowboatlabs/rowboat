import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Space, mcpTools, readOnlyMcpToolNames, routes, type Message } from '@rowboat/spaces-protocol';
import { blobHash } from '../src/blobs.js';
import { decideNotifications } from '../src/notify.js';
import type { RunningHarbor } from '../src/server.js';
import { agentClient, liveClient, restClient, startTestHarbor } from './helpers.js';

let harbor: RunningHarbor;
let owner: ReturnType<typeof restClient>;
let browser: ReturnType<typeof restClient>;
let spaceId: string;
let privateId: string;
let dmId: string;
let messageId: string;
let topicId: string;
let assetId: string;
const by = { actingMode: 'direct' };
const refusal = { code: 'forbidden', message: 'join this space to post' };
const base = () => `/v1/spaces/${spaceId}`;
const put = (id: string, token: string, content: Buffer<ArrayBuffer>) => fetch(`${harbor.url}/v1/spaces/${id}/blobs`, {
  method: 'PUT', headers: { authorization: `Bearer ${token}`, 'x-blob-sha256': blobHash(content) }, body: content,
});


beforeAll(async () => {
  harbor = await startTestHarbor({ seedMembers: [
    { id: 'owner', displayName: 'Owner' }, { id: 'browser', displayName: 'Browser' },
    { id: 'other', displayName: 'Other' },
  ] });
  owner = restClient(harbor, 'dev-owner');
  browser = restClient(harbor, 'dev-browser');
  const created = await owner.post('/v1/spaces', { name: 'Open', visibility: 'open' });
  expect(created.status).toBe(200);
  spaceId = created.body.space.id;
  privateId = (await owner.post('/v1/spaces', { name: 'Private' })).body.space.id;
  dmId = (await owner.post('/v1/direct', { memberId: 'other' })).body.space.id;
  const post = await owner.post(`${base()}/messages`, { ...by, body: 'preview needle', poll: {
    question: 'Ready?', answers: [{ text: 'Yes' }, { text: 'No' }],
  } });
  expect(post.status).toBe(200);
  messageId = post.body.message.id;
  await owner.post(`${base()}/messages`, { ...by, body: 'a reply', threadRoot: messageId });
  const topic = await owner.post(`${base()}/topics`, { ...by, rootMessageId: messageId, title: 'Preview topic' });
  expect(topic.status).toBe(200);
  topicId = topic.body.topic.id;
  const asset = await owner.post(`${base()}/assets`, { ...by, path: 'preview.md', newContent: 'needle version one\n' });
  expect(asset.status).toBe(200);
  assetId = asset.body.asset.id;
  await owner.post(`${base()}/changes`, { ...by, assetId, baseVersion: 1, newContent: 'needle version two\n' });
});
afterAll(async () => { await harbor.close(); });

beforeEach(async () => {
  if (await harbor.store.getMembership(spaceId, 'browser')) await harbor.service.leaveSpace({ memberId: 'browser' }, spaceId);
});
afterEach(() => { harbor.service.readOnly = false; });

describe('open-space discovery and reading', () => {
  it('defaults old payloads to private', async () => {
    expect(Space.parse({ id: spaceId, name: 'Legacy', createdAt: new Date().toISOString() }).visibility).toBe('private');
  });

  it('defaults creation to private', async () => {
    const spaces = (await owner.get('/v1/spaces?includeDirect=1')).body.spaces;
    expect(spaces.find((s: Space) => s.id === privateId).visibility).toBe('private');
  });

  it('keeps direct spaces private', async () => {
    const spaces = (await owner.get('/v1/spaces?includeDirect=1')).body.spaces;
    expect(spaces.find((s: Space) => s.id === dmId).visibility).toBe('private');
  });

  it('rejects invalid visibility', async () => {
    expect((await owner.post('/v1/spaces', { name: 'Invalid', visibility: 'public' })).status).toBe(400);
  });

  it('preserves visibility on rename', async () => {
    const renamed = await owner.post(`${base()}/rename`, { ...by, name: 'Open renamed' });
    expect(renamed.body.space.visibility).toBe('open');
  });

  it('browses only shared open spaces', async () => {
    const result = await browser.get('/v1/spaces/browse');
    expect(result.status).toBe(200);
    const parsed = routes.browseSpaces.response.parse(result.body);
    expect(parsed.spaces).toEqual([{ space: expect.objectContaining({ id: spaceId, visibility: 'open' }), joined: false }]);
  });

  it('marks joined spaces in browse results', async () => {
    expect((await owner.get('/v1/spaces/browse')).body.spaces[0].joined).toBe(true);
  });

  it('browsing leaves membership listings unchanged', async () => {
    await browser.get('/v1/spaces/browse');
    expect((await browser.get('/v1/spaces')).body.spaces).toEqual([]);
  });

  it('requires authentication to browse', async () => {
    expect((await fetch(`${harbor.url}/v1/spaces/browse`)).status).toBe(401);
  });

  it('requires org membership to browse', async () => {
    await expect(harbor.service.browseSpaces({ memberId: 'missing' })).rejects.toMatchObject({ code: 'not_a_member' });
  });

  it('requires org membership for preview reads', async () => {
    await expect(harbor.service.listStream({ memberId: 'missing' }, spaceId)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it.each([
    ['stream', () => '/stream'],
    ['thread', () => `/threads/${messageId}`],
    ['message', () => `/messages/${messageId}`],
    ['topics', () => '/topics'],
    ['members', () => '/members'],
    ['search', () => '/search?q=needle'],
    ['assets', () => '/assets'],
    ['asset', () => `/assets/${assetId}`],
    ['asset version', () => `/assets/${assetId}?version=1`],
    ['history', () => `/history?assetId=${assetId}`],
    ['diff', () => `/diff?assetId=${assetId}&from=1&to=2`],
  ] as Array<[string, () => string]>)('permits preview reads of %s', async (_name, path) => {
    expect((await browser.get(base() + path())).status).toBe(200);
  });

  it('returns stream content before joining', async () => {
    expect((await browser.get(`${base()}/stream`)).body.messages.some((m: Message) => m.id === messageId)).toBe(true);
  });

  it('returns historical file content before joining', async () => {
    expect((await browser.get(`${base()}/assets/${assetId}?version=1`)).body.content).toBe('needle version one\n');
  });

  it('preview reads create no membership or personal state', async () => {
    await browser.get(`${base()}/stream`);
    await browser.get(`${base()}/threads/${messageId}`);
    expect(await harbor.store.getMembership(spaceId, 'browser')).toBeUndefined();
    expect(await harbor.store.getThreadReadMark(spaceId, messageId, 'browser')).toBeUndefined();
    expect((await browser.get('/v1/unread')).body.spaces).toEqual([]);
    expect((await browser.get('/v1/activity')).body.items).toEqual([]);
  });

  it('downloads registered blobs', async () => {
    const bytes = Buffer.from('preview bytes');
    const hash = blobHash(bytes);
    expect((await put(spaceId, 'dev-owner', bytes)).status).toBe(200);
    const download = await fetch(`${harbor.url}${base()}/blobs/${hash}`, { headers: { authorization: 'Bearer dev-browser' } });
    expect(download.status).toBe(200);
    expect(await download.text()).toBe('preview bytes');
  });

  it('refuses blob uploads before joining', async () => {
    const refused = await put(spaceId, 'dev-browser', Buffer.from('refused bytes'));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject(refusal);
  });

  it('refuses blob hashes registered only in a private space', async () => {
    const secret = Buffer.from('private bytes');
    await put(privateId, 'dev-owner', secret);
    expect((await browser.get(`${base()}/blobs/${blobHash(secret)}`)).status).toBe(404);
  });

  it.each(['private', 'direct'])('refuses preview reads of a %s space', async (kind) => {
    const id = kind === 'private' ? privateId : dmId;
    for (const suffix of ['/stream', '/members', '/assets']) {
      expect((await browser.get(`/v1/spaces/${id}${suffix}`)).status).toBe(403);
    }
  });

  it.each(['private', 'direct'])('refuses self-join of a %s space', async (kind) => {
    const id = kind === 'private' ? privateId : dmId;
    expect((await browser.post(`/v1/spaces/${id}/join`)).status).toBe(403);
  });
});

describe('browsing does not authorize actions', () => {
  it.each([
    ['message posting', () => [`${base()}/messages`, { ...by, body: 'no' }]],
    ['message editing', () => [`${base()}/messages/${messageId}/edit`, { ...by, body: 'no' }]],
    ['message deletion', () => [`${base()}/messages/${messageId}/delete`, by]],
    ['reactions', () => [`${base()}/messages/${messageId}/reactions`, { ...by, emoji: '👍', action: 'add' }]],
    ['poll votes', () => [`${base()}/messages/${messageId}/poll/votes`, { ...by, answerId: 1, action: 'add' }]],
    ['poll ending', () => [`${base()}/messages/${messageId}/poll/end`, by]],
    ['topic creation', () => [`${base()}/topics`, { ...by, title: 'No', body: 'no' }]],
    ['topic management', () => [`${base()}/topics/${topicId}`, { ...by, action: 'archive' }]],
    ['asset creation', () => [`${base()}/assets`, { ...by, path: 'no.md', newContent: 'no' }]],
    ['changes', () => [`${base()}/changes`, { ...by, assetId, baseVersion: 2, newContent: 'no' }]],
    ['asset moves', () => [`${base()}/assets/move`, { ...by, assetId, baseVersion: 2, toPath: 'no.md' }]],
    ['asset deletion', () => [`${base()}/assets/delete`, { ...by, assetId, baseVersion: 2 }]],
    ['asset restoration', () => [`${base()}/assets/restore`, { ...by, assetId }]],
    ['renaming', () => [`${base()}/rename`, { ...by, name: 'No' }]],
    ['invites', () => ['/v1/invites', { spaceId }]],
    ['leaving', () => [`${base()}/leave`, {}]],
    ['read marks', () => [`${base()}/read`, { offset: 1 }]],
    ['following', () => [`${base()}/threads/${messageId}/follow`, { following: true }]],
    ['mark-all-read', () => ['/v1/activity/read-all', { spaceId }]],
  ] as Array<[string, () => [string, object]]>)('refuses %s before joining without writes', async (_name, request) => {
    const head = await harbor.store.head(spaceId);
    const [path, input] = request();
    const result = await browser.post(path, input);
    expect(result.status, JSON.stringify(result.body)).toBe(403);
    expect(result.body).toMatchObject(refusal);
    expect(await harbor.store.head(spaceId)).toBe(head);
    expect(await harbor.store.getMembership(spaceId, 'browser')).toBeUndefined();
    expect(await harbor.store.getThreadReadMark(spaceId, messageId, 'browser')).toBeUndefined();
    expect((await owner.get(`${base()}/assets/${assetId}`)).body.version).toBe(2);
  });

  it('receives the complete live replay without joining', async () => {
    const live = await liveClient(harbor, 'dev-browser');
    try {
      const head = await harbor.store.head(spaceId);
      live.send({ kind: 'subscribe', spaceId, afterOffset: 0 });
      await live.until((fs) => fs.some((f) => f.kind === 'event' && f.offset === head));
      expect(live.events().map((f) => f.offset)).toEqual(Array.from({ length: head }, (_, i) => i + 1));
    } finally { live.close(); }
  });

  it.each(['presence', 'whiteboard'] as const)('refuses %s publication before joining', async (kind) => {
    const live = await liveClient(harbor, 'dev-browser');
    try {
      live.send({ kind: 'subscribe', spaceId });
      await live.until((fs) => fs.some((f) => f.kind === 'subscribed'));
      live.send(kind === 'presence'
        ? { kind, spaceId, state: 'typing' }
        : { kind, spaceId, boardId: 'preview-board', payload: {} });
      await live.until((fs) => fs.some((f) => f.kind === 'error'));
      expect(live.frames.filter((f) => f.kind === 'error')).toEqual([expect.objectContaining(refusal)]);
    } finally { live.close(); }
  });

  it('receives new live events without joining', async () => {
    const live = await liveClient(harbor, 'dev-browser');
    try {
      live.send({ kind: 'subscribe', spaceId });
      await live.until((fs) => fs.some((f) => f.kind === 'subscribed'));
      const posted = await owner.post(`${base()}/messages`, { ...by, body: 'live preview' });
      await live.until((fs) => fs.some((f) => f.kind === 'event' && f.event.type === 'message' && f.event.message.id === posted.body.message.id));
    } finally { live.close(); }
  });

  it('does not acquire notification eligibility while browsing', async () => {
    const live = await liveClient(harbor, 'dev-browser');
    try {
      live.send({ kind: 'subscribe', spaceId });
      await live.until((fs) => fs.some((f) => f.kind === 'subscribed'));
      const posted = await owner.post(`${base()}/messages`, { ...by, body: '[@Browser](#member:browser) [@here](#here)' });
      const message = posted.body.message as Message;
      await live.until((fs) => fs.some((f) => f.kind === 'event' && f.event.type === 'message' && f.event.message.id === message.id));
      expect(message.mentions).not.toContain('browser');
      const recipients = await decideNotifications(harbor.store, (await harbor.store.getSpace(spaceId))!, message);
      expect(recipients.map((r) => r.memberId)).not.toContain('browser');
      expect(live.frames.some((f) => f.kind === 'notify' || f.kind === 'read_mark')).toBe(false);
      expect((await browser.get('/v1/unread')).body.spaces).toEqual([]);
      expect((await browser.get('/v1/activity')).body.items).toEqual([]);
    } finally { live.close(); }
  });
});

describe('self-join and agent parity', () => {
  it('concurrent joins create exactly one membership event', async () => {
    const head = await harbor.store.head(spaceId);
    const results = await Promise.all(Array.from({ length: 4 }, () => browser.post(`${base()}/join`)));
    for (const r of results) {
      expect(r.status).toBe(200);
      expect(routes.joinSpace.response.parse(r.body)).toEqual(results[0]!.body);
    }
    expect(await harbor.store.head(spaceId)).toBe(head + 1);
    expect((await harbor.store.listEventsAfter(spaceId, head))[0]!.event).toMatchObject({ type: 'membership', action: 'joined', membership: { memberId: 'browser' } });
  });

  it('announces a new membership exactly once across concurrent joins and retries', async () => {
    const live = await liveClient(harbor, 'dev-browser');
    try {
      await Promise.all(Array.from({ length: 4 }, () => browser.post(`${base()}/join`)));
      await live.until((fs) => fs.some((f) => f.kind === 'space_added'));
      await browser.post(`${base()}/join`);
      live.send({ kind: 'subscribe', spaceId });
      await live.until((fs) => fs.some((f) => f.kind === 'subscribed'));
      expect(live.frames.filter((f) => f.kind === 'space_added')).toHaveLength(1);
    } finally { live.close(); }
  });

  it('lists a self-joined space as joined', async () => {
    await browser.post(`${base()}/join`);
    expect((await browser.get('/v1/spaces')).body.spaces).toHaveLength(1);
    expect((await browser.get('/v1/spaces/browse')).body.spaces[0].joined).toBe(true);
  });

  it('permits posting after self-join', async () => {
    await browser.post(`${base()}/join`);
    expect((await browser.post(`${base()}/messages`, { ...by, body: 'joined' })).status).toBe(200);
  });

  it('retries an existing join even when the org is read-only', async () => {
    const joined = await browser.post(`${base()}/join`);
    const head = await harbor.store.head(spaceId);
    harbor.service.readOnly = true;
    const retry = await browser.post(`${base()}/join`);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(joined.body);
    expect(await harbor.store.head(spaceId)).toBe(head);
  });

  it('refuses new joins when the org is read-only', async () => {
    harbor.service.readOnly = true;
    expect((await browser.post(`${base()}/join`)).body.code).toBe('read_only_limit');
    expect(await harbor.store.getMembership(spaceId, 'browser')).toBeUndefined();
  });

  it('leaving stops the live subscription', async () => {
    await browser.post(`${base()}/join`);
    const live = await liveClient(harbor, 'dev-browser');
    try {
      live.send({ kind: 'subscribe', spaceId });
      await live.until((fs) => fs.some((f) => f.kind === 'subscribed'));
      expect((await browser.post(`${base()}/leave`)).status).toBe(200);
      await live.until((fs) => fs.some((f) => f.kind === 'space_removed'));
      const departure = live.frames.length;
      await owner.post(`${base()}/messages`, { ...by, body: 'after departure' });
      live.send({ kind: 'subscribe', spaceId });
      await live.until((fs) => fs.filter((f) => f.kind === 'subscribed').length === 2);
      expect(live.frames.slice(departure).some((f) => f.kind === 'event')).toBe(false);
    } finally { live.close(); }
  });

  it('permits preview reads after leaving', async () => {
    await browser.post(`${base()}/join`);
    await browser.post(`${base()}/leave`);
    expect((await browser.get(`${base()}/stream`)).status).toBe(200);
  });

  it('refuses posting after leaving', async () => {
    await browser.post(`${base()}/join`);
    await browser.post(`${base()}/leave`);
    expect((await browser.post(`${base()}/messages`, { ...by, body: 'no longer joined' })).body).toMatchObject(refusal);
  });

  describe('MCP', () => {
    let agent: Awaited<ReturnType<typeof agentClient>>;
    beforeEach(async () => { agent = await agentClient(harbor, 'dev-browser'); });
    afterEach(async () => { await agent.close(); });
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await agent.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      return mcpTools.find((t) => t.name === name)!.output.parse(result.structuredContent) as any;
    };

    it('classifies MCP browse and asset reads as read-only', async () => {
      expect(readOnlyMcpToolNames.has('browse_spaces')).toBe(true);
      expect(readOnlyMcpToolNames.has('list_assets')).toBe(true);
      expect(readOnlyMcpToolNames.has('join_space')).toBe(false);
    });

    it('exposes unjoined open spaces through MCP browse', async () => {
      expect((await call('browse_spaces')).spaces[0].joined).toBe(false);
    });

    it.each([
      ['read_stream', () => ({ spaceId })],
      ['read_thread', () => ({ spaceId, rootMessageId: messageId })],
      ['list_members', () => ({ spaceId })],
      ['list_topics', () => ({ spaceId })],
      ['search_space', () => ({ spaceId, query: 'needle' })],
      ['read_asset', () => ({ spaceId, assetId })],
      ['asset_history', () => ({ spaceId, assetId })],
      ['diff', () => ({ spaceId, assetId, from: 1, to: 2 })],
    ] as Array<[string, () => Record<string, unknown>]>)('permits MCP %s before joining', async (name, args) => {
      await call(name, args());
    });

    it('discovers files through MCP before joining', async () => {
      expect((await call('list_assets', { spaceId })).entries).toContainEqual(expect.objectContaining({ id: assetId }));
    });

    it('refuses MCP posting before joining', async () => {
      const denied = await agent.callTool({ name: 'post_message', arguments: { spaceId, body: 'no' } });
      expect(denied.isError).toBe(true);
      expect(JSON.parse((denied.content as Array<{ text: string }>)[0]!.text)).toMatchObject(refusal);
    });

    it('permits MCP posting after joining', async () => {
      await call('join_space', { spaceId });
      await call('post_message', { spaceId, body: 'agent joined' });
      expect((await call('list_spaces')).spaces[0].visibility).toBe('open');
    });

    it('creates open spaces through MCP', async () => {
      expect((await call('create_space', { name: 'Agent open', visibility: 'open' })).space.visibility).toBe('open');
    });

    it('defaults MCP space creation to private', async () => {
      expect((await call('create_space', { name: 'Agent private' })).space.visibility).toBe('private');
    });
  });
});
