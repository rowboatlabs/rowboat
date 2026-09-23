import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('open-space discovery and reading', () => {
  it('defaults old payloads and creation to private; preserves visibility on rename', async () => {
    expect(Space.parse({ id: spaceId, name: 'Legacy', createdAt: new Date().toISOString() }).visibility).toBe('private');
    const spaces = (await owner.get('/v1/spaces?includeDirect=1')).body.spaces;
    expect(spaces.find((s: Space) => s.id === privateId).visibility).toBe('private');
    expect(spaces.find((s: Space) => s.id === dmId).visibility).toBe('private');
    expect((await owner.post('/v1/spaces', { name: 'Invalid', visibility: 'public' })).status).toBe(400);
    const renamed = await owner.post(`${base()}/rename`, { ...by, name: 'Open renamed' });
    expect(renamed.body.space.visibility).toBe('open');
  });

  it('browses only shared open spaces and does not change joined listings', async () => {
    const result = await browser.get('/v1/spaces/browse');
    expect(result.status).toBe(200);
    const parsed = routes.browseSpaces.response.parse(result.body);
    expect(parsed.spaces).toEqual([{ space: expect.objectContaining({ id: spaceId, visibility: 'open' }), joined: false }]);
    expect((await owner.get('/v1/spaces/browse')).body.spaces[0].joined).toBe(true);
    expect((await browser.get('/v1/spaces')).body.spaces).toEqual([]);
    expect((await fetch(`${harbor.url}/v1/spaces/browse`)).status).toBe(401);
    await expect(harbor.service.browseSpaces({ memberId: 'missing' })).rejects.toMatchObject({ code: 'not_a_member' });
    await expect(harbor.service.listStream({ memberId: 'missing' }, spaceId)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('allows every content read without joining or acquiring personal state', async () => {
    const paths = [
      '/stream', `/threads/${messageId}`, `/messages/${messageId}`, '/topics', '/members',
      '/search?q=needle', '/assets', `/assets/${assetId}`, `/assets/${assetId}?version=1`,
      `/history?assetId=${assetId}`, `/diff?assetId=${assetId}&from=1&to=2`,
    ];
    for (const path of paths) {
      const result = await browser.get(base() + path);
      expect(result.status, path).toBe(200);
    }
    expect((await browser.get(`${base()}/stream`)).body.messages.some((m: Message) => m.id === messageId)).toBe(true);
    expect((await browser.get(`${base()}/assets/${assetId}?version=1`)).body.content).toBe('needle version one\n');
    expect(await harbor.store.getMembership(spaceId, 'browser')).toBeUndefined();
    expect(await harbor.store.getThreadReadMark(spaceId, messageId, 'browser')).toBeUndefined();
    expect((await browser.get('/v1/unread')).body.spaces).toEqual([]);
    expect((await browser.get('/v1/activity')).body.items).toEqual([]);
  });

  it('downloads registered blobs but refuses uploads and foreign hashes', async () => {
    const bytes = Buffer.from('preview bytes');
    const hash = blobHash(bytes);
    const put = (id: string, token: string, content = bytes) => fetch(`${harbor.url}/v1/spaces/${id}/blobs`, {
      method: 'PUT', headers: { authorization: `Bearer ${token}`, 'x-blob-sha256': blobHash(content) }, body: content,
    });
    expect((await put(spaceId, 'dev-owner')).status).toBe(200);
    const download = await fetch(`${harbor.url}${base()}/blobs/${hash}`, { headers: { authorization: 'Bearer dev-browser' } });
    expect(download.status).toBe(200);
    expect(await download.text()).toBe('preview bytes');
    const refused = await put(spaceId, 'dev-browser', Buffer.from('refused bytes'));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject(refusal);
    const secret = Buffer.from('private bytes');
    await put(privateId, 'dev-owner', secret);
    expect((await browser.get(`${base()}/blobs/${blobHash(secret)}`)).status).toBe(404);
  });

  it('private spaces and DMs remain inaccessible and cannot be self-joined', async () => {
    for (const id of [privateId, dmId]) {
      for (const suffix of ['/stream', '/members', '/assets']) {
        expect((await browser.get(`/v1/spaces/${id}${suffix}`)).status).toBe(403);
      }
      expect((await browser.post(`/v1/spaces/${id}/join`)).status).toBe(403);
    }
  });
});

describe('browsing does not authorize actions', () => {
  it('rejects valid requests across content, membership and personal-state mutations without writes', async () => {
    const head = await harbor.store.head(spaceId);
    const requests: Array<[string, object]> = [
      [`${base()}/messages`, { ...by, body: 'no' }],
      [`${base()}/messages/${messageId}/edit`, { ...by, body: 'no' }],
      [`${base()}/messages/${messageId}/delete`, by],
      [`${base()}/messages/${messageId}/reactions`, { ...by, emoji: '👍', action: 'add' }],
      [`${base()}/messages/${messageId}/poll/votes`, { ...by, answerId: 1, action: 'add' }],
      [`${base()}/messages/${messageId}/poll/end`, by],
      [`${base()}/topics`, { ...by, title: 'No', body: 'no' }],
      [`${base()}/topics/${topicId}`, { ...by, action: 'archive' }],
      [`${base()}/assets`, { ...by, path: 'no.md', newContent: 'no' }],
      [`${base()}/changes`, { ...by, assetId, baseVersion: 2, newContent: 'no' }],
      [`${base()}/assets/move`, { ...by, assetId, baseVersion: 2, toPath: 'no.md' }],
      [`${base()}/assets/delete`, { ...by, assetId, baseVersion: 2 }],
      [`${base()}/assets/restore`, { ...by, assetId }],
      [`${base()}/rename`, { ...by, name: 'No' }],
      ['/v1/invites', { spaceId }],
      [`${base()}/leave`, {}],
      [`${base()}/read`, { offset: head }],
      [`${base()}/threads/${messageId}/follow`, { following: true }],
      ['/v1/activity/read-all', { spaceId }],
    ];
    for (const [path, input] of requests) {
      const result = await browser.post(path, input);
      expect(result.status, `${path}: ${JSON.stringify(result.body)}`).toBe(403);
      expect(result.body).toMatchObject(refusal);
    }
    expect(await harbor.store.head(spaceId)).toBe(head);
    expect(await harbor.store.getMembership(spaceId, 'browser')).toBeUndefined();
    expect(await harbor.store.getThreadReadMark(spaceId, messageId, 'browser')).toBeUndefined();
    expect((await owner.get(`${base()}/assets/${assetId}`)).body.version).toBe(2);
  });

  it('receives live replay and updates without notifications, and cannot publish ephemeral frames', async () => {
    const live = await liveClient(harbor, 'dev-browser');
    try {
      live.send({ kind: 'subscribe', spaceId, afterOffset: 0 });
      const head = await harbor.store.head(spaceId);
      await live.until((fs) => fs.some((f) => f.kind === 'event' && f.offset === head));
      expect(live.events().map((f) => f.offset)).toEqual(Array.from({ length: head }, (_, i) => i + 1));
      live.send({ kind: 'presence', spaceId, state: 'typing' });
      live.send({ kind: 'whiteboard', spaceId, boardId: 'preview-board', payload: {} });
      await live.until((fs) => fs.filter((f) => f.kind === 'error').length === 2);
      expect(live.frames.filter((f) => f.kind === 'error')).toEqual([
        expect.objectContaining(refusal), expect.objectContaining(refusal),
      ]);
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
  it('joins concurrently exactly once, announces membership, supports retry, and becomes writable', async () => {
    const live = await liveClient(harbor, 'dev-browser');
    const head = await harbor.store.head(spaceId);
    try {
      const results = await Promise.all(Array.from({ length: 4 }, () => browser.post(`${base()}/join`)));
      for (const r of results) {
        expect(r.status).toBe(200);
        expect(routes.joinSpace.response.parse(r.body)).toEqual(results[0]!.body);
      }
      await live.until((fs) => fs.some((f) => f.kind === 'space_added'));
      expect(live.frames.filter((f) => f.kind === 'space_added')).toHaveLength(1);
      expect(await harbor.store.head(spaceId)).toBe(head + 1);
      expect((await harbor.store.listEventsAfter(spaceId, head))[0]!.event).toMatchObject({ type: 'membership', action: 'joined', membership: { memberId: 'browser' } });
      expect((await browser.get('/v1/spaces')).body.spaces).toHaveLength(1);
      expect((await browser.get('/v1/spaces/browse')).body.spaces[0].joined).toBe(true);
      expect((await browser.post(`${base()}/messages`, { ...by, body: 'joined' })).status).toBe(200);
      harbor.service.readOnly = true;
      expect((await browser.post(`${base()}/join`)).body).toEqual(results[0]!.body);
      expect((await restClient(harbor, 'dev-other').post(`${base()}/join`)).body.code).toBe('read_only_limit');
    } finally { harbor.service.readOnly = false; live.close(); }
  });

  it('leaving stops the subscription; explicitly subscribing again permits preview only', async () => {
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
      expect((await browser.get(`${base()}/stream`)).status).toBe(200);
      expect((await browser.post(`${base()}/messages`, { ...by, body: 'no longer joined' })).body).toMatchObject(refusal);
    } finally { live.close(); }
  });

  it('exposes browse/create/join on MCP, validates outputs and permits preview reads', async () => {
    const agent = await agentClient(harbor, 'dev-browser');
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await agent.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      return mcpTools.find((t) => t.name === name)!.output.parse(result.structuredContent) as any;
    };
    try {
      expect(readOnlyMcpToolNames.has('browse_spaces')).toBe(true);
      expect(readOnlyMcpToolNames.has('join_space')).toBe(false);
      expect((await call('browse_spaces')).spaces[0].joined).toBe(false);
      await call('read_stream', { spaceId });
      await call('read_thread', { spaceId, rootMessageId: messageId });
      await call('list_members', { spaceId });
      await call('list_topics', { spaceId });
      await call('search_space', { spaceId, query: 'needle' });
      expect(readOnlyMcpToolNames.has('list_assets')).toBe(true);
      expect((await call('list_assets', { spaceId })).entries).toContainEqual(expect.objectContaining({ id: assetId }));
      await call('read_asset', { spaceId, assetId });
      await call('asset_history', { spaceId, assetId });
      await call('diff', { spaceId, assetId, from: 1, to: 2 });
      const denied = await agent.callTool({ name: 'post_message', arguments: { spaceId, body: 'no' } });
      expect(denied.isError).toBe(true);
      expect(JSON.parse((denied.content as Array<{ text: string }>)[0]!.text)).toMatchObject(refusal);
      await call('join_space', { spaceId });
      await call('post_message', { spaceId, body: 'agent joined' });
      expect((await call('list_spaces')).spaces[0].visibility).toBe('open');
      expect((await call('create_space', { name: 'Agent open', visibility: 'open' })).space.visibility).toBe('open');
      expect((await call('create_space', { name: 'Agent private' })).space.visibility).toBe('private');
    } finally { await agent.close(); }
  });
});
